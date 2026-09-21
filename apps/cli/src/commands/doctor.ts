import { defaultServer, getClientConfig, listCredentials, normalizeServer, readCortexLink, useProjectServer } from "@cortex/client";
import { defaultCtx, detectAgents, getAdapter } from "../setup/index.js";
import type { SetupCtx } from "../setup/types.js";
import { classify } from "../compat.js";
import { CLI_VERSION } from "../version.js";

/**
 * `cortex doctor` -- why it does not work.
 *
 * Cortex has a fair number of pieces (CLI, server, MCP, credentials, the repo's link, each
 * agent's integration) and when something is wrong, the expensive part is finding out which.
 * This checks them all at once and says what to do about each failure.
 *
 * It exits with code 1 when something critical is broken, so it can be used in a script.
 */

type Level = "ok" | "warn" | "error";

export interface Check {
  name: string;
  level: Level;
  detail: string;
  /** What to do. Only when there is something to do. */
  fix?: string;
}

const ICON: Record<Level, string> = { ok: "✔", warn: "!", error: "✗" };

async function ping(url: string, opts: { token?: string } = {}): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : undefined,
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}


/**
 * The checks, separated from how they are painted. The context enters as a parameter because
 * asking each agent for its status means running ITS binary, and in a test that neither can
 * nor should happen.
 */
