/**
 * `@cortex/client` -- all of Cortex's CLIENT-SIDE code: talking to the server over HTTP,
 * reading credentials, resolving a repo's `.cortex.json` and reading agent transcripts.
 *
 * The package rule: **no Postgres, no LLM, nothing heavy**. It depends only on
 * `@cortex/shared` (types and contracts). That is what allows the CLI to be bundled and
 * shipped with `npm i -g` without dragging the whole monorepo onto every dev's laptop
 * (ADR-0025).
 */
export * from "./credentials.js";
export * from "./api-client.js";
export * from "./cortex-api.js";
export * from "./project-config.js";
export * from "./transcript-utils.js";
export * from "./session-readers.js";
export * from "./session-capture.js";
