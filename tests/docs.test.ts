import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";

/**
 * La documentación de este repo la va a leer alguien de fuera. Estas comprobaciones son las
 * que se rompen solas con el tiempo: un enlace a un fichero que se movió, un nombre de
 * cliente que se coló, o un ADR citado que nunca se escribió.
 */
const ROOT = resolve(import.meta.dirname, "..");
const DOCS = [
  "README.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "deploy/README.md",
  "config/README.md",
  ...globSync("docs/**/*.md", { cwd: ROOT }),
  ...globSync(".claude/rules/*.md", { cwd: ROOT }),
];

const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");

describe("documentación", () => {
  it("no hay enlaces internos rotos", () => {
    const rotos: string[] = [];
    for (const doc of DOCS) {
      const dir = resolve(ROOT, doc, "..");
      for (const m of read(doc).matchAll(/\]\((\.\.?\/[^)#]+)(?:#[^)]*)?\)/g)) {
        if (!existsSync(resolve(dir, m[1]!))) rotos.push(`${doc} → ${m[1]}`);
      }
    }
    expect(rotos).toEqual([]);
  });

  it("todos los ADR citados existen", () => {
    const decisions = read("docs/decisions.md");
    const existentes = new Set([...decisions.matchAll(/^## (ADR-\d{4})/gm)].map((m) => m[1]!));
    const citados = new Set<string>();
    for (const doc of DOCS) for (const m of read(doc).matchAll(/\bADR-(\d{4})\b/g)) citados.add(`ADR-${m[1]}`);
    const fantasma = [...citados].filter((a) => !existentes.has(a)).sort();
    expect(fantasma).toEqual([]);
  });

  it("no queda material corporativo: ni clientes por su nombre, ni dominios propios", () => {
    // ADR-0026 y ADR-0031: que el código se abra no significa abrir el proceso. La
    // excepción es SECURITY.md, que TIENE que decir a quién se reporta una vulnerabilidad.
    const prohibido = /\b(levelup|boluda|dinacode\.com)\b/i;
    const ofensores = DOCS.filter((d) => d !== "SECURITY.md" && prohibido.test(read(d)));
    expect(ofensores).toEqual([]);
  });

  /**
   * El producto se llama **Cortex**. Quien lo mantiene se llama Dinacode, y eso se firma donde
   * toca —licencia, autoría, la organización de GitHub—, pero no es parte del nombre.
   * «Dinacode Cortex» suena a producto de una empresa concreta justo donde queremos que suene
   * a herramienta que cualquiera puede coger, así que se queda fuera de la documentación.
   */
  it("el producto se llama Cortex, no «Dinacode Cortex»", () => {
    // Sensible a mayúsculas a propósito: `dinacode-cortex` en minúsculas es el identificador
    // del marketplace del plugin y la ruta del clon antiguo (`~/.dinacode-cortex`). Son
    // identidades técnicas que romperían instalaciones si cambiaran; lo que se prohíbe es
    // usarlo como NOMBRE del producto. El CHANGELOG queda fuera: es historia, y reescribirla
    // sería mentir sobre lo que se publicó.
    const marcaPegada = /Dinacode[ -]Cortex/;
    const ofensores = DOCS.filter((d) => d !== "CHANGELOG.md" && marcaPegada.test(read(d)));
    expect(ofensores).toEqual([]);
  });

  /**
   * El repositorio es público. Quien encuentra un fallo de seguridad o quiere contribuir
   * abre estos ficheros, y si no puede leerlos da igual lo bien escritos que estén. El
   * registro de trabajo del equipo —ADRs, roadmap, comentarios— sigue en español a
   * propósito: eso no bloquea a nadie.
   */
  it("lo que abre alguien de fuera está en inglés", () => {
    // Palabras funcionales del español: aparecen en cualquier párrafo, y en inglés no.
    const español = /\b(el|la|los|las|una|porque|además|según|cómo|qué)\b/i;
    for (const doc of ["README.md", "CONTRIBUTING.md", "SECURITY.md", "docs/decisions.md"]) {
      const sospechosas = read(doc)
        .split("\n")
        .filter((l) => español.test(l) && !l.trimStart().startsWith("```"));
      // Sin `slice`: se enseñan todas. Con tres, arreglabas tres y el cuarto seguía ahí.
      expect(sospechosas, `${doc} parece tener español`).toEqual([]);
    }
  });

  it("no se cuela cómo trabajamos por dentro", () => {
    // ADR-0031: que el código sea público no hace público el proceso. Un hallazgo se cuenta por
    // lo que enseña —«este eco puntúa 0.86–0.88»—, no por cómo se encontró: con cuántos agentes
    // a la vez, en qué máquina, con qué orquestador o contra qué entorno. Lo primero ayuda a
    // cualquiera; lo segundo solo describe nuestra cocina, y además envejece mal.
    const interno = /\b(cuatro agentes|nuestro laboratorio|el harness que usamos|nuestro servidor|nuestra máquina)\b/i;
    const ofensores = DOCS.filter((d) => interno.test(read(d)));
    expect(ofensores).toEqual([]);
  });

  it("el CHANGELOG mantiene una sección [Unreleased] para el próximo PR", () => {
    expect(read("CHANGELOG.md")).toContain("## [Unreleased]");
  });

  /**
   * Las reglas de `.claude/rules/` las carga el agente por sí solo (ADR-0064), y ahí está la
   * trampa: nada falla cuando una deja de cargarse. Si alguien la importa desde CLAUDE.md, el
   * mismo texto entra dos veces en contexto; si el `paths:` apunta a un directorio que se
   * renombró, la regla existe, se lee bien y no se aplica nunca.
   */
  it("las reglas se cargan como reglas: ni importadas dos veces, ni apuntando a la nada", () => {
    const reglas = globSync(".claude/rules/*.md", { cwd: ROOT }).map((f) => f.replaceAll("\\", "/"));
    expect(reglas.length, "no hay reglas que cargar").toBeGreaterThan(0);

    const importadas = [...read("CLAUDE.md").matchAll(/^@(\S*\.claude\/rules\/\S+\.md)$/gm)].map((m) => m[1]!);
    expect(importadas, "CLAUDE.md las importa y el agente ya las carga: entrarían dos veces").toEqual([]);

    // De cada glob se comprueba la parte literal: "apps/web/**/*.ts" → "apps/web".
    const huerfanos: string[] = [];
    for (const regla of reglas) {
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(read(regla))?.[1];
      for (const m of frontmatter?.matchAll(/^\s*-\s*"([^"]+)"/gm) ?? []) {
        const base = m[1]!.split("*")[0]!.replace(/\/[^/]*$/, "");
        if (base && !existsSync(resolve(ROOT, base))) huerfanos.push(`${regla} → ${m[1]}`);
      }
    }
    expect(huerfanos, "un paths: que no existe es una regla que no se aplica jamás").toEqual([]);
  });
});
