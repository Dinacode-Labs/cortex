import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

const skillsDir = resolve(root, "plugin/claude-code/skills");
const carpetasDeSkills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

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
    expect(carpetasDeSkills.sort()).toEqual(["cortex-capture", "cortex-report"]);
    expect(existsSync(resolve(root, "plugin/claude-code/commands/cortex-save.md"))).toBe(true);
  });

  // Lo que rompe `cortex setup` no es que falte el fichero, sino un frontmatter que Claude Code
  // no sabe leer: sin `---`, con el `name` distinto de la carpeta o sin descripción, la skill se
  // instala y no se carga nunca.
  it.each(carpetasDeSkills)("la skill %s trae un frontmatter que Claude Code puede cargar", (carpeta) => {
    const md = readFileSync(resolve(skillsDir, carpeta, "SKILL.md"), "utf8");
    expect(md.startsWith("---\n")).toBe(true);

    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(md)?.[1];
    expect(frontmatter, "frontmatter sin cerrar").toBeDefined();
    expect(/^name:[ \t]*(.+)$/m.exec(frontmatter!)?.[1].trim()).toBe(carpeta);
    // `description` suele ir como bloque plegado (`>-`), con el texto en las líneas siguientes:
    // lo que se comprueba es que quede algo después de la clave, esté donde esté.
    const descripcion = frontmatter!.split(/^description:[ \t]*/m)[1];
    expect(descripcion, "falta description").toBeDefined();
    expect(descripcion!.replace(/^>-?/, "").trim()).not.toBe("");
  });
});
