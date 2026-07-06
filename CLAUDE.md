# CLAUDE.md — Dinacode Cortex

Guía para agentes de IA (Claude Code y similares) que trabajen en este repo.

## Qué es esto

Dinacode Cortex es una **plataforma de memoria corporativa de contexto** para
proyectos software de una consultora. Captura conocimiento (decisiones, restricciones,
incidencias, convenciones…), lo estructura y lo expone a personas y agentes de IA vía
un MCP corporativo. Documento fundacional: `dinacode-cortex-contexto-y-plan-demo.md`.

> Todo el planteamiento es **hipótesis a validar**. Antes de dar algo por definitivo,
> cuestiónalo y deja constancia en `docs/decisions.md`.

## Stack (ver `docs/decisions.md` para el porqué)

- **Monorepo** pnpm (`packages/*` librerías, `apps/*` ejecutables).
- **TypeScript** + ESM (`NodeNext`), ejecución con `tsx`, Node ≥ 20.
- **Postgres 16 + pgvector** como base única (documental + vectorial + relacional).
- **Mastra** para los agentes individuales (classify/enrich/rerank/synthesize/distill
  vía `runAgent`). Sus *workflows* se evaluaron y **no** se adoptaron para la captura
  (ver ADR en `docs/decisions.md`); la captura usa la vía determinista de `core`.
- **MCP** (SDK oficial TS) como interfaz hacia Claude Code / Codex / ChatGPT.
- Embeddings y LLM **enchufables**, con fallback local sin API keys.

## Estructura

```
packages/
  shared/      # tipos del dominio, enums, schemas zod v3 + env (modelo §14 del plan)
  database/    # esquema SQL + migraciones + cliente Postgres
  embeddings/  # proveedor de embeddings enchufable (local | nan | openai | voyage)
  core/        # dominio: save/search/context-pack, dedup/reconciliación, lint,
               # bi-temporal, proyectos/permisos, extract, indexación de código
  agents/      # capa LLM (Mastra + nan/OpenRouter): classifier, graph, rerank,
               # synthesize, distill, reconcile, maintain
apps/
  mcp-server/  # servidor MCP con las 8 tools (stdio + Streamable HTTP autenticado)
  server/      # API HTTP + auth email/OTP (Hono) — la usan CLI, hooks y conectores
  web/         # UI web (Hono SSR, cookie de sesión): src/routes/ + views/ (hono/html,
               # autoescape) + middleware/ + public/ (estáticos)
  cli/         # CLI `cortex` (auth, link, ui, conectores…)
scripts/       # install.sh (instalador remoto; lo sirve apps/server)
config/        # toolbelt distribuible (MCP + skills + comandos) — ver config/README.md
tests/         # unit + integration (Postgres real; ver CONTRIBUTING.md)
docs/
  decisions.md # ADR ligero: decisiones = hipótesis a revisar
  refactor/    # revisión de arquitectura 2026-07 + plan de refactor por fases (EN CURSO)
  audit/       # auditoría integral (junio 2026) + backlog priorizado
```

`@cortex/core` es determinista (sin LLM). La capa de inteligencia (`@cortex/agents`,
Mastra + LLM vía nan/OpenRouter) se inyecta desde cada entrypoint llamando a
`wireLlm()` tras `loadEnv()` (cablea `setClassifier`/`setReranker`/`setReconciler` y
el sink de uso de embeddings; sin `LLM_PROVIDER`, core cae a heurísticas). MCP, API,
UI y CLI consumen `core`. Nota: `agents` usa zod v4 (lo exige Mastra), aislado del
zod v3 del resto del repo; no cruzar schemas entre ambos.

## Reglas de dependencia (qué puede importar qué)

```
shared      → (ninguna dependencia interna)
database    → shared
embeddings  → shared
core        → database, embeddings, shared   # sin LLM ni HTTP saliente
agents      → core, database, shared         # implementa los hooks LLM de core
apps/*      → cualquier package
```

- Los packages **jamás** importan de `apps/*` ni ficheros de otro paquete por ruta.
- Side effects (`loadEnv`, wiring de hooks, `serve`, `process.exit`) **solo** en
  entrypoints, nunca al importar un módulo de librería.
- Tras las fases A y B del refactor estas reglas **se cumplen** (la capa multimodal
  con LLM se inyecta con `setMediaExtractor`, como classifier/reranker/reconciler).
  Excepción documentada: `shared` contiene credentials/api-client/llm-config (I/O
  consciente, ver ADR). No añadas violaciones nuevas.

## Refactor de arquitectura (julio 2026) — COMPLETADO

El refactor por fases (A–D) está **completado** (PRs #2–#20). El informe, el plan y los
~70 hallazgos quedan como registro en `docs/refactor/`; las decisiones (incluidas las
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
pnpm typecheck          # comprobar tipos en todos los paquetes
pnpm test               # tests unitarios (Vitest, sin BD)
pnpm test:integration   # tests de integración (requiere pnpm db:up)
```

Copia `.env.example` a `.env` antes de empezar. Por defecto todo funciona **sin
claves** (embeddings `local`, no semánticos); conecta nan/OpenAI/Voyage cuando
quieras calidad real.

## Convenciones

- Idioma: código y nombres en inglés; comentarios y docs de producto en español.
- Nada de secretos en el repo. `.env` está ignorado; usa `.env.example` como plantilla.
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
