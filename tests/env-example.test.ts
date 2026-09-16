import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Que la plantilla de configuración no mienta.
 *
 * Un `.env.example` se desfasa en silencio: alguien añade un `getEnv("CORTEX_LO_QUE_SEA", …)`
 * y la variable existe, funciona y no la conoce nadie salvo quien escribió esa línea. Pasó con
 * siete a la vez. Y al revés: se documenta una que el código ya no lee, y quien la pone se
 * queda esperando un efecto que no llega.
 *
 * Esto compara las dos listas. No es exhaustivo —una variable leída con una plantilla
 * (`CORTEX_MODEL_${rol}`) no se puede detectar así— pero cubre el caso normal.
 */
const RAIZ = resolve(import.meta.dirname, "..");
const PLANTILLAS = ["/.env.example", "/deploy/.env.example"].map((f) => readFileSync(RAIZ + f, "utf8")).join("\n");

/** Variables del entorno que no son de Cortex: del sistema, de node o de CI. */
const AJENAS = /^(NODE_ENV|HOME|PATH|PWD|INIT_CWD|CI|TERM|USER|SHELL|LANG|TMPDIR|APPDATA|LOCALAPPDATA|COREPACK|PNPM|XDG|GITHUB|CLAUDE|npm)/;

/**
 * Nombres obsoletos que el código sigue aceptando y la plantilla **no ofrece**, a propósito.
 *
 * Siguen funcionando para que a nadie se le rompa un `.env` de hace meses, y avisan por consola
 * cuando se usan. Pero una plantilla es lo que deberías poner hoy, no un registro de lo que se
 * llamó de otra manera: eso vive en el CHANGELOG y en el ADR que lo cambió. Ofrecerlos aquí
 * sería invitar a configuraciones nuevas con nombres muertos.
 */
const OBSOLETAS = new Set([
  "NAN_API_KEY", "NAN_BASE_URL", "NAN_LLM_MODEL", "NAN_EMBEDDING_MODEL", "NAN_EMBEDDING_DIM",
  "BREVO_SENDER", "BREVO_SENDER_NAME",
]);

function fuentes(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) fuentes(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const LEIDAS = new Set<string>();
for (const f of [...fuentes(join(RAIZ, "packages")), ...fuentes(join(RAIZ, "apps"))]) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?:process\.env\.([A-Z][A-Z0-9_]{2,})|getEnv(?:Num|Bool)?\("([A-Z][A-Z0-9_]{2,})"|requireEnv\("([A-Z][A-Z0-9_]{2,})")/g)) {
    const v = m[1] ?? m[2] ?? m[3]!;
    if (!AJENAS.test(v) && !OBSOLETAS.has(v)) LEIDAS.add(v);
  }
}

describe("plantilla de configuración", () => {
  it("encuentra variables que mirar (si no, el test no vale nada)", () => {
    expect(LEIDAS.size).toBeGreaterThan(40);
  });

  it("toda variable que el código lee está en alguna plantilla", () => {
    const huerfanas = [...LEIDAS].filter((v) => !PLANTILLAS.includes(v)).sort();
    expect(huerfanas, "existen, funcionan y no las conoce nadie").toEqual([]);
  });

  it("la plantilla no ofrece nombres obsoletos", () => {
    const ofrecidos = [...OBSOLETAS].filter((v) => PLANTILLAS.includes(v)).sort();
    expect(ofrecidos, "una plantilla es lo que deberías poner hoy, no lo que se llamó antes").toEqual([]);
  });

  it("la plantilla de desarrollo deja un `.env` que arranca sin tocar nada", () => {
    // Lo que no está comentado es lo que acaba en tu `.env` al copiarlo. Debe ser poco y
    // debe bastar: si hiciera falta rellenar algo a mano, la promesa de «arranca sin claves»
    // sería mentira.
    const activas = readFileSync(RAIZ + "/.env.example", "utf8")
      .split("\n")
      .filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l));
    expect(activas.length, "demasiadas activas: es una plantilla, no un manual").toBeLessThan(25);
    const vacias = activas
      .map((l) => l.replace(/\s+#.*$/, "")) // una línea puede llevar comentario detrás
      .filter((l) => l.endsWith("="))
      .map((l) => l.split("=")[0]);
    // Solo pueden venir vacías las que el propio fichero explica que son opcionales.
    expect(vacias.sort()).toEqual(["CORTEX_ADMIN_EMAIL", "CORTEX_AUTH_DOMAIN", "CORTEX_EMAIL_FROM"]);
  });
});
