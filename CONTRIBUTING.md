# Contribuir a Dinacode Cortex

Producto **interno** de Dinacode. Mejoras, arreglos y nuevas capacidades llegan por **PR**
contra este repo. Esta guía explica cómo está montado y dónde tocar cada cosa.

## Puesta en marcha (dev)

```bash
pnpm install
cp .env.example .env          # embeddings/LLM; sin claves funciona en modo local
pnpm db:up && pnpm db:migrate # Postgres + pgvector (Docker) + esquema
pnpm typecheck                # comprobar tipos en todo el monorepo
```
No hay build de frontend ni paso de compilación: todo se ejecuta con **tsx** (TS/ESM).

## Mapa del repo (dónde vive cada cosa)

| Quieres… | Toca… |
| --- | --- |
| Operación de dominio (captura, búsqueda, pack, lint, proyectos, auth) | `packages/core/src/` (**determinista, sin LLM**) |
| Capa LLM (clasificar, grafo, rerank, síntesis, destilar, fusionar, reconciliar) | `packages/agents/src/` (Agents de **Mastra**) |
| Modelo de dominio (tipos, enums, schemas zod) | `packages/shared/src/domain.ts` |
| Esquema/SQL/cliente Postgres | `packages/database/` (migraciones en `migrations/`) |
| Proveedor de embeddings | `packages/embeddings/` |
| Servidor MCP (stdio) · UI web · API+auth · CLI | `apps/mcp-server` · `apps/web` · `apps/server` · `apps/cli` |
| Toolbelt distribuible (MCP/skills/comandos) | `config/toolbelt.json` + `config/skills/` + `config/commands/` |
| Instalador (`cortex sync`) + hooks + shim CLI | `scripts/cortex-sync.ts` |

**Regla de oro de dependencias:** `core` NO importa `agents` (evita ciclo). La inteligencia
se **inyecta** desde los entrypoints: `setClassifier()`, `setReranker()`, `setReconciler()`.
Si una operación de core necesita LLM, define el hook en core y enchúfalo en agents.

## Recetas frecuentes

- **Añadir un MCP / skill / comando al toolbelt** → edítalo en `config/toolbelt.json`
  (y vendoriza la skill en `config/skills/<name>/`). `cortex sync` lo reparte. **Nunca**
  metas credenciales: declara el `env` que requiere y se omite si falta (`--doctor` lo lista).
- **Añadir un conector de fuente** → `packages/core/src/connect-<x>.ts`. Reutiliza la capa
  `extract` (multimodal) y `saveWithReconciliation` (dedup/merge). Incremental por
  `sourceReference`. Enrútalo en el dispatcher (`apps/cli/src/index.ts`).
- **Soportar un formato de fichero nuevo** → `packages/core/src/extract.ts`
  (`SUPPORTED_EXTS` + un branch en `extractFileText`). Todos los conectores lo heredan.
- **Cambiar el esquema** → nueva migración `packages/database/migrations/NNNN_desc.sql`
  (idempotente, `IF NOT EXISTS`). El runner aplica en orden las no registradas.
- **Nuevo rol de agente LLM** → añádelo a `AgentRole` + `INSTRUCTIONS` + el registro en
  `packages/agents/src/mastra.ts` (JSON_ROLES si devuelve JSON).
- **Nuevo subcomando `cortex`** → entrada en `COMMANDS` de `apps/cli/src/index.ts`
  apuntando al script; si el script tiene guard `import.meta.url === argv[1]`, se activa solo.

## Convenciones

- **Idioma:** código y nombres en **inglés**; comentarios y docs de producto en **español**.
- **Sin secretos en el repo.** `.env` está ignorado; usa `.env.example`. Scrub de secretos
  antes de mandar contenido a un LLM o guardarlo (sesiones/ficheros).
- **Trazabilidad (§5.5):** cada unidad de conocimiento conserva fuente, fecha, autor,
  confianza, estado y vigencia. No conviertas inferencias en hechos (confianza baja para lo auto).
- **zod aislado:** `agents` usa **zod v4** (lo exige Mastra); el resto **zod v3**. No cruces schemas.
- **Calidad:** `pnpm typecheck` y `pnpm test` (Vitest) deben pasar. Los tests viven en
  `tests/` (unitarios de lógica pura/determinista: auth/permisos, vínculo/slug, parsers de
  sesiones, schemas). Añade tests con tu PR cuando toques lógica testeable; para lo que
  necesita BD/LLM, verifica a mano y deja constancia.

## Flujo de PR

1. Rama desde `main`; cambios enfocados.
2. `pnpm typecheck` en verde.
3. **Actualiza la documentación afectada** (ver abajo) — un PR que cambia comportamiento
   sin tocar docs está incompleto.
4. PR con: qué cambia, por qué, y cómo lo verificaste.

## Documentación (mantenerla viva)

Mantener los docs al día es parte del trabajo, no un extra:
- **`README.md`** — capacidades, arquitectura, comandos, estructura.
- **`docs/decisions.md`** — ADR ligero: cada decisión es una **hipótesis a revisar**
  (decisión, por qué, y "revisar cuando…"). Añade una entrada al tomar una decisión de calado.
- **`docs/roadmap.md`** — lo que queda / lo recién hecho.
- **`docs/research/`** — investigación que respalda decisiones (memoria, hooks, multimodal…).
- **`CLAUDE.md`** — guía para agentes de IA que trabajen el repo; mantenerla actualizada y
  podarla periódicamente para que no acumule ruido ni quede obsoleta.
