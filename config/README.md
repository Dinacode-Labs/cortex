# Cortex — config IA (harness para agentes)

Bundle **versionado** para que cualquier developer conecte sus agentes de IA a
Cortex (consultar y capturar contexto). Es el *registry de config IA* del §13 del
plan. De momento la instalación es **manual** (abajo); el objetivo es un instalador
único **`cortex sync`** compatible con **Claude Code, Codex, OpenCode y Hermes**
(Hermes Agent de Nous Research).

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

## Registry (`config/toolbelt.json`) — PR-able

`config/toolbelt.json` es la **fuente única** del toolbelt de Dinacode: qué MCPs y
skills debe tener un dev. **Añade/mejora una skill o MCP con un PR** a este repo;
con `cortex sync` (tras `git pull`) se reparte/actualiza. Cortex reparte
**configuración, nunca credenciales**: cada entrada documenta en `auth` qué debe
configurar el dev por su cuenta. Las skills propias se vendorizan en
`config/skills/`; los MCPs se declaran por comando/URL (uvx/npx/http) — no se copian.

## Instalación con `cortex sync` (recomendado)

Instalador idempotente que lee el registry e instala/actualiza en los agentes
detectados (Claude Code / Codex / OpenCode / Hermes):

```bash
pnpm cortex:sync                 # dry-run: muestra el plan, no escribe
pnpm cortex:sync --apply         # aplica en todos los agentes detectados
pnpm cortex:sync --apply --agents claude,codex
pnpm cortex:sync --doctor        # estado de auth por tool (qué falta configurar)
```

- **Preserva** lo ya configurado (no machaca un MCP con auth existente; solo añade lo que falta).
- Un MCP que **requiere env** (p.ej. `plane`: `PLANE_API_KEY`…) se **omite** si no
  está exportado → `--doctor` te dice qué falta; expórtalo y re-ejecuta.
- **Actualizar**: las skills van por **symlink** → un `git pull` ya las actualiza;
  re-ejecuta `--apply` para re-registrar MCPs/comandos nuevos.
- OpenCode es best-effort (si no puede editar `opencode.json`, lo indica).
- Skills (SKILL.md) son nativas en Claude; en Codex/OpenCode se usan vía MCP +
  comandos/prompts.

## Instalación por agente (manual, alternativa)

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

### Hermes (Nous Research)
- MCP: en `~/.hermes/config.yaml` (lo gestiona `cortex sync`, preservando lo demás):
  ```yaml
  mcp_servers:
    cortex:
      command: pnpm
      args: ["-C", "<ruta-al-repo>", "--filter", "@cortex/mcp-server", "start"]
      enabled: true
  ```
  Alternativa CLI: `hermes mcp add` (+ `hermes mcp test cortex`, `/reload-mcp`).
  Para un Hermes **remoto/hosted** usa transporte HTTP (`url:`) apuntando a un Cortex
  desplegado (ver despliegue). Las skills de Hermes siguen el estándar agentskills.io
  (las tools de Cortex ya llegan por el MCP).

> En este repo, skill y comando ya están activos vía symlinks en `.claude/`.

## Hooks (bucle automático, Claude Code)
`cortex sync` también instala en `~/.claude/settings.json` dos hooks que **automatizan**
el bucle (el repo se apunta a un proyecto con un `.cortex.json` → `{"project":"…"}`):
- **SessionStart** → inyecta el **context-pack** del proyecto (`hook:context`).
- **SessionEnd** → **auto-captura** la sesión destilándola en Cortex (`hook:capture`).

Preserva los hooks existentes. Otros agentes (Codex/OpenCode/Hermes) usan los mismos
scripts vía sus propios adaptadores (pendiente). Ver `docs/research/hooks-integration.md`.

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
> Antes de tocar el módulo de pagos de **<Proyecto>**, usa `get_project_context_pack`
> (o `ask_project_context`) y dime qué debo tener en cuenta.

Capturar tras una tarea (skill `cortex-capture` / `/cortex-save`):
> Guarda en Cortex (<Proyecto>) la decisión: "Se añadió caché en X para evitar
> timeouts en Y."

## Skills vendorizadas
`config/skills/` contiene copias curadas para distribución interna de Dinacode
(cortex-capture es propia; plane-api/google-chat/bkt/expect son herramientas de uso
interno). Se excluyen secretos: la auth de cada skill vive en keyring/env/config del
dev, nunca en el repo.

## A futuro
- Ampliar el registry con **prompts/políticas corporativas** (§13) y un
  **`--remove`** (desinstalar).
- Empaquetar `cortex sync` como bin `cortex` (hoy `pnpm cortex:sync`).
