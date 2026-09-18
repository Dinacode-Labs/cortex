# CLAUDE.md — Cortex

Guía para agentes de IA (Claude Code y similares) que trabajen en este repo.

## Qué es esto

Cortex es una **memoria de contexto para proyectos software**. Captura conocimiento
(decisiones, restricciones, incidencias, convenciones…), lo estructura y lo expone a personas
y agentes de IA por un MCP autenticado y unos hooks que cierran el bucle: el agente arranca
sabiendo el proyecto y, al terminar, lo aprendido vuelve a la memoria.

Se despliega como servidor (Docker) y se usa con un CLI que se instala de npm. Ningún
portátil necesita base de datos ni claves de modelo.

> Todo el planteamiento es **hipótesis a validar**. Antes de dar algo por definitivo,
> cuestiónalo y deja constancia en `docs/decisions.md`.
>
> **Nada corporativo en este repo** (ADR-0026): ni clientes por su nombre, ni personas como
> responsables, ni skills de herramientas internas, ni marca. Eso vive en el repo privado
> `Dinacode-Labs/ai-toolbelt`.

## Reglas

Lo que hay que respetar al escribir código aquí vive en `.claude/rules/`, un fichero por tema.
Claude Code las carga solo, así que **no las importes desde aquí ni dupliques su contenido**
(ADR-0064):

- Siempre: `arquitectura.md`, `tests.md`, `documentacion.md`.
- Al tocar la parte que les toca (`paths:` en su cabecera): `estilo-typescript.md`, `api-http.md`,
  `cli.md`, `web.md`, `agentes-llm.md`.

Si trabajas con otro agente que no lee `.claude/rules/`, esos ficheros siguen siendo la
referencia: están escritos para cualquiera.

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
               # autoescape) + middleware/ + public/ (estáticos). Gira alrededor del
               # proyecto: `/` lista proyectos y `/p/<slug>/…` son sus secciones
               # (ADR-0050). LEE `docs/design.md` antes de tocarla: dice para qué es
               # y para qué no, y evita volver a meter pantallas que no se pueden usar
  cli/         # CLI `cortex` de DEVELOPER (auth, link, ui, setup, toolbelt, doctor,
               # hooks, `mem`, `mcp`). Ligero: solo depende de client+shared, para poder
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
  design.md    # para qué sirve la UI web y para qué no; léelo ANTES de tocar apps/web
  roadmap.md   # qué falta (solo el QUÉ técnico; prioridades y responsables, fuera)
  research/    # investigación técnica de interés general
  toolbelt-registry.md
```

`@cortex/core` es determinista (sin LLM): la capa de inteligencia se **inyecta** desde cada
entrypoint con `wireLlm()`. Cómo y por qué, en `.claude/rules/arquitectura.md`.

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
pnpm --filter @dinacodelabs/cortex build   # bundle del CLI (tsup) → apps/cli/dist/cortex.js
```

Copia `.env.example` a `.env` antes de empezar. Por defecto todo funciona **sin
claves** (embeddings `local`, no semánticos); conecta un endpoint real
(`openai-compatible` con NaN, o OpenAI/Voyage) cuando quieras calidad de verdad.

## Mantener esto vivo

Actualiza este documento y `.claude/rules/` cuando cambie el stack, la estructura o una
convención, para que el siguiente agente no opere con información obsoleta. Y **pódalos**: un
CLAUDE.md corto y veraz vale más que uno largo y desfasado.
