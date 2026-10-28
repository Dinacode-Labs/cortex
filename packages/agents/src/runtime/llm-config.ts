import { getEnv, loadEnv } from "@cortex/shared";
import type { AgentRole } from "./roles.js";

/**
 * LLM credential/model resolution. Every supported endpoint speaks the OpenAI dialect
 * (`/v1/chat/completions`), so the provider is generic and config decides which one:
 *
 *   LLM_PROVIDER=none               -> no LLM (local heuristics)
 *   LLM_PROVIDER=openai-compatible  -> LLM_BASE_URL + LLM_API_KEY + LLM_MODEL
 *                                      (NaN, Ollama, vLLM, LM Studio, TGI...)
 *   LLM_PROVIDER=openrouter         -> OPENROUTER_API_KEY + OPENROUTER_MODEL
 *   LLM_PROVIDER=nan                -> DEPRECATED ALIAS of openai-compatible with NaN's
 *                                      defaults. Removed in v0.2.0.
 *
 * Only the resolution lives here; the calls are made by consumers in @cortex/agents.
 * See ADR-0006/0008/0015/0024.
 */

export interface LlmConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseURL: string;
}

const NAN_BASE_URL = "https://api.nan.builders/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Providers that may appear as a prefix in `CORTEX_MODEL_<ROLE>`. The list is closed on
 *  purpose: a model id can contain `:` (Ollama uses `llama3:8b`), so only a known provider
 *  is ever read as a provider. */
const KNOWN_PROVIDERS = new Set(["openai-compatible", "openrouter", "nan"]);

