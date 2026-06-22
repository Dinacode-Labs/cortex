# Cortex — config IA (harness para agentes)

Bundle **versionado** para que cualquier developer conecte sus agentes de IA a
Cortex (consultar y capturar contexto). Es el *registry de config IA* del §13 del
plan. De momento la instalación es **manual** (abajo); el objetivo es un instalador
único **`cortex sync`** compatible con **Claude Code, Codex y OpenCode**.

> Las herramientas viven como tools MCP (`mcp__cortex__*`), así que **funcionan en
> cualquier agente con soporte MCP**. Lo único específico de cada agente es *cómo se
> registra el MCP* y el formato de skills/comandos.

## Estructura (fuente única)

```
config/
  mcp/cortex.json                 # definición del servidor MCP (compartida)
  skills/cortex-capture/SKILL.md  # skill de captura (formato Claude; cuerpo reutilizable)
  commands/cortex-save.md         # comando/prompt /cortex-save (reutilizable)
  README.md                       # esta guía
```

## Requisitos

```bash
pnpm install
pnpm db:up        # Postgres + pgvector
pnpm db:migrate
# datos: ingesta real o demo (pnpm db:seed requiere CORTEX_SEED_CONFIRM=1)
```
Copia `.env.example` a `.env` (LLM/embeddings). El comando del MCP usa
`pnpm -C <ruta-al-repo-cortex> --filter @cortex/mcp-server start`.

## Instalación por agente (manual, hoy)

### Claude Code
```bash
# MCP (global, en todos tus proyectos)
claude mcp add cortex -s user -- pnpm -C <ruta-al-repo> --filter @cortex/mcp-server start
# Skill + comando (global)
ln -s <ruta-al-repo>/config/skills/cortex-capture ~/.claude/skills/cortex-capture
ln -s <ruta-al-repo>/config/commands/cortex-save.md ~/.claude/commands/cortex-save.md
```
Comprueba con `/mcp` (debe aparecer `cortex` con sus tools).

### Codex
- MCP: en `~/.codex/config.toml`
  ```toml
  [mcp_servers.cortex]
  command = "pnpm"
  args = ["-C", "<ruta-al-repo>", "--filter", "@cortex/mcp-server", "start"]
  ```
- Captura: copia `commands/cortex-save.md` a `~/.codex/prompts/` (prompt) y/o usa el
  cuerpo de `skills/cortex-capture/SKILL.md` como guía en tu `AGENTS.md`.

### OpenCode
- MCP: en la config de OpenCode (`opencode.json`), bloque `mcp` con un servidor
  local que ejecute el mismo comando `pnpm -C <ruta> --filter @cortex/mcp-server start`.
- Captura: registra `commands/cortex-save.md` como comando/prompt; la skill como
  instrucción de agente. *(Revisar el esquema exacto en la doc de OpenCode.)*

> En este repo, skill y comando ya están activos vía symlinks en `.claude/`.

## Tools MCP expuestas
- `save_project_context` — guardar conocimiento (clasifica, resume, detecta duplicados/contradicciones).
- `search_project_context` — búsqueda híbrida (vector + léxico + rerank).
- `get_project_context_pack` — paquete de contexto (decisiones/restricciones/riesgos…); admite `asOf` point-in-time.
- `list_project_decisions` — decisiones vigentes del proyecto.
- `validate_context_entry` — validar / rechazar / marcar obsoleta.
- `ask_project_context` — pregunta en lenguaje natural; recupera y sintetiza con citas.
- `lint_project_context` — salud del conocimiento (contradicciones, duplicados, huecos…).
- `search_project_code` — búsqueda en el código indexado del proyecto.

## Prompts de demo

Antes de tocar un módulo (§15.3):
> Antes de tocar la facturación de **LevelUp Pasión**, usa `get_project_context_pack`
> (o `ask_project_context`) y dime qué debo tener en cuenta.

Capturar tras una tarea (skill `cortex-capture` / `/cortex-save`):
> Guarda en Cortex (LevelUp Pasión) la decisión: "Se cachean las respuestas del ERP
> con Redis para evitar timeouts en facturación."

## Próximo paso: `cortex sync`
Instalador idempotente que haga todo lo de arriba en un comando, detectando qué
agentes hay instalados (Claude/Codex/OpenCode) y registrando MCP + skills + comandos
en cada uno (y a futuro prompts/políticas corporativas).
