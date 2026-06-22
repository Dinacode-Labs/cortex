# Dinacode Cortex

Plataforma de **memoria corporativa de contexto** para proyectos software de una
consultora. Captura conocimiento (decisiones, restricciones, incidencias,
convenciones…), lo estructura en una capa híbrida (documental + vectorial +
relacional) y lo expone a personas y agentes de IA mediante un **MCP corporativo**.

Documento fundacional y plan: [`dinacode-cortex-contexto-y-plan-demo.md`](./dinacode-cortex-contexto-y-plan-demo.md).
Decisiones técnicas (hipótesis a validar): [`docs/decisions.md`](./docs/decisions.md).

> Estado: **demo funcional en construcción**. Lo implementado hasta ahora cubre
> captura, almacenamiento híbrido, búsqueda semántica, context packs, loops de
> mejora (duplicados/contradicciones) y el servidor MCP. Pendiente: agentes
> Mastra (capa de inteligencia con LLM) y UI.

## Arquitectura (demo)

```
Claude Code / Codex / ChatGPT
        │  (MCP)
        ▼
  @cortex/mcp-server         apps/mcp-server   — 5 tools corporativas
        │
        ▼
  @cortex/core               packages/core     — operaciones de dominio
        │                                         (clasificar, entidades,
        │                                          embeddings, loops de mejora)
        ├── @cortex/embeddings packages/embeddings — proveedor enchufable
        │                                            (local | openai | voyage)
        └── @cortex/database   packages/database   — Postgres + pgvector
  @cortex/shared             packages/shared   — modelo de dominio (zod)
```

La capa **Mastra** (agentes/workflows) se superpondrá sobre `@cortex/core` como
capa de inteligencia; por eso el core es determinista y funciona sin claves LLM.

## Puesta en marcha

Requisitos: Node ≥ 20, pnpm, Docker.

```bash
pnpm install
cp .env.example .env      # por defecto: embeddings locales, sin claves
pnpm db:up                # Postgres + pgvector (Docker, puerto host 5433)
pnpm db:migrate           # crea el esquema
pnpm db:seed              # datos de demo: proyecto Acme Portal
```

Para conectar Claude Code al MCP, ver [`config/claude-code/README.md`](./config/claude-code/README.md).
Para recorrer la demo, ver [`docs/demo-script.md`](./docs/demo-script.md).

## Embeddings y calidad de búsqueda

Por defecto se usan embeddings **locales deterministas** (sin API keys) para que
todo arranque sin configurar nada. **No son semánticos**: capturan solape léxico,
suficiente para demostrar el cableado. Para relevancia real:

```bash
# en .env
EMBEDDINGS_PROVIDER=openai   # o voyage
OPENAI_API_KEY=...
```

Tras cambiar de proveedor, re-siembra (`pnpm db:seed`) para regenerar embeddings.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `pnpm db:up` / `pnpm db:down` | Levanta / para Postgres |
| `pnpm db:migrate` | Aplica migraciones |
| `pnpm db:seed` | Carga datos de demo (idempotente) |
| `pnpm mcp` | Arranca el servidor MCP (stdio) |
| `pnpm typecheck` | Comprueba tipos en todos los paquetes |
