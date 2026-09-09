import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCtx, have, plan, symlink, type AgentAdapter, type SyncCtx } from "./sync/shared.js";
import { claudeAdapter } from "./sync/claude.js";
import { codexAdapter } from "./sync/codex.js";
import { openCodeAdapter } from "./sync/opencode.js";
import { hermesAdapter } from "./sync/hermes.js";

/**
 * cortex sync — instalador del toolbelt de IA del equipo en los agentes del dev.
 *
 * Lee el registry `config/toolbelt.json` (MCPs + skills + comandos) e instala/actualiza
 * cada uno en los agentes detectados (un adapter por agente: ./sync/*.ts). El registry
 * es PR-able: añade/mejora una skill o MCP con un PR y `cortex sync` la reparte. Cortex
 * reparte CONFIGURACIÓN, nunca credenciales: cada tool conserva su auth (`--doctor`
 * indica qué falta).
 *
 * Uso:
 *   cortex sync [--apply] [--agents claude,codex,opencode,hermes]
 *   cortex sync --doctor        # estado de auth por tool, no instala
 *
 * DRY-RUN por defecto. Las skills se enlazan por symlink: un `git pull` ya las
 * actualiza; re-ejecuta con --apply para re-registrar MCPs/comandos y ACTUALIZAR los
 * hooks a la sintaxis vigente (detecta y sustituye la antigua).
 */
export async function run(args: string[]): Promise<void> {
  const apply = args.includes("--apply");
  const doctorMode = args.includes("--doctor");
  const agentsArg = args.find((a) => a.startsWith("--agents="))?.split("=")[1] ?? (args.includes("--agents") ? args[args.indexOf("--agents") + 1] : undefined);

  const ctx = buildCtx(apply);
  if (doctorMode) {
    doctor(ctx);
    return;
  }

  const adapters: Record<string, AgentAdapter> = {
    claude: claudeAdapter(ctx),
    codex: codexAdapter(ctx),
    opencode: openCodeAdapter(ctx),
    hermes: hermesAdapter(ctx),
  };

  const requested = agentsArg ? agentsArg.split(",").map((s) => s.trim()) : Object.keys(adapters);
  console.log(`cortex sync ${apply ? "(APLICAR)" : "(dry-run — usa --apply para escribir)"}  ·  repo: ${ctx.repo}`);

  for (const agent of requested) {
    const ad = adapters[agent];
    if (!ad) {
      console.log(`\n[${agent}] desconocido`);
      continue;
    }
    if (!have(ad.bin)) {
      console.log(`\n[${agent}] no detectado — omitido`);
      continue;
    }
    console.log(`\n[${agent}]`);

    for (const [name, d] of Object.entries(ctx.toolbelt.mcpServers)) {
      if (d.agents && !d.agents.includes(agent)) continue;
      const missing = (d.env ?? []).filter((k) => !process.env[k]);
      if (missing.length) {
        plan(ctx, `${name}: requiere env ${missing.join(",")} — omitido (expórtalas y re-ejecuta)`);
        continue;
      }
      ad.registerMcp(name, d);
    }

    ad.extras?.();
    if (ad.commandsDir) for (const c of ctx.toolbelt.commands) symlink(ctx, join(ctx.repo, "config/commands", c.file), join(ad.commandsDir, c.file));
    ad.syncHooks();
  }

  // CLI `cortex` en el PATH (una vez, no por agente).
  console.log("\n[cli]");
  installCortexShim(ctx);

  console.log(`\n${apply ? "Aplicado" : "Plan listo"}. Auth por tool: \`cortex sync --doctor\`. ${apply ? "" : "Re-ejecuta con --apply para escribir."}`);
}

/** CLI `cortex` en el PATH (shim, mac + Linux). Apunta al dispatcher, que no se mueve. */
function installCortexShim(ctx: SyncCtx): void {
  const dir = join(ctx.home, ".local/bin");
  const file = join(dir, "cortex");
  const tsx = join(ctx.repo, "node_modules/.bin/tsx");
  const entry = join(ctx.repo, "apps/cli/src/index.ts");
  const shim = `#!/usr/bin/env sh\n# Generado por 'cortex sync' — CLI de Cortex.\nexec "${tsx}" "${entry}" "$@"\n`;
  if (existsSync(file) && readFileSync(file, "utf8").includes(entry)) {
    plan(ctx, "cli `cortex` ya instalado en ~/.local/bin");
  } else {
    plan(ctx, `cli \`cortex\` → ${file}`);
    if (ctx.apply) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, shim);
      chmodSync(file, 0o755);
    }
  }
  if (!(process.env.PATH ?? "").split(":").includes(dir)) {
    plan(ctx, '⚠ ~/.local/bin no está en tu PATH → añade:  export PATH="$HOME/.local/bin:$PATH"');
  }
}

function doctor(ctx: SyncCtx): void {
  console.log("cortex doctor — estado de auth por tool (no instala nada)\n");
  console.log("[MCPs]");
  for (const [name, d] of Object.entries(ctx.toolbelt.mcpServers)) {
    if (d.transport === "http") {
      console.log(`  ${name}: auth interactiva — ${d.auth}`);
      continue;
    }
    const need = d.env ?? [];
    const missing = need.filter((k) => !process.env[k]);
    const ok = missing.length === 0;
    console.log(`  ${ok ? "✔" : "✗"} ${name}: ${need.length ? `env ${need.join(",")}` : "sin env"}${missing.length ? ` — FALTAN: ${missing.join(",")}` : ""}  (${d.auth})`);
  }
  console.log("\n[Skills] (auth la configura el dev)");
  for (const s of ctx.toolbelt.skills) console.log(`  • ${s.name}: ${s.auth ?? "—"}`);
}
