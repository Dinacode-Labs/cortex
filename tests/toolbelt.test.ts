import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as yamlParse } from "yaml";
import { auditToolbelt, installToolbelt } from "../apps/cli/src/toolbelt/install.js";
import { loadRegistry, missingEnv, resolveArgs } from "../apps/cli/src/toolbelt/registry.js";
import type { SetupCtx } from "../apps/cli/src/setup/types.js";

/**
 * El toolbelt reparte configuración de herramientas de terceros. Lo importante no es que
 * instale, sino lo que hace cuando NO puede: una entrada a la que le falta su variable de
 * entorno tiene que quedarse fuera, no registrarse a medias. Un MCP registrado y roto es peor
 * que uno ausente, porque el agente lo intenta en cada arranque.
 */

let home: string;
let calls: string[][];

function ctxWith(over: Partial<SetupCtx> = {}): SetupCtx {
  return {
    home,
    dryRun: false,
    remove: false,
    noPlugin: false,
    log: () => {},
    detect: () => true,
    exec: (bin, args) => {
      calls.push([bin, ...args]);
      if (args[0] === "mcp" && args[1] === "get") throw new Error("not found");
      return "";
    },
    now: () => new Date("2026-09-10T12:00:00Z"),
    ...over,
  };
}

const REGISTRY = {
  mcpServers: {
    tickets: { transport: "stdio" as const, command: "npx", args: ["-y", "tickets-mcp"], env: ["TICKETS_API_KEY"], auth: "token en TICKETS_API_KEY" },
    wiki: { transport: "http" as const, url: "https://mcp.example.com/wiki", auth: "OAuth" },
    interno: { transport: "stdio" as const, command: "node", args: ["{REPO}/tools/x.js"], auth: "ninguna" },
    soloClaude: { transport: "stdio" as const, command: "foo", agents: ["claude"], auth: "ninguna" },
  },
  skills: [{ name: "tickets-api", auth: "la del MCP" }],
  commands: [{ name: "ticket-nuevo", file: "ticket-nuevo.md" }],
};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cortex-toolbelt-"));
  calls = [];
  process.env.TICKETS_API_KEY = "secreto";
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.TICKETS_API_KEY;
});

describe("registry", () => {
  it("carga un fichero local y rellena las listas que falten", async () => {
    const f = join(home, "reg.json");
    writeFileSync(f, JSON.stringify({ mcpServers: { a: { transport: "stdio", command: "x" } } }));
    const m = await loadRegistry(f);
    expect(Object.keys(m.mcpServers)).toEqual(["a"]);
    expect(m.skills).toEqual([]);
    expect(m.commands).toEqual([]);
  });

  it("un registry ilegible falla con un mensaje que dice qué fichero es", async () => {
    await expect(loadRegistry(join(home, "no-existe.json"))).rejects.toThrow(/no-existe\.json/);
  });

  it("{REPO} sin --repo deja la entrada sin resolver", () => {
    expect(resolveArgs(["{REPO}/x.js"], null)).toBeNull();
    expect(resolveArgs(["{REPO}/x.js"], "/repo")).toEqual(["/repo/x.js"]);
    expect(resolveArgs(["sin-placeholder"], null)).toEqual(["sin-placeholder"]);
  });

  it("dice qué variables faltan", () => {
    expect(missingEnv({ transport: "stdio", env: ["TICKETS_API_KEY"] })).toEqual([]);
    expect(missingEnv({ transport: "stdio", env: ["NO_EXPORTADA_XYZ"] })).toEqual(["NO_EXPORTADA_XYZ"]);
  });
});

