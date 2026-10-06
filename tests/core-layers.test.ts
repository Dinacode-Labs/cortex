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
      .filter((file) => !mayTouchInfrastructure(file))
      .flatMap((file) => importsOf(file).filter(isInfrastructure).map((spec) => `${file} imports ${spec}`));
    expect(offenders).toEqual([]);
  });

  it("nothing that runs on the server depends on the laptop's client package, and core not on the LLM layer", () => {
    const dependenciesOf = (pkg: string): string[] =>
      Object.keys(JSON.parse(readFileSync(resolve(ROOT, `packages/${pkg}/package.json`), "utf8")).dependencies ?? {});
    const offenders = [
      ...["core", "agents"].flatMap((pkg) => dependenciesOf(pkg).filter((d) => d === "@cortex/client").map((d) => `${pkg} → ${d}`)),
      ...dependenciesOf("core").filter((d) => d === "@cortex/agents").map((d) => `core → ${d}`),
    ];
    expect(offenders).toEqual([]);
  });

  // A top-level infrastructure/rows.ts held three modules' row mappers: reading a module did not
  // show how its rows become objects.
  it("every layer lives inside a module, none is shared at the root of core", () => {
    expect(files.filter((file) => /^(domain|application|infrastructure)\//.test(file))).toEqual([]);
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
