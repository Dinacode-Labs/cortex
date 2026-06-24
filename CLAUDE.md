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
- **Mastra** para agentes/workflows (hipótesis a validar en código).
- **MCP** (SDK oficial TS) como interfaz hacia Claude Code / Codex / ChatGPT.
- Embeddings y LLM **enchufables**, con fallback local sin API keys.

## Estructura

```
packages/
  shared/      # tipos del dominio, enums, schemas zod (modelo §14 del plan)
  database/    # esquema SQL + migraciones + cliente Postgres
  embeddings/  # proveedor de embeddings enchufable (local | openai | voyage)
  core/        # operaciones de dominio: save/search/context-pack + loops de mejora
  agents/      # capa LLM: clasificación (OpenRouter/DeepSeek) + síntesis (Mastra)
apps/
  mcp-server/  # servidor MCP (stdio) con las 5 tools corporativas
  web/         # UI web de demo (Hono, render en servidor)
docs/
  decisions.md # ADR ligero: decisiones = hipótesis a revisar
  demo-script.md
```

`@cortex/core` es determinista (sin LLM). La capa de inteligencia (`@cortex/agents`,
Mastra + LLM por OpenRouter) se inyecta con `setClassifier()` desde los entrypoints
cuando hay LLM (`LLM_PROVIDER=openrouter`). Tanto el MCP como la UI consumen `core`.
Nota: `agents` usa zod v4 (lo exige Mastra), aislado del zod v3 del resto del repo;
no cruzar schemas entre ambos.

## Comandos

```bash
pnpm install            # instalar dependencias
pnpm db:up              # levantar Postgres (Docker, puerto host 5433)
pnpm db:migrate         # aplicar migraciones
pnpm db:seed            # cargar datos de demo (proyecto ficticio Acme Portal)
pnpm typecheck          # comprobar tipos en todos los paquetes
```

Copia `.env.example` a `.env` antes de empezar. Por defecto todo funciona **sin
claves** (embeddings `local`); conecta OpenAI/Voyage/Anthropic cuando quieras
calidad real.

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