export async function collectChecks(ctx: SetupCtx, cwd: string): Promise<Check[]> {
  const checks: Check[] = [];

  const major = Number(process.versions.node.split(".")[0]);
  const minor = Number(process.versions.node.split(".")[1]);
  checks.push({
    name: "Node",
    level: major >= 20 ? "ok" : "error",
    detail: `v${process.versions.node}`,
    ...(major < 20 ? { fix: "Cortex needs Node 20 or newer." } : {}),
  });
  if (major < 22 || (major === 22 && minor < 5)) {
    checks.push({
      name: "Node (Hermes)",
      level: "warn",
      detail: "capturing Hermes sessions needs node:sqlite",
      fix: "Upgrade to Node 22.5 or newer if you use Hermes. Everything else works as is.",
    });
  }

  // EVERY server there is a session for is checked (ADR-0033): with several of them, knowing
  // one works says nothing about the other, and the repo you are in may point at any of them.
  const sessions = listCredentials();
  if (sessions.length === 0) {
    checks.push({ name: "Session", level: "error", detail: "not signed in", fix: "cortex auth login" });
  }

  // With several servers (ADR-0033), one being down does not mean Cortex does not work: it
  // means THAT one does not. Only the one this folder actually uses blocks -- the
  // `.cortex.json`'s or, when it says nothing, the default. Any of them used to produce "1
  // problem stopping Cortex from working" with everything else healthy, which is a false alarm
  // and an expensive one: the first time somebody sees that, they stop trusting the diagnosis.
  const theOneThatMatters = normalizeServer(readCortexLink(cwd)?.server ?? defaultServer() ?? "");
  const blocks = (server: string): Level =>
    sessions.length === 1 || normalizeServer(server) === theOneThatMatters ? "error" : "warn";

  for (const creds of sessions) {
    const several = sessions.length > 1;
    const isThisFolders = blocks(creds.server) === "error";
    const label = (n: string): string => (several ? `${n} · ${creds.server.replace(/^https?:\/\//, "")}` : n);
    checks.push({ name: label("Session"), level: "ok", detail: `${creds.email} on ${creds.server}` });

    const health = await ping(`${creds.server.replace(/\/$/, "")}/health`);
    checks.push({
      name: label("Server"),
      level: health.ok ? "ok" : blocks(creds.server),
      detail: health.ok ? creds.server : `not responding (${health.error ?? `HTTP ${health.status}`})`,
      ...(health.ok
        ? {}
        : {
            fix: isThisFolders
              ? "Check the URL, or ask whoever runs the server."
              : `This folder does not use this server, so nothing here is blocked. Sign out of it with: cortex auth logout --server ${creds.server}`,
          }),
    });
    if (!health.ok) continue;

    const me = await ping(`${creds.server.replace(/\/$/, "")}/auth/me`, { token: creds.token });
    checks.push({
      name: label("Token"),
      level: me.ok ? "ok" : blocks(creds.server),
      detail: me.ok ? "valid" : `rejected (HTTP ${me.status})`,
      ...(me.ok ? {} : { fix: `cortex auth login --server ${creds.server}` }),
    });

    const cfg = await getClientConfig(creds.server);
    if (cfg?.mcpUrl) {
      // The MCP without a token answers 401: that ALREADY proves it is alive and asking for auth.
      const mcp = await ping(cfg.mcpUrl);
      const alive = mcp.ok || mcp.status === 401 || mcp.status === 405 || mcp.status === 406;
      checks.push({
        name: label("MCP"),
        level: alive ? "ok" : blocks(creds.server),
        detail: alive ? cfg.mcpUrl : `not responding (${mcp.error ?? `HTTP ${mcp.status}`})`,
        ...(alive ? {} : { fix: "The MCP server is not running; tell whoever runs it." }),
      });
    } else {
      checks.push({ name: label("MCP"), level: "warn", detail: "the server does not publish its URL", fix: "Older server: the URL will be guessed from the port." });
    }

    // The two versions are compared in one place (ADR-0062): here they are only rendered.
    const compat = classify(creds.server, CLI_VERSION, cfg);
    if (compat.kind === "blocked") {
      checks.push({ name: label("CLI version"), level: "warn", detail: `you have ${CLI_VERSION}, the server accepts ${compat.minClientVersion} or newer: writing is disabled`, fix: "cortex upgrade" });
    } else if (compat.kind === "cli-behind") {
      checks.push({ name: label("CLI version"), level: "warn", detail: `you have ${CLI_VERSION}, the server runs ${compat.serverVersion}`, fix: "cortex upgrade" });
    } else if (compat.kind === "server-behind") {
      checks.push({ name: label("Server version"), level: "warn", detail: `${compat.serverVersion}, older than this CLI (${CLI_VERSION})`, fix: "Newer features stay off until whoever operates the server updates it." });
    }
  }

  const link = useProjectServer(cwd);
  if (!link) {
    checks.push({
      name: "This folder",
      level: "warn",
      detail: "not linked to any project",
      fix: 'cortex link <slug>  ·  or  cortex link --create "<Name>"',
    });
  } else if (link.ignore) {
    checks.push({ name: "This folder", level: "ok", detail: "marked as ignored (a deliberate opt-out)" });
  } else {
    const whereItGoes = sessions.length > 1 ? ` · on ${link.server ?? "the default server"}` : "";
    checks.push({ name: "This folder", level: "ok", detail: `linked to "${link.slug ?? link.project}"${whereItGoes}` });
  }

  const detectados = detectAgents(ctx);
  if (detectados.length === 0) {
    checks.push({ name: "Agents", level: "warn", detail: "none found on this machine" });
  }
  for (const id of detectados) {
    const adapter = getAdapter(id);
    if (!adapter) continue;
    const st = await adapter.status(ctx);
    // Being installed is not enough: an MCP pointing at the cloned repo "exists" and does not work.
    const pendiente = st.details.some((d) => d.includes("ANTIGUO") || d.startsWith("⚠️"));
    const healthy = st.installed && !pendiente;
    checks.push({
      name: `Agent ${id}`,
      level: healthy ? "ok" : "warn",
      detail: st.details.join(" · ") || (st.installed ? "configured" : "not configured"),
      ...(healthy ? {} : { fix: `cortex setup ${id}` }),
    });
  }

  return checks;
}

export async function run(args: string[] = []): Promise<void> {
  const cwd = process.env.INIT_CWD || process.cwd();
  const checks = await collectChecks(defaultCtx(), cwd);

  const width = Math.max(...checks.map((c) => c.name.length));
  console.log("cortex doctor\n");
  for (const c of checks) {
    console.log(`  ${ICON[c.level]} ${c.name.padEnd(width)}  ${c.detail}`);
    if (c.fix) console.log(`    ${" ".repeat(width)}→ ${c.fix}`);
  }

  const errors = checks.filter((c) => c.level === "error").length;
  const warnings = checks.filter((c) => c.level === "warn").length;
  console.log(
    errors
      ? `\n${errors} problem${errors > 1 ? "s" : ""} stopping Cortex from working${warnings ? `, and ${warnings} warning${warnings > 1 ? "s" : ""}` : ""}.`
      : warnings
        ? `\nEverything essential works (${warnings} warning${warnings > 1 ? "s" : ""}).`
        : "\nAll good.",
  );
  if (errors) process.exitCode = 1;
  if (args.includes("--verbose")) console.log(`\ncwd: ${cwd}`);
}
