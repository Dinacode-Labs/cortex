import { describe, it, expect } from "vitest";
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CORE = "packages/core/src/";

const INFRASTRUCTURE_IMPORTS = [
  "@cortex/database",
  "@cortex/embeddings",
  "@cortex/client",
  "postgres",
  "nodemailer",
  "mammoth",
  "unpdf",
  "xlsx",
];

const KNOWN_VIOLATIONS: Record<string, string> = {
  "auth/auth.ts": "auth module",
  "auth/email-smtp.ts": "auth module",
  "capture/capture.ts": "capture module",
  "capture/code.ts": "capture module",
  "capture/extract.ts": "capture module",
  "capture/session-captures.ts": "capture module",
  "graph/across.ts": "graph module",
  "graph/entities.ts": "graph module",
  "index.ts": "dropping core's dependency on client",
  "knowledge/context-pack.ts": "knowledge module",
  "knowledge/dedup.ts": "knowledge module",
  "knowledge/lint.ts": "knowledge module",
  "knowledge/queries.ts": "knowledge module",
  "knowledge/save.ts": "knowledge module",
  "knowledge/search.ts": "knowledge module",
  "projects/projects.ts": "projects module",
  "storage/vectors.ts": "knowledge module",
};

const files = globSync(`${CORE}**/*.ts`, { cwd: ROOT }).map((f) => f.slice(CORE.length)).sort();
const importsOf = (file: string): string[] =>
  [...readFileSync(resolve(ROOT, CORE, file), "utf8").matchAll(/(?:from\s+|import\()\s*"([^"]+)"/g)].map((m) => m[1]!);
const layerOf = (file: string): string | null => file.match(/(?:^|\/)(domain|application|infrastructure)\//)?.[1] ?? null;
const isInfrastructure = (spec: string): boolean =>
  INFRASTRUCTURE_IMPORTS.some((lib) => spec === lib || spec.startsWith(`${lib}/`));
const mayTouchInfrastructure = (file: string): boolean =>
  layerOf(file) === "infrastructure" || file === "composition.ts";

/**
 * Use cases built their own adapters and called `getSql()` directly, so nothing in core could
 * be swapped and nobody could tell domain from persistence by reading it (ADR-0085).
 */
describe("core's layers", () => {
  it("only the infrastructure layer and the composition touch the database, embeddings or an external library", () => {
    const offenders = files
      .filter((file) => !mayTouchInfrastructure(file) && !(file in KNOWN_VIOLATIONS))
      .flatMap((file) => importsOf(file).filter(isInfrastructure).map((spec) => `${file} imports ${spec}`));
    expect(offenders).toEqual([]);
  });

  it("the list of files still to move is honest: each one exists and still needs moving", () => {
    const stale = Object.keys(KNOWN_VIOLATIONS).filter(
      (file) => !files.includes(file) || !importsOf(file).some(isInfrastructure),
    );
    expect(stale).toEqual([]);
  });

  it("the domain imports neither use cases nor adapters, and use cases do not import adapters", () => {
    const forbidden: Record<string, string[]> = {
      domain: ["/application/", "/infrastructure/"],
      application: ["/infrastructure/"],
    };
    const offenders = files.flatMap((file) => {
      const banned = forbidden[layerOf(file) ?? ""] ?? [];
      return importsOf(file)
        .filter((spec) => spec.startsWith(".") && banned.some((layer) => `/${spec}`.includes(layer)))
        .map((spec) => `${file} imports ${spec}`);
    });
    expect(offenders).toEqual([]);
  });
});
