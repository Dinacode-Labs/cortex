/**
 * `@cortex/client` — todo el código del LADO CLIENTE de Cortex: hablar con el servidor por
 * HTTP, leer credenciales, resolver el `.cortex.json` de un repo y leer los transcripts de
 * los agentes.
 *
 * La regla del paquete: **nada de Postgres, nada de LLM, nada pesado**. Solo depende de
 * `@cortex/shared` (tipos y contratos). Es lo que permite empaquetar el CLI y distribuirlo
 * con `npm i -g` sin arrastrar el monorepo entero al portátil de cada dev (ADR-0025).
 */
export * from "./credentials.js";
export * from "./api-client.js";
export * from "./cortex-api.js";
export * from "./project-config.js";
export * from "./transcript-utils.js";
export * from "./session-readers.js";
export * from "./session-capture.js";
