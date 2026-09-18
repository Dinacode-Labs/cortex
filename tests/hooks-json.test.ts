import { describe, it, expect } from "vitest";
import { hasCortexHooks, mergeHooks, removeHooks, type HookDef, type HooksHolder } from "../apps/cli/src/setup/hooks-json.js";

/**
 * The hooks file belongs to the user and usually has things of their own in it. What has to be
 * guaranteed is that installing Cortex overwrites none of it, that one of our hooks from an
 * earlier version is REPLACED (not duplicated: duplicating it distills the session twice) and
 * that uninstalling leaves the file as it was.
 */
const DEFS: HookDef[] = [
  { event: "SessionStart", kind: "context", matcher: "startup|resume", command: "cortex hook-context", timeout: 20 },
  { event: "SessionEnd", kind: "capture", command: "cortex hook-capture", timeout: 30 },
];

const ajeno = (): HooksHolder => ({
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "my-usual-script" }] }],
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "audit.sh" }] }],
  },
});

describe("mergeHooks", () => {
  it("adds Cortex's hooks without touching the user's", () => {
    const obj = ajeno();
    const res = mergeHooks(obj, DEFS);
    expect(res.changed).toHaveLength(2);
    const start = obj.hooks!.SessionStart!;
    expect(start.flatMap((g) => g.hooks ?? []).map((h) => h.command)).toEqual(["my-usual-script", "cortex hook-context"]);
    expect(obj.hooks!.PreToolUse).toEqual(ajeno().hooks!.PreToolUse);
    expect(start.find((g) => g.matcher === "startup|resume")).toBeDefined();
  });

  it("is idempotent: the second pass changes nothing", () => {
    const obj: HooksHolder = {};
    mergeHooks(obj, DEFS);
    const antes = JSON.stringify(obj);
    const res = mergeHooks(obj, DEFS);
    expect(res.changed).toHaveLength(0);
    expect(JSON.stringify(obj)).toBe(antes);
  });

  it("replaces the old hook in place rather than adding another", () => {
    const obj: HooksHolder = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "pnpm -C /Users/x/.dinacode-cortex cortex hook-context" }] }],
      },
    };
    const res = mergeHooks(obj, DEFS);
    expect(res.replacedLegacy).toHaveLength(1);
    const start = obj.hooks!.SessionStart!.flatMap((g) => g.hooks ?? []);
    expect(start).toHaveLength(1); // no duplicate, and no two distillations
    expect(start[0]!.command).toBe("cortex hook-context");
    expect(start[0]!.timeout).toBe(20);
  });

  it("recognises the package-script syntax too (`hook:context`)", () => {
    const obj: HooksHolder = {
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "pnpm --filter @cortex/core run hook:context" }] }] },
    };
    mergeHooks(obj, DEFS);
    expect(obj.hooks!.SessionStart!.flatMap((g) => g.hooks ?? [])).toHaveLength(1);
  });
});

describe("removeHooks", () => {
  it("removes Cortex's and leaves the user's untouched", () => {
    const obj = ajeno();
    mergeHooks(obj, DEFS);
    removeHooks(obj);
    expect(obj.hooks!.SessionStart!.flatMap((g) => g.hooks ?? []).map((h) => h.command)).toEqual(["my-usual-script"]);
    expect(obj.hooks!.PreToolUse).toBeDefined();
    expect(obj.hooks!.SessionEnd).toBeUndefined(); // an empty group: gone
  });

  it("when there were only our hooks, it does not even leave the `hooks` key", () => {
    const obj: HooksHolder = { otraCosa: 1 };
    mergeHooks(obj, DEFS);
    removeHooks(obj);
    expect(obj.hooks).toBeUndefined();
    expect(obj.otraCosa).toBe(1);
  });
});

describe("hasCortexHooks", () => {
  it("tells a file with our hooks apart from one without them", () => {
    expect(hasCortexHooks(ajeno())).toBe(false);
    const obj = ajeno();
    mergeHooks(obj, DEFS);
    expect(hasCortexHooks(obj)).toBe(true);
  });
});
