import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as yamlParse } from "yaml";

/**
 * Publishing a version is one of the few things that cannot be undone: once
 * `@dinacodelabs/cortex@0.2.0` is on npm, that number can never be reused. So what is checked
 * here is that every version in the repo moves together, and that the workflow has not lost the
 * step that verifies it before publishing anything.
 */
const ROOT = resolve(import.meta.dirname, "..");
const json = (p: string): any => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

describe("versiones del monorepo", () => {
  const root = json("package.json").version as string;

  it("every package and app is on the same version", () => {
    const files = execFileSync("sh", ["-c", "ls packages/*/package.json apps/*/package.json"], { cwd: ROOT, encoding: "utf8" })
      .trim()
      .split("\n");
    const distintas = files.map((f) => [f, json(f).version]).filter(([, v]) => v !== root);
    expect(distintas).toEqual([]);
  });

  it("so are the plugin and its marketplace, or Claude offers an update to something that does not exist", () => {
    expect(json("plugin/claude-code/.claude-plugin/plugin.json").version).toBe(root);
    const market = json(".claude-plugin/marketplace.json");
    expect(market.plugins.find((p: { name: string }) => p.name === "cortex").version).toBe(root);
  });

  it("the CHANGELOG has a section for this version", () => {
    const notas = execFileSync("node", ["scripts/changelog-notes.mjs", root], { cwd: ROOT, encoding: "utf8" });
    expect(notas.trim().length).toBeGreaterThan(100);
  });
});

describe("workflow de release", () => {
  const wf = yamlParse(readFileSync(resolve(ROOT, ".github/workflows/release.yml"), "utf8")) as {
    on: Record<string, unknown>;
    jobs: Record<string, { needs?: string | string[]; steps?: { name?: string; run?: string; uses?: string }[] }>;
  };

  it("it is triggered by a version tag, not by a push to main", () => {
    expect(JSON.stringify(wf.on)).toContain("v*.*.*");
    expect(JSON.stringify(wf.on)).not.toContain("branches");
  });

  it("nothing is published without verify having passed first", () => {
    for (const job of ["image", "npm"]) {
      expect(JSON.stringify(wf.jobs[job]!.needs), job).toContain("verify");
    }
    expect(JSON.stringify(wf.jobs["github-release"]!.needs)).toContain("image");
  });

  /**
   * Every job starts with its own checkout and nothing built. The CLI's bundle is assembled
   * from the monorepo packages' `dist/`, so the publishing job has to compile them itself.
   * `verify` doing it is no use: that is another machine.
   *
   * This took down an entire release -- with the image already published and the tag already
   * pushed -- because tsup could not resolve `@cortex/client`.
   */
  it("the job that publishes to npm builds the monorepo first, and in that order", () => {
    const pasos = wf.jobs.npm!.steps ?? [];
    const iBuild = pasos.findIndex((p) => p.run?.trim() === "pnpm build");
    const iPublish = pasos.findIndex((p) => p.run?.includes("publish"));
    expect(iBuild, "`pnpm build` is missing from the npm job").toBeGreaterThanOrEqual(0);
    expect(iPublish).toBeGreaterThanOrEqual(0);
    expect(iBuild, "it builds after publishing, which is no use at all").toBeLessThan(iPublish);
  });

  it("verify checks that the tag matches the repo's versions", () => {
    const pasos = JSON.stringify(wf.jobs.verify!.steps);
    expect(pasos).toContain("GITHUB_REF_NAME");
    expect(pasos).toContain("changelog-notes");
    // And it runs everything CI runs: publishing something that fails the tests cannot be undone.
    for (const cmd of ["pnpm typecheck", "pnpm test", "pnpm test:integration", "pnpm build"]) {
      expect(pasos, cmd).toContain(cmd);
    }
  });

  it("the Release notes come from the CHANGELOG, not from the commits", () => {
    const pasos = JSON.stringify(wf.jobs["github-release"]!.steps);
    expect(pasos).toContain("changelog-notes.mjs");
    expect(pasos).toContain("body_path");
  });
});