interface AliasDefaults {
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

let warnedNanAlias = false;

function normalizeProvider(declared: string): { provider: string; defaults: AliasDefaults } {
  if (declared !== "nan") return { provider: declared, defaults: {} };
  if (!warnedNanAlias) {
    warnedNanAlias = true;
    console.warn(
      "[llm-config] LLM_PROVIDER=nan is deprecated: use LLM_PROVIDER=openai-compatible with " +
        "LLM_BASE_URL / LLM_API_KEY / LLM_MODEL (see .env.example). The alias is removed in v0.2.0.",
    );
  }
  // `||` rather than getEnv: an env var that is declared but empty counts as "unset"
  // (getEnv only applies its default when the variable does not exist).
  return {
    provider: "openai-compatible",
    defaults: {
      baseURL: process.env.NAN_BASE_URL || NAN_BASE_URL,
      apiKey: process.env.NAN_API_KEY || undefined,
      model: process.env.NAN_LLM_MODEL || undefined,
    },
  };
}

function splitModelSpec(spec: string): { provider?: string; model: string } {
  const i = spec.indexOf(":");
  if (i <= 0) return { model: spec };
  const prefix = spec.slice(0, i).toLowerCase();
  if (!KNOWN_PROVIDERS.has(prefix)) return { model: spec };
  return { provider: prefix, model: spec.slice(i + 1).trim() };
}

type ModelCandidate = [model: string | undefined, setBy: string | null];

interface Resolved {
  config: LlmConfig;
  modelSetBy: string | null;
}

function firstModel(candidates: ModelCandidate[], codeDefault: string): { model: string; setBy: string | null } {
  for (const [model, setBy] of candidates) if (model) return { model, setBy };
  return { model: codeDefault, setBy: null };
}

function resolveProvider(provider: string, requested: ModelCandidate, defaults: AliasDefaults): Resolved | null {
  if (provider === "openai-compatible") {
    const baseURL = (getEnv("LLM_BASE_URL", "").trim() || defaults.baseURL || "").trim();
    if (!baseURL) return null;
    // `||` and not `??`: an env var that is declared but EMPTY (`LLM_API_KEY=` in
    // .env.example) means "unset", so it must fall through to the next candidate.
    const apiKey = (process.env.LLM_API_KEY || defaults.apiKey || "").trim();
    // Local endpoints (Ollama, LM Studio) need no key: that has to be stated explicitly so a
    // deployment does not silently end up with no LLM because of a forgotten key.
    if (!apiKey && !getEnv("LLM_ALLOW_NO_KEY", "").trim()) return null;
    const { model, setBy } = firstModel(
      [requested, [getEnv("LLM_MODEL", "").trim(), "LLM_MODEL"], [defaults.model, "NAN_LLM_MODEL"]],
      "deepseek-v4-flash",
    );
    return { config: { provider, apiKey: apiKey || "no-key", model, baseURL }, modelSetBy: setBy };
  }
  if (provider === "openrouter") {
    const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
    if (!apiKey) return null;
    const { model, setBy } = firstModel(
      [requested, [getEnv("OPENROUTER_MODEL", "").trim(), "OPENROUTER_MODEL"]],
      "deepseek/deepseek-v4-pro",
    );
    return { config: { provider, apiKey, model, baseURL: OPENROUTER_BASE_URL }, modelSetBy: setBy };
  }
  return null;
}

export function roleModelVariable(role: string): string {
  return `CORTEX_MODEL_${role.toUpperCase()}`;
}

function resolveRole(role?: string): Resolved | null {
  loadEnv();
  const declared = (getEnv("LLM_PROVIDER", "none").trim() || "none").toLowerCase();
  const { provider: baseProvider, defaults } = normalizeProvider(declared);
  const roleVariable = role ? roleModelVariable(role) : null;
  const spec = roleVariable ? getEnv(roleVariable, "").trim() : "";
  const { provider: roleProvider, model: roleModel } = splitModelSpec(spec);
  const requested: ModelCandidate = [roleModel, roleVariable];
  if (!roleProvider) return resolveProvider(baseProvider, requested, defaults);
  // The role points at another provider: resolve it with ITS credentials, without
  // inheriting the base provider's alias defaults (they belong to a different endpoint).
  const { provider, defaults: roleDefaults } = normalizeProvider(roleProvider);
  return resolveProvider(provider, requested, roleDefaults);
}

/**
 * Returns the LLM config when enabled, or null.
 *
 * With `role`, the model comes from `CORTEX_MODEL_<ROLE>` (e.g. `CORTEX_MODEL_DISTILLER`),
 * which beats the provider default. The value takes two shapes:
 *   - `model`             -> same provider, different model
 *   - `provider:model`    -> a DIFFERENT provider for that role (e.g.
 *                            `CORTEX_MODEL_RETRIEVER=openrouter:x-ai/grok-4.5`),
 *                            resolved with its own credentials.
 * This allows cheap/powerful routing per role without touching code (ADR-0023/0024).
 */
export function getLlmConfig(role?: string): LlmConfig | null {
  return resolveRole(role)?.config ?? null;
}

export function isLlmEnabled(): boolean {
  return getLlmConfig() !== null;
}

export interface RoleModel {
  provider: string;
  model: string;
  /** Null when no variable names a model and the code's default applies. */
  setBy: string | null;
}

/** What a role will ask for, without its credentials. Null when it calls no model: with no base
 *  provider no agent is built at all (`registry.ts`), whatever `CORTEX_MODEL_<ROLE>` says. */
export function describeRoleModel(role: AgentRole): RoleModel | null {
  if (!isLlmEnabled()) return null;
  const resolved = resolveRole(role);
  if (!resolved) return null;
  return { provider: resolved.config.provider, model: resolved.config.model, setBy: resolved.modelSetBy };
}

/** Config for the VISION model (image captioning / OCR). Same endpoint as the chat LLM
 * unless `CORTEX_VISION_MODEL` says otherwise: that allows pointing at a multimodal model
 * when the chat one is text-only, and it accepts `provider:model` just like the roles.
 * Null when there is no LLM. */
export function getVisionConfig(): LlmConfig | null {
  const model = getEnv("CORTEX_VISION_MODEL", "").trim();
  if (!model) return getLlmConfig();
  const { provider: visionProvider, model: visionModel } = splitModelSpec(model);
  if (visionProvider) {
    const { provider, defaults } = normalizeProvider(visionProvider);
    return resolveProvider(provider, [visionModel, "CORTEX_VISION_MODEL"], defaults)?.config ?? null;
  }
  const cfg = getLlmConfig();
  return cfg ? { ...cfg, model: visionModel } : null;
}

export interface SttConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/** STT config (audio/video transcription, whisper). Its OWN endpoint, decoupled from the
 * chat provider: not all of them serve `/audio/transcriptions` (OpenRouter does not).
 * Key: `CORTEX_STT_API_KEY`, falling back to `LLM_API_KEY`/`OPENAI_API_KEY`; base URL
 * `CORTEX_STT_BASE_URL` (default OpenAI); model `CORTEX_STT_MODEL` (default whisper-1).
 * With NaN: set all three (`.../v1`, the NaN key and `whisper`). Null when there is no key. */
export function getSttConfig(): SttConfig | null {
  loadEnv();
  const key = (process.env.CORTEX_STT_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!key) return null;
  return {
    apiKey: key,
    baseURL: getEnv("CORTEX_STT_BASE_URL", "https://api.openai.com/v1"),
    model: getEnv("CORTEX_STT_MODEL", "whisper-1"),
  };
}
