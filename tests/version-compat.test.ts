import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Versionado entre CLI y servidor (ADR-0060). Son dos relojes distintos: el CLI lo actualiza
 * cada persona desde npm y el servidor, un operador. No se atan; se comparan los dos números
 * que el servidor publica y de ahí salen tres comportamientos:
 *
 *   - un aviso pasivo, UNA línea a stderr, solo con terminal delante y como mucho una vez al día;
 *   - un bloqueo de los comandos que escriben cuando el CLI está por debajo del mínimo;
 *   - y nada, nunca, en los hooks ni en `cortex mcp`, donde stdout es protocolo.
 *
 * El CLI en tests dice `dev`, que no se compara con nada; aquí se le hace creer que es 0.1.9.
 */
vi.mock("../apps/cli/src/version.ts", async (orig) => ({ ...(await orig<typeof import("../apps/cli/src/version.js")>()), CLI_VERSION: "0.1.9" }));

const SERVER = "http://cortex.test";
let home: string;

/** Un servidor que anuncia `version` y `minClientVersion`; `null` = no responde; 404 = servidor sin `/client-config`. */
function servidor(cfg: { version: string; minClientVersion?: string } | null | 404): ReturnType<typeof vi.fn> {
  const f = vi.fn(async (url: string) => {
    if (cfg === null) throw new TypeError("fetch failed");
    if (cfg === 404 || !String(url).endsWith("/client-config")) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify({ apiUrl: SERVER, mcpUrl: `${SERVER}/mcp`, webUrl: SERVER, ...cfg }), { status: 200 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

function conSesion(): void {
  mkdirSync(join(home, ".cortex"), { recursive: true });
  writeFileSync(join(home, ".cortex/credentials"), JSON.stringify({ server: SERVER, token: "t0ken", email: "dev@example.com" }));
}

async function compat() {
  return import("../apps/cli/src/compat.js");
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cortex-compat-"));
  process.env.CORTEX_HOME = home;
  process.env.CORTEX_SERVER_URL = SERVER;
  delete process.env.CI;
  delete process.env.CORTEX_NO_VERSION_CHECK;
  vi.resetModules();
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env.CORTEX_HOME;
  delete process.env.CORTEX_SERVER_URL;
  vi.unstubAllGlobals();
});

describe("comparar versiones", () => {
  it("ordena por número, no por texto, y tolera prefijos y prereleases", async () => {
    const { compareVersions, isOlderThan } = await import("../apps/cli/src/version.js");
    expect(compareVersions("0.9.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.12", "0.1.12")).toBe(0);
    expect(compareVersions("v0.1.12", "0.1.12-beta.1")).toBe(0);
    expect(compareVersions("0.1.12-rc.1", "0.1.11")).toBeGreaterThan(0);
    expect(compareVersions("0.2", "0.2.0")).toBe(0);
    // `dev` no es comparable: ni bloquea ni avisa.
    expect(compareVersions("dev", "9.9.9")).toBe(0);
    expect(isOlderThan("0.1.9", "0.1.10")).toBe(true);
    expect(isOlderThan("dev", "9.9.9")).toBe(false);
  });
});

describe("qué relación hay entre CLI y servidor", () => {
  it("una conclusión por caso, y lo que no se conoce es «no se sabe», no un error", async () => {
    const { classify } = await compat();
    const k = (cli: string, cfg: Parameters<typeof classify>[2]) => classify(SERVER, cli, cfg).kind;
    expect(k("0.1.9", { version: "0.1.9", minClientVersion: "0.1.0" })).toBe("ok");
    expect(k("0.1.9", { version: "0.1.12", minClientVersion: "0.1.0" })).toBe("cli-behind");
    expect(k("0.1.12", { version: "0.1.9", minClientVersion: "0.1.0" })).toBe("server-behind");
    expect(k("0.1.9", { version: "0.1.12", minClientVersion: "0.1.10" })).toBe("blocked");
    // El mínimo manda sobre todo lo demás: un CLI por debajo está bloqueado aunque el servidor vaya por delante.
    expect(k("0.1.9", { version: "0.1.12", minClientVersion: "0.1.9" })).toBe("cli-behind");
    // Servidor anterior a `minClientVersion`, o sin `/client-config`, o en desarrollo.
    expect(k("0.1.9", { version: "0.1.12" })).toBe("cli-behind");
    expect(k("0.1.9", null)).toBe("unknown");
    expect(k("0.1.9", { version: "dev" })).toBe("unknown");
    expect(k("dev", { version: "0.1.12", minClientVersion: "0.1.12" })).toBe("unknown");
  });
});

describe("la consulta se cachea", () => {
  it("una vez cada 24 h por servidor; `fresh` fuerza; un fallo se reintenta antes", async () => {
    const { serverCompat, compatCachePath } = await compat();
    let t = Date.parse("2026-09-16T10:00:00Z");
    const now = () => t;
    const f = servidor({ version: "0.1.12", minClientVersion: "0.1.0" });

    expect((await serverCompat(SERVER, { now })).fetched).toBe(true);
    expect(existsSync(compatCachePath())).toBe(true);
    expect((await serverCompat(SERVER, { now })).fetched).toBe(false);
    t += 23 * 3600_000;
    expect((await serverCompat(SERVER, { now })).fetched).toBe(false);
    expect((await serverCompat(SERVER, { now, fresh: true })).fetched).toBe(true);
    t += 25 * 3600_000;
    const r = await serverCompat(SERVER, { now });
    expect(r.fetched).toBe(true);
    expect(r.compat.kind).toBe("cli-behind");
    expect(f).toHaveBeenCalledTimes(3);

    // Servidor caído: no se sabe, y en una hora se vuelve a mirar (no en un día).
    servidor(null);
    t += 25 * 3600_000;
    expect((await serverCompat(SERVER, { now })).compat.kind).toBe("unknown");
    t += 30 * 60_000;
    expect((await serverCompat(SERVER, { now })).fetched).toBe(false);
    t += 31 * 60_000;
    expect((await serverCompat(SERVER, { now })).fetched).toBe(true);
  });

  it("una caché corrupta se ignora en vez de romper el comando", async () => {
    const { serverCompat, compatCachePath } = await compat();
    mkdirSync(join(home, ".cortex"), { recursive: true });
    writeFileSync(compatCachePath(), "{ esto no es json");
    servidor({ version: "0.1.9", minClientVersion: "0.1.0" });
    expect((await serverCompat(SERVER)).compat.kind).toBe("ok");
    expect(JSON.parse(readFileSync(compatCachePath(), "utf8")).version).toBe(1);
  });
});

describe("el aviso pasivo", () => {
  it("sin terminal delante no dice nada, aunque haya versión nueva", async () => {
    const { printVersionNotice } = await compat();
    conSesion();
    servidor({ version: "0.1.12", minClientVersion: "0.1.0" });
    const out: string[] = [];
    await printVersionNotice({ tty: false, write: (l) => out.push(l) });
    expect(out).toEqual([]);
  });

  it("con terminal: UNA línea, y no se repite hasta pasado un día", async () => {
    const { printVersionNotice } = await compat();
    conSesion();
    servidor({ version: "0.1.12", minClientVersion: "0.1.0" });
    let t = Date.parse("2026-09-16T10:00:00Z");
    const now = () => t;
    const out: string[] = [];
    await printVersionNotice({ tty: true, now, write: (l) => out.push(l) });
    expect(out).toEqual(["Cortex 0.1.9 → 0.1.12 · cortex upgrade"]);
    await printVersionNotice({ tty: true, now, write: (l) => out.push(l) });
    expect(out).toHaveLength(1);
    t += 25 * 3600_000;
    await printVersionNotice({ tty: true, now, write: (l) => out.push(l) });
    expect(out).toHaveLength(2);
  });

  it("cuando el que va por detrás es el servidor, se lo dice a quien pueda avisar al operador", async () => {
    const { printVersionNotice } = await compat();
    conSesion();
    servidor({ version: "0.1.7", minClientVersion: "0.1.0" });
    const out: string[] = [];
    await printVersionNotice({ tty: true, write: (l) => out.push(l) });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("server at http://cortex.test runs 0.1.7");
    expect(out[0]).toContain("whoever operates it");
  });

  it("calla si no hay sesión en ese servidor, si CI está definida o si se apagó por variable", async () => {
    const { printVersionNotice } = await compat();
    const f = servidor({ version: "0.1.12", minClientVersion: "0.1.0" });
    const out: string[] = [];
    await printVersionNotice({ tty: true, write: (l) => out.push(l) });
    expect(f).not.toHaveBeenCalled(); // sin credenciales ni se consulta

    conSesion();
    process.env.CI = "1";
    await printVersionNotice({ tty: true, write: (l) => out.push(l) });
    delete process.env.CI;
    process.env.CORTEX_NO_VERSION_CHECK = "1";
    await printVersionNotice({ tty: true, write: (l) => out.push(l) });
    expect(out).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("no se enseña con el CLI al día, ni cuando el servidor no responde", async () => {
    const { printVersionNotice } = await compat();
    conSesion();
    const out: string[] = [];
    servidor({ version: "0.1.9", minClientVersion: "0.1.0" });
    await printVersionNotice({ tty: true, write: (l) => out.push(l) });
    servidor(null);
    await printVersionNotice({ tty: true, fresh: true, write: (l) => out.push(l) });
    expect(out).toEqual([]);
  });
});

describe("bloqueo de escrituras por debajo del mínimo", () => {
  it("por debajo del mínimo, un motivo claro que manda a `cortex upgrade`", async () => {
    const { writeBlocker, requireCompatibleServer } = await compat();
    servidor({ version: "0.1.12", minClientVersion: "0.1.10" });
    const why = await writeBlocker();
    expect(why).toContain("0.1.9");
    expect(why).toContain("0.1.10");
    expect(why).toContain("cortex upgrade");
    await expect(requireCompatibleServer()).rejects.toThrow(/cortex upgrade/);
  });

  it("consulta en fresco: un mínimo recién subido frena hoy, no mañana", async () => {
    const { serverCompat, writeBlocker } = await compat();
    servidor({ version: "0.1.12", minClientVersion: "0.1.0" });
    await serverCompat(SERVER); // caché reciente que dice «todo bien»
    servidor({ version: "0.1.12", minClientVersion: "0.1.10" });
    expect(await writeBlocker()).not.toBeNull();
  });

  it("no bloquea lo que no sabe: servidor caído, servidor viejo sin `/client-config`, o dentro del mínimo", async () => {
    const { writeBlocker } = await compat();
    servidor(null);
    expect(await writeBlocker()).toBeNull();
    servidor(404);
    expect(await writeBlocker()).toBeNull();
    servidor({ version: "0.1.12", minClientVersion: "0.1.9" });
    expect(await writeBlocker()).toBeNull();
  });

  it("`cortex mem save` se niega con el mismo mensaje, también en --json", async () => {
    const { run } = await import("../apps/cli/src/commands/mem.js");
    servidor({ version: "0.1.12", minClientVersion: "0.1.10" });
    conSesion();
    const cwd = mkdtempSync(join(tmpdir(), "cortex-compat-cwd-"));
    writeFileSync(join(cwd, ".cortex.json"), JSON.stringify({ slug: "acme" }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await run(["save", "hola", "--cwd", cwd, "--json"]);
      const salida = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { error?: string };
      expect(salida.error).toContain("cortex upgrade");
      expect(process.exitCode).toBe(1);
      // Y ni se intentó guardar: la única petición fue la de versión.
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.every((c) => String(c[0]).endsWith("/client-config"))).toBe(true);
    } finally {
      log.mockRestore();
      process.exitCode = 0;
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

/**
 * Lo crítico. En los hooks y en `cortex mcp` stdout es el canal del protocolo del agente: un
 * byte de más rompe la sesión. Se comprueba de dos formas: que esas entradas ni conocen el
 * módulo del aviso (y el dispatcher las suelta antes de llegar a él), y arrancando el CLI de
 * verdad con una caché que dice «hay versión nueva» para ver que no sale nada por ninguna de
 * las dos salidas.
 */
describe("los hooks y el MCP no dicen NADA", () => {
  const RAIZ = resolve(import.meta.dirname, "..");
  const SRC = join(RAIZ, "apps/cli/src");

  it("ni importan el aviso, ni el dispatcher se lo aplica (son `managed: false`)", () => {
    for (const f of ["commands/hook-context.ts", "commands/hook-capture.ts", "commands/mcp.ts", "mcp/proxy.ts", "mcp/upstream.ts"]) {
      expect(readFileSync(join(SRC, f), "utf8"), f).not.toMatch(/compat\.js/);
    }
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    for (const cmd of ["mcp", "hook-context", "hook-capture"]) {
      expect(index, cmd).toMatch(new RegExp(`"?${cmd}"?: \\{[^}]*managed: false`));
    }
    // El aviso va DESPUÉS del `return` de los `managed: false`.
    expect(index.indexOf("cmd.managed === false")).toBeGreaterThan(0);
    expect(index.indexOf("printVersionNotice()")).toBeGreaterThan(index.indexOf("cmd.managed === false"));
  });

  function corre(args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
    return new Promise((cumplir, fallar) => {
      const hijo = spawn(process.execPath, ["--conditions=development", "--import", "tsx", join(SRC, "index.ts"), ...args], {
        cwd: RAIZ,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env },
      });
      let out = "";
      let err = "";
      hijo.stdout.on("data", (d) => (out += String(d)));
      hijo.stderr.on("data", (d) => (err += String(d)));
      const corte = setTimeout(() => {
        hijo.kill("SIGKILL");
        fallar(new Error("el hook no terminó"));
      }, 20_000);
      hijo.stdin.end();
      hijo.on("exit", (code) => {
        clearTimeout(corte);
        cumplir({ code, out, err });
      });
      hijo.on("error", fallar);
    });
  }

  it("hook-context y hook-capture, con una caché que dice «hay versión nueva», no emiten ni un byte", async () => {
    conSesion();
    const { compatCachePath } = await compat();
    writeFileSync(compatCachePath(), JSON.stringify({ version: 1, servers: { [SERVER]: { at: new Date().toISOString(), version: "9.9.9", minClientVersion: "9.0.0" } } }));
    const repo = mkdtempSync(join(tmpdir(), "cortex-compat-repo-"));
    try {
      const env = { CORTEX_HOME: home, CORTEX_SERVER_URL: "http://127.0.0.1:9" };
      const ctx = await corre(["hook-context", "--format", "text", "--cwd", repo], env);
      expect(ctx).toEqual({ code: 0, out: "", err: "" });
      const cap = await corre(["hook-capture", "--platform", "pi", "--session", join(repo, "no.jsonl"), "--cwd", repo], env);
      expect(cap).toEqual({ code: 0, out: "", err: "" });
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);
});
