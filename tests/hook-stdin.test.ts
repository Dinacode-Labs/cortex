import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Regresión de la integración con Pi: los hooks se colgaban.
 *
 * Claude Code escribe el JSON en stdin y **cierra** la tubería. Pi llama al CLI con `execFile`,
 * que deja stdin abierto y mudo: el `for await` sobre `process.stdin` no terminaba nunca, el
 * hook moría por el timeout de quien lo llamó y el agente arrancaba sin contexto sin que nadie
 * se enterara. Aquí se arranca el CLI de verdad con stdin abierto y se comprueba que termina.
 */

const RAIZ = resolve(import.meta.dirname, "..");
const CLI = join(RAIZ, "apps/cli/src/index.ts");
let repo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "cortex-hook-stdin-"));
});
afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

/**
 * Arranca el hook con stdin abierto y SIN escribir nada nunca. El cwd es la raíz del repo
 * (`--import tsx` se resuelve desde ahí); el directorio del "proyecto" va por `--cwd`.
 * Devuelve el código de salida: si no es 0, el hijo murió por otra cosa y el test no estaría
 * probando nada.
 */
function corre(args: string[], limiteMs: number): Promise<number | null> {
  return new Promise((cumplir, fallar) => {
    // `--conditions=development` como los scripts del repo: sin él, `@cortex/*` resuelve a
    // `dist/`, que en un clon recién hecho (CI) no existe.
    const hijo = spawn(process.execPath, ["--conditions=development", "--import", "tsx", CLI, ...args], {
      cwd: RAIZ,
      stdio: ["pipe", "ignore", "pipe"],
      env: { ...process.env, CORTEX_SERVER_URL: "http://127.0.0.1:9" }, // nadie escucha: da igual, no hay proyecto
    });
    let err = "";
    hijo.stderr.on("data", (d) => (err += String(d)));
    const corte = setTimeout(() => {
      hijo.kill("SIGKILL");
      fallar(new Error(`el hook sigue vivo tras ${limiteMs} ms: se colgó leyendo stdin`));
    }, limiteMs);
    hijo.on("exit", (code) => {
      clearTimeout(corte);
      // El stderr va en el fallo: si el hijo muere por otra cosa, que se vea cuál.
      cumplir(code === 0 || !err ? code : (fallar(new Error(`salió con ${code}: ${err.slice(0, 600)}`)) as never));
    });
    hijo.on("error", fallar);
  });
}

describe("hooks con stdin abierto y mudo (como los llama Pi)", () => {
  it("hook-context con --cwd no espera a stdin", async () => {
    expect(await corre(["hook-context", "--format", "text", "--cwd", repo], 20_000)).toBe(0);
  }, 30_000);

  it("hook-context sin --cwd sale igualmente (tope de lectura)", async () => {
    expect(await corre(["hook-context", "--format", "text"], 20_000)).toBe(0);
  }, 30_000);

  it("hook-capture con --session no espera a stdin", async () => {
    expect(await corre(["hook-capture", "--platform", "pi", "--session", join(repo, "no-existe.jsonl"), "--cwd", repo], 20_000)).toBe(0);
  }, 30_000);
});
