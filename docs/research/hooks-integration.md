# Investigación — Hooks (Claude Code y otros) para Cortex

Cómo aprovechar los **hooks** del agente para automatizar el bucle de Cortex
("trabajas → Cortex recuerda/aprende") sin que el dev tenga que invocar nada, cómo lo
hacen otros proyectos, y la **fricción** de que no todas las plataformas los tengan
igual. Complementa al plugin (`cortex setup`) y a la skill `cortex-capture`.

## Qué ganaríamos con hooks (los 2 bucles clave)

1. **Inyectar contexto automáticamente (pull).** En `SessionStart` y/o
   `UserPromptSubmit`, un hook llama a Cortex y **inyecta** el context-pack del proyecto
   (decisiones vigentes, restricciones, riesgos) en la ventana del modelo vía
   `additionalContext`. El agente arranca "sabiendo" el proyecto, sin que nadie pida
   `get_project_context_pack`. RAG transparente por prompt.
2. **Capturar el trabajo automáticamente (push).** En `Stop`/`SessionEnd` (y
   `PreCompact`), un hook resume la sesión y llama a `save_project_context`. Cierra el
   bucle **sin** depender de que el dev ejecute `/cortex-save`.

Extras: **observabilidad** (PostToolUse/PreToolUse → registrar uso, encaja con nuestro
AI-tracing), **políticas** (PreToolUse bloquea editar un módulo marcado sensible por
Cortex), **lint al editar** (PostToolUse).

## Hooks de Claude Code (resumen)
Eventos relevantes: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`Stop`/`SubagentStop`, `PreCompact`, `SessionEnd`. Se configuran en `settings.json`
(`hooks → Evento → matcher → command`), scope user/proyecto/local. El hook recibe JSON
por stdin (`session_id`, `cwd`, `transcript_path`, `tool_name`/`tool_input`…) y puede:
- **Inyectar contexto** (`additionalContext`) en **SessionStart, UserPromptSubmit,
  PreToolUse, PostToolUse**.
- **Bloquear/decidir** (PreToolUse `allow/deny/ask`; UserPromptSubmit/PostToolUse
  `block`); `exit 2` = bloqueante.
- Ejecutar comando arbitrario / (según versión) llamar a un MCP o HTTP.

**Gotchas:** corren **síncronos** → cuidar latencia (UserPromptSubmit penaliza cada
prompt; mantener <~2-5s, usar async donde se pueda). En **SessionStart el MCP puede no
estar conectado todavía** → el hook debe llamar a Cortex por **CLI/HTTP** (no por
mcp_tool). Comando arbitrario = cuidado con seguridad. Límite práctico de contexto
inyectado (~pocos KB).

## Cómo lo hacen otros (validado)
- **Auto-captura a memoria:** `claude-mem` (Stop → comprime la sesión a SQLite;
  PostToolUse encola tool calls; UserPromptSubmit indexa prompts), `claude-memory-
  compiler` (SessionEnd/PreCompact → flush con Agent SDK), **mem0** (PreCompact guarda
  resumen; SessionStart/UserPromptSubmit cargan memorias). **Es exactamente nuestro
  bucle.**
- **Inyección de contexto (RAG):** SessionStart/UserPromptSubmit → `additionalContext`
  (claude-mem, mem0; reglas por paquete en PreToolUse).
- **Observabilidad:** `disler/claude-code-hooks-multi-agent-observability` (cada hook
  POST a un server → SQLite → dashboard) — **espejo de nuestro AI-tracing a Postgres**.
- **Políticas / lint:** bloquear `rm -rf`/lectura de `.env` (exit 2), TDD-guard,
  Prettier/ESLint/tsc en PostToolUse.

## Fricción: portabilidad entre agentes (lo importante)
La buena noticia: **los hooks ya NO son solo de Claude Code.**

| Capacidad | Claude Code | Codex CLI | OpenCode | Hermes (Nous) |
|---|---|---|---|---|
| Hooks de ciclo de vida | Sí (settings.json, shell) | **Sí** (`hooks` en config.toml; nombres tipo SessionStart/PreToolUse/Stop…) | **Sí** (event bus por **plugins TS**: `tool.execute.before/after`, `session.*`, `file.edited`…) | **Sí** (`~/.hermes/config.yaml`: `pre/post_tool_call`, `on_session_start/end`, `pre/post_llm_call`…) |
| Inyección de contexto | `additionalContext` | parcial/distinto | sin convención stdout idéntica | distinto |
| MCP | Sí | Sí | Sí | Sí |
| Fichero de contexto | CLAUDE.md | AGENTS.md | AGENTS.md | AGENTS.md/.hermes |

**Conclusión:** la fricción es de **forma, no de ausencia** — cambian formato (JSON/
TOML/YAML), nombres de evento, esquema del payload y el mecanismo de inyección. Un hook
shell de Claude **no** corre en OpenCode (necesita plugin TS) ni usa el mismo contrato
en Codex. **MCP + AGENTS.md son lo verdaderamente portable** (los 4 lo soportan, y es
como Cortex ya expone sus 8 tools).

## Estrategia recomendada para Cortex
**Baseline portable + hooks como mejora progresiva:**
1. **MCP `cortex` (ya hecho) = el núcleo portable.** Toda la lógica (capturar, traer
   context-pack) vive en las tools MCP; cualquier agente puede usarlas.
2. **Adaptadores finos de hooks por agente**, todos llamando a lo MISMO (las tools/CLI
   de Cortex): shell para Claude/Codex/Hermes, **plugin TS para OpenCode**. El adaptador
   solo "cablea el evento → llama a Cortex"; cero lógica duplicada.
3. **Distribuirlos con `cortex sync`** (extender el toolbelt con una sección `hooks` por
   agente; instala el adaptador en el sitio correcto de cada uno).
4. **Para SessionStart sin MCP conectado** → el adaptador llama a Cortex por **HTTP**
   (ver roadmap: transporte HTTP del MCP) o por una mini-CLI que lee la BD local.
5. **Degradación elegante:** sin hooks, queda la skill `cortex-capture` + invocar las
   tools a mano. Los hooks solo lo hacen *automático*.

**Riesgo a vigilar:** no construir features que SOLO funcionen con hooks de Claude (rompe
la promesa multi-agente). Mantener paridad por las tools MCP; los hooks aceleran, no
habilitan en exclusiva.

## Fuentes
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- claude-mem, claude-memory-compiler, mem0 (integración Claude Code):
  https://github.com/thedotmack/claude-mem · https://github.com/coleam00/claude-memory-compiler · https://docs.mem0.ai/integrations/claude-code
- Observabilidad por hooks: https://github.com/disler/claude-code-hooks-multi-agent-observability
- Codex hooks: https://developers.openai.com/codex/hooks
- OpenCode plugins/eventos: https://opencode.ai/docs/plugins/
- Hermes hooks: https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks
- awesome-claude-code: https://github.com/hesreallyhim/awesome-claude-code
