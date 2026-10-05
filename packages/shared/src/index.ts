/**
 * Cortex domain model.
 *
 * It mirrors the hypothetical data model in section 14 of the founding document. It is a
 * minimal proposal for the demo and should be questioned (see docs/decisions.md).
 *
 * Enums are defined as zod schemas (the source of truth for validation in MCP and Mastra)
 * and the TypeScript types are derived with z.infer.
 */
export * from "./domain/memo.js";
export * from "./domain/entity.js";
export * from "./domain/relation.js";
export * from "./domain/source.js";
export * from "./env.js";
export * from "./brand.js";
export * from "./capture-protocol.js";
export * from "./concurrency.js";
export * from "./scrub.js";
export * from "./llm-config.js";
export * from "./api-contract.js";
export * from "./chunk.js";
