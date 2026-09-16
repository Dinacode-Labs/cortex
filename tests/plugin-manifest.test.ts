import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * El plugin lo consume Claude Code, no nuestro código: si `marketplace.json` y `plugin.json`
 * dejan de cuadrar, o el `source` apunta a donde no es, nadie se entera hasta que un dev
 * ejecuta `cortex setup` y le falla. Estas comprobaciones son las que hace `claude plugin
 * validate`, que no está disponible en CI.
 */
const root = resolve(import.meta.dirname, "..");
const read = <T>(rel: string): T => JSON.parse(readFileSync(resolve(root, rel), "utf8")) as T;

interface Marketplace {
  name: string;
  plugins: { name: string; source: string; version?: string }[];
}
interface Plugin {
  name: string;
  version: string;
  description: string;
}

describe("plugin de Claude Code", () => {
  const market = read<Marketplace>(".claude-plugin/marketplace.json");
  const entry = market.plugins.find((p) => p.name === "cortex")!;
  const plugin = read<Plugin>("plugin/claude-code/.claude-plugin/plugin.json");

  it("el marketplace apunta a una carpeta de plugin que existe", () => {
    expect(market.name).toBe("dinacode-cortex");
    expect(entry).toBeDefined();
    expect(existsSync(resolve(root, entry.source, ".claude-plugin/plugin.json"))).toBe(true);
  });

  it("las dos versiones van a la par (el release sube ambas)", () => {
    expect(entry.version).toBe(plugin.version);
  });

  it("trae los tres hooks del bucle y los tres llaman al CLI publicado", () => {
    const hooks = read<{ hooks: Record<string, { hooks: { command: string; timeout?: number }[] }[]> }>(
      "plugin/claude-code/hooks/hooks.json",
    ).hooks;
    expect(Object.keys(hooks).sort()).toEqual(["PreCompact", "SessionEnd", "SessionStart"]);
    for (const [evento, grupos] of Object.entries(hooks)) {
      for (const h of grupos.flatMap((g) => g.hooks)) {
        // Nada de rutas a un clon del repo: el hook usa el `cortex` del PATH (ADR-0032)…
        expect(h.command, evento).toMatch(/\bcortex hook-(context|capture)\b/);
        expect(h.command, evento).not.toMatch(/\bpnpm\b|\btsx\b|dinacode-cortex/);
        // …y si no está instalado, no revienta la sesión del agente.
        expect(h.command, evento).toContain("command -v cortex");
        expect(h.timeout, evento).toBeGreaterThan(0);
      }
    }
  });

  it("el MCP del plugin es el proxy, no el que hablaba con Postgres", () => {
    const mcp = read<{ mcpServers: Record<string, { command: string; args: string[] }> }>("plugin/claude-code/.mcp.json");
    expect(mcp.mcpServers.cortex).toEqual({ command: "cortex", args: ["mcp"] });
  });

  it("las skills y el comando viven dentro del plugin", () => {
    expect(existsSync(resolve(root, "plugin/claude-code/skills/cortex-capture/SKILL.md"))).toBe(true);
    expect(existsSync(resolve(root, "plugin/claude-code/skills/cortex-report/SKILL.md"))).toBe(true);
    expect(existsSync(resolve(root, "plugin/claude-code/commands/cortex-save.md"))).toBe(true);
  });
});
