import { describe, it, expect } from "vitest";
import { hasCortexHooks, mergeHooks, removeHooks, type HookDef, type HooksHolder } from "../apps/cli/src/setup/hooks-json.js";

/**
 * El fichero de hooks es del usuario y suele tener cosas suyas. Lo que hay que garantizar es
 * que instalar Cortex no le pisa nada, que un hook nuestro de una versión anterior se
 * SUSTITUYE (no se duplica: duplicarlo destila la sesión dos veces) y que desinstalar deja
 * el fichero como estaba.
 */
const DEFS: HookDef[] = [
  { event: "SessionStart", kind: "context", matcher: "startup|resume", command: "cortex hook-context", timeout: 20 },
  { event: "SessionEnd", kind: "capture", command: "cortex hook-capture --platform claude", timeout: 30 },
];

const ajeno = (): HooksHolder => ({
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "mi-script-de-siempre" }] }],
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit.sh" }] }],
  },
});

describe("mergeHooks", () => {
  it("añade los hooks de Cortex sin tocar los del usuario", () => {
    const obj = ajeno();
    const res = mergeHooks(obj, DEFS);
    expect(res.changed).toHaveLength(2);
    const start = obj.hooks!.SessionStart!;
    expect(start.flatMap((g) => g.hooks ?? []).map((h) => h.command)).toEqual(["mi-script-de-siempre", "cortex hook-context"]);
    expect(obj.hooks!.PreToolUse).toEqual(ajeno().hooks!.PreToolUse);
    expect(start.find((g) => g.matcher === "startup|resume")).toBeDefined();
  });

  it("es idempotente: la segunda pasada no cambia nada", () => {
    const obj: HooksHolder = {};
    mergeHooks(obj, DEFS);
    const antes = JSON.stringify(obj);
    const res = mergeHooks(obj, DEFS);
    expect(res.changed).toHaveLength(0);
    expect(JSON.stringify(obj)).toBe(antes);
  });

  it("sustituye el hook antiguo en su sitio en vez de añadir otro", () => {
    const obj: HooksHolder = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "pnpm -C /Users/x/.dinacode-cortex cortex hook-context" }] }],
      },
    };
    const res = mergeHooks(obj, DEFS);
    expect(res.replacedLegacy).toHaveLength(1);
    const start = obj.hooks!.SessionStart!.flatMap((g) => g.hooks ?? []);
    expect(start).toHaveLength(1); // ni duplicado, ni dos destilaciones
    expect(start[0]!.command).toBe("cortex hook-context");
    expect(start[0]!.timeout).toBe(20);
  });

  it("reconoce también la sintaxis de scripts de paquete (`hook:context`)", () => {
    const obj: HooksHolder = {
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "pnpm --filter @cortex/core run hook:context" }] }] },
    };
    mergeHooks(obj, DEFS);
    expect(obj.hooks!.SessionStart!.flatMap((g) => g.hooks ?? [])).toHaveLength(1);
  });
});

describe("removeHooks", () => {
  it("saca lo de Cortex y deja lo del usuario intacto", () => {
    const obj = ajeno();
    mergeHooks(obj, DEFS);
    removeHooks(obj);
    expect(obj.hooks!.SessionStart!.flatMap((g) => g.hooks ?? []).map((h) => h.command)).toEqual(["mi-script-de-siempre"]);
    expect(obj.hooks!.PreToolUse).toBeDefined();
    expect(obj.hooks!.SessionEnd).toBeUndefined(); // grupo vacío: fuera
  });

  it("si solo había hooks nuestros, no deja ni la clave `hooks`", () => {
    const obj: HooksHolder = { otraCosa: 1 };
    mergeHooks(obj, DEFS);
    removeHooks(obj);
    expect(obj.hooks).toBeUndefined();
    expect(obj.otraCosa).toBe(1);
  });
});

describe("hasCortexHooks", () => {
  it("distingue un fichero con hooks nuestros de uno sin ellos", () => {
    expect(hasCortexHooks(ajeno())).toBe(false);
    const obj = ajeno();
    mergeHooks(obj, DEFS);
    expect(hasCortexHooks(obj)).toBe(true);
  });
});
