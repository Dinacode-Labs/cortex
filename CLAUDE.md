# CLAUDE.md — Dinacode Cortex

Guía para agentes de IA (Claude Code y similares) que trabajen en este repo.

## Qué es esto

Dinacode Cortex es una **plataforma de memoria corporativa de contexto** para
proyectos software de una consultora. Captura conocimiento (decisiones, restricciones,
incidencias, convenciones…), lo estructura y lo expone a personas y agentes de IA vía
un MCP corporativo. Origen: plan interno de junio de 2026 (en el repo privado `ai-toolbelt`).

> Todo el planteamiento es **hipótesis a validar**. Antes de dar algo por definitivo,
> cuestiónalo y deja constancia en `docs/decisions.md`.
>
> **Nada corporativo en este repo** (ADR-0026): ni clientes por su nombre, ni personas como
> responsables, ni skills de herramientas internas, ni marca. Eso vive en el repo privado
> `Dinacode-Labs/ai-toolbelt`.

## Stack (ver `docs/decisions.md` para el porqué)

- **Monorepo** pnpm (`packages/*` librerías, `apps/*` ejecutables).
- **TypeScript** + ESM (`NodeNext`), Node ≥ 20. En dev se ejecuta con `tsx` sobre las
  fuentes (condición `development` en los `exports`); en producción, `tsc -b` → `dist/`.
- **Postgres 16 + pgvector** como base única (documental + vectorial + relacional).
- **Mastra** para los agentes individuales (classify/enrich/rerank/synthesize/distill
  vía `runAgent`). Sus *workflows* se evaluaron y **no** se adoptaron para la captura
  (ver ADR en `docs/decisions.md`); la captura usa la vía determinista de `core`.
- **MCP** (SDK oficial TS) como interfaz hacia Claude Code / Codex / ChatGPT.
- Embeddings y LLM **enchufables** vía un proveedor `openai-compatible` genérico (NaN por
  defecto en Dinacode; vale Ollama/vLLM/LM Studio para on-prem), con fallback local sin
  API keys. Ver ADR-0024; `nan` sigue como alias obsoleto hasta 0.2.0.

## Estructura

```
packages/
  shared/      # tipos del dominio, enums, schemas zod v3, contratos de la API, env, marca
  client/      # lado cliente: HTTP + credenciales + .cortex.json + transcripts (solo → shared)
  database/    # esquema SQL + migraciones + cliente Postgres
  embeddings/  # proveedor enchufable (local | openai-compatible | openai | voyage)
  core/        # dominio: save/search/context-pack, dedup/reconciliación, lint,
               # bi-temporal, proyectos/permisos, extract, indexación de código
  agents/      # capa LLM (Mastra sobre un endpoint OpenAI-compatible): classifier, graph, rerank,
               # synthesize, distill, reconcile, maintain
apps/
  mcp-server/  # servidor MCP con las 8 tools (stdio + Streamable HTTP autenticado)
  server/      # API HTTP + auth email/OTP (Hono) — la usan CLI, hooks y conectores
  web/         # UI web (Hono SSR, cookie de sesión): src/routes/ + views/ (hono/html,
               # autoescape) + middleware/ + public/ (estáticos)
  cli/         # CLI `cortex` de DEVELOPER (auth, link, ui, setup, toolbelt, doctor,
               # hooks, `mcp`). Ligero: solo depende de client+shared, para poder
               # instalarlo con npm i -g.
               # `cortex mcp` (src/mcp/) hace de proxy stdio → MCP HTTP del servidor: es
               # así como los agentes usan las tools con los permisos del usuario
  admin/       # `cortex-admin`: comandos de OPERADOR (migrate, maintain, ingest,
               # conectores pesados, servicios). Vive en la imagen, no en el portátil
scripts/       # install.sh (instalador remoto; lo sirve apps/server)
plugin/        # claude-code/: lo que Cortex instala en Claude Code (hooks, MCP, skill
               # cortex-capture, /cortex-save). El marketplace se declara en
               # .claude-plugin/marketplace.json, en la raíz (ADR-0032)
config/        # solo el esquema del registry de TERCEROS (toolbelt de la organización,
               # ADR-0014/0026). Lo del producto ya no vive aquí: está en plugin/
tests/         # unit + integration (Postgres real; ver CONTRIBUTING.md)
docs/
  decisions.md # ADR ligero: decisiones = hipótesis a revisar
  roadmap.md   # qué falta (solo el QUÉ técnico; prioridades y responsables, fuera)
  research/    # investigación técnica de interés general
  toolbelt-registry.md
```

> **Qué NO va en este repo** (ADR-0031): decisiones operativas (qué proveedor, con qué clave,
> a qué coste), auditorías de seguridad y planes de refactor con hallazgos por fichero,
> prioridades de negocio y responsables, y datos de clientes (ADR-0026). Todo eso vive en el
> repo privado `Dinacode-Labs/ai-toolbelt`. Regla rápida: si ayuda a alguien de fuera a usar,
> entender o mejorar Cortex, es público; si describe cómo lo operamos nosotros, es privado.