describe("installToolbelt", () => {
  it("omite las entradas sin credenciales en vez de registrarlas rotas", () => {
    delete process.env.TICKETS_API_KEY;
    const report = installToolbelt(ctxWith(), "opencode", REGISTRY, null);
    expect(report.warnings.join(" ")).toContain("TICKETS_API_KEY");
    const cfg = JSON.parse(readFileSync(join(home, ".config/opencode/opencode.json"), "utf8"));
    expect(cfg.mcp.tickets).toBeUndefined();
    expect(cfg.mcp.wiki).toBeDefined(); // la que sí se puede, se instala
  });

  it("respeta el filtro de agentes del registry", () => {
    const report = installToolbelt(ctxWith(), "opencode", REGISTRY, null);
    expect(report.changed.join(" ")).not.toContain("soloClaude");
    const claude = installToolbelt(ctxWith(), "claude-code", REGISTRY, null);
    expect(claude.changed.join(" ")).toContain("soloClaude");
  });

  it("no pisa un MCP que ya estuviera: puede tener su auth hecha", () => {
    mkdirSync(join(home, ".config/opencode"), { recursive: true });
    writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({ mcp: { wiki: { type: "remote", url: "https://mio", enabled: true } } }));
    const report = installToolbelt(ctxWith(), "opencode", REGISTRY, null);
    expect(JSON.parse(readFileSync(join(home, ".config/opencode/opencode.json"), "utf8")).mcp.wiki.url).toBe("https://mio");
    expect(report.skipped.join(" ")).toContain("wiki");
  });

  it("en Claude y Codex usa su propio CLI", () => {
    installToolbelt(ctxWith(), "claude-code", REGISTRY, null);
    expect(calls).toContainEqual(["claude", "mcp", "add", "tickets", "-s", "user", "-e", "TICKETS_API_KEY=secreto", "--", "npx", "-y", "tickets-mcp"]);
    calls = [];
    installToolbelt(ctxWith(), "codex", REGISTRY, null);
    expect(calls.some((c) => c[0] === "codex" && c[2] === "add" && c[3] === "tickets")).toBe(true);
  });

  it("Hermes recibe su bloque YAML", () => {
    installToolbelt(ctxWith(), "hermes", REGISTRY, null);
    const cfg = yamlParse(readFileSync(join(home, ".hermes/config.yaml"), "utf8")) as any;
    expect(cfg.mcp_servers.tickets).toEqual({ command: "npx", args: ["-y", "tickets-mcp"], enabled: true });
  });

  it("sin --repo, las skills y comandos se omiten con un aviso (son ficheros)", () => {
    const report = installToolbelt(ctxWith(), "claude-code", REGISTRY, null);
    expect(report.warnings.join(" ")).toContain("--repo");
    expect(existsSync(join(home, ".claude/skills/tickets-api"))).toBe(false);
  });

  it("con --repo, enlaza skills y comandos", () => {
    const repo = join(home, "registry");
    mkdirSync(join(repo, "skills/tickets-api"), { recursive: true });
    mkdirSync(join(repo, "commands"), { recursive: true });
    writeFileSync(join(repo, "commands/ticket-nuevo.md"), "x");
    const report = installToolbelt(ctxWith(), "claude-code", REGISTRY, repo);
    expect(existsSync(join(home, ".claude/skills/tickets-api"))).toBe(true);
    expect(existsSync(join(home, ".claude/commands/ticket-nuevo.md"))).toBe(true);
    // Y con repo, la entrada que usaba {REPO} deja de omitirse.
    expect(report.warnings.join(" ")).not.toContain("{REPO}");
  });

  it("--dry-run no escribe", () => {
    installToolbelt(ctxWith({ dryRun: true }), "opencode", REGISTRY, null);
    expect(existsSync(join(home, ".config/opencode/opencode.json"))).toBe(false);
  });
});

describe("auditToolbelt", () => {
  it("marca en rojo solo lo que le falta algo", () => {
    delete process.env.TICKETS_API_KEY;
    const rows = auditToolbelt(REGISTRY);
    const tickets = rows.find((r) => r.line.startsWith("tickets"))!;
    expect(tickets.ok).toBe(false);
    expect(tickets.line).toContain("MISSING");
    expect(rows.find((r) => r.line.startsWith("wiki"))!.ok).toBe(true);
  });
});