`@cortex/core` es determinista (sin LLM). La capa de inteligencia (`@cortex/agents`,
Mastra sobre un endpoint OpenAI-compatible) se inyecta desde cada entrypoint llamando a
`wireLlm()` tras `loadEnv()` (cablea `setClassifier`/`setReranker`/`setReconciler` y
el sink de uso de embeddings; sin `LLM_PROVIDER`, core cae a heurísticas). MCP, API,
UI y CLI consumen `core`. Nota: `agents` usa zod v4 (lo exige Mastra), aislado del
zod v3 del resto del repo; no cruzar schemas entre ambos.

## Reglas de dependencia (qué puede importar qué)

```
shared      → (ninguna dependencia interna)   # tipos, contratos de la API, utilidades puras
client      → shared                          # lado cliente: HTTP, credenciales, transcripts
database    → shared
embeddings  → shared
core        → client, database, embeddings, shared   # sin LLM; de client solo .cortex.json
agents      → client, core, database, shared         # implementa los hooks LLM de core
apps/*      → cualquier package
```

- Los packages **jamás** importan de `apps/*` ni ficheros de otro paquete por ruta.
- Side effects (`loadEnv`, wiring de hooks, `serve`, `process.exit`) **solo** en
  entrypoints, nunca al importar un módulo de librería.
- Tras las fases A y B del refactor estas reglas **se cumplen** (la capa multimodal
  con LLM se inyecta con `setMediaExtractor`, como classifier/reranker/reconciler).
  No añadas violaciones nuevas.
- **`apps/cli` solo puede depender de `client` y `shared`.** Si un comando necesita la base
  de datos, el modelo o levantar un servicio, va en `apps/admin`. Hay un test que lo
  comprueba (`tests/client-package.test.ts`).
- **`client` se mantiene ligero a propósito**: nada de Postgres, Mastra ni embeddings. Es lo
  que permite empaquetar el CLI y distribuirlo con `npm i -g` sin arrastrar ~95 MB de
  dependencias al portátil de cada dev (ADR-0025). Hay un test que lo comprueba
  (`tests/client-package.test.ts`), porque es una regla fácil de romper sin darse cuenta.

## Refactor de arquitectura (julio 2026) — COMPLETADO

El refactor por fases (A–D) está **completado** (PRs #2–#20). El informe, el plan y los
~70 hallazgos quedan registrados en el repo privado; las decisiones (incluidas las
aplazadas por proporcionalidad) están en `docs/decisions.md` (ADR-0017–0022). Estado
actual del código: reglas de dependencia cumplidas, entrypoints en `apps/cli`, apps
testeables, guards unificados, sin código muerto conocido. Disciplina para nuevos cambios:
un PR por cambio, `typecheck` + tests en verde, sin arreglos «ya que estoy» fuera de alcance.

## Comandos

```bash
pnpm install            # instalar dependencias
pnpm db:up              # levantar Postgres (Docker, puerto host 5433)
pnpm db:migrate         # aplicar migraciones
pnpm db:seed            # cargar datos de demo (proyecto ficticio Acme Portal)
pnpm typecheck          # comprobar tipos en todos los paquetes (sin build)
pnpm build              # tsc -b: compila packages/* y apps a dist/
pnpm cortex <cmd>       # CLI de developer (auth, link, hooks…)
pnpm admin <cmd>        # comandos de operador (migrate, maintain, ingest…)
pnpm clean              # borra los dist/ y los .tsbuildinfo
pnpm test               # tests unitarios (Vitest, sin BD)
pnpm test:integration   # tests de integración (requiere pnpm db:up)
```

Copia `.env.example` a `.env` antes de empezar. Por defecto todo funciona **sin
claves** (embeddings `local`, no semánticos); conecta un endpoint real
(`openai-compatible` con NaN, o OpenAI/Voyage) cuando quieras calidad de verdad.

## Convenciones

- Idioma: código y nombres en inglés; comentarios y docs de producto en español.
- Nada de secretos en el repo. `.env` está ignorado; usa `.env.example` como plantilla.
- **Borrado de secretos**: `scrub()` vive en `@cortex/shared` (función pura, sin I/O).
  `agents` lo aplica antes de mandar nada al LLM y `core` al persistir (`saveContext`,
  `captureBatch`): el servidor no confía en que el cliente haya limpiado. Es idempotente,
  así que aplicarlo en varias capas es seguro. Si añades una vía de entrada de texto,
  pasa por uno de esos dos puntos.
- Cada unidad de conocimiento conserva **fuente, fecha, autor, confianza, estado y
  vigencia** (principio de trazabilidad, §5.5). No conviertas inferencias en hechos.

## Documentación: mantenerla viva (importante)

La documentación es parte del trabajo, no un extra. Al cambiar comportamiento, **actualiza
en el mismo PR** lo afectado: `README.md` (capacidades/arquitectura/comandos/estructura),
`docs/decisions.md` (ADR: decisión = hipótesis a revisar, añade entrada en decisiones de
calado), `docs/roadmap.md`, `CONTRIBUTING.md` y este `CLAUDE.md`.

- **Mantén este `CLAUDE.md` actualizado** cuando cambie el stack, la estructura o las
  convenciones, para que el siguiente agente no opere con información obsoleta.
- **Pódalo de vez en cuando**: relee y **limpia** lo que haya quedado desfasado, duplicado
  o irrelevante. Un CLAUDE.md corto y veraz vale más que uno largo y desactualizado.
- Antes de afirmar que algo "funciona así", verifica que el fichero/función/flag citado
  sigue existiendo (el código manda sobre la doc).
