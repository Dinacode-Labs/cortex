# Integración de Cortex con Claude Code

Cómo conectar el MCP de Cortex a Claude Code para consultar y guardar contexto
durante una tarea (§8, §13, §15 del plan).

## Requisitos

```bash
pnpm install
pnpm db:up        # Postgres + pgvector (Docker)
pnpm db:migrate
pnpm db:seed      # datos de demo (Acme Portal)
```

## Activar el MCP

Opción A — fichero de proyecto: copia `config/claude-code/mcp.json` a un
`.mcp.json` en la raíz del repo. Claude Code lo detecta al abrir el proyecto.

Opción B — CLI:

```bash
claude mcp add cortex -- pnpm --filter @cortex/mcp-server start
```

Comprueba el estado con `/mcp` dentro de Claude Code: debe aparecer `cortex`
con 5 tools.

## Tools expuestas

- `save_project_context` — guardar conocimiento (clasifica, resume, detecta
  duplicados/contradicciones).
- `search_project_context` — búsqueda semántica.
- `get_project_context_pack` — paquete de contexto de un proyecto/área.
- `list_project_decisions` — decisiones técnicas del proyecto.
- `validate_context_entry` — validar / rechazar / marcar obsoleta una entrada.

## Prompts de demo

Consulta antes de tocar un módulo (§15.3):

> Antes de modificar el módulo de facturación de **Acme Portal**, consulta Cortex
> con `get_project_context_pack` y dime qué debo tener en cuenta.

Guardar contexto tras una tarea (§15.2):

> Guarda en Cortex esta decisión del proyecto Acme Portal: "Se añadió caché en la
> generación de PDF para evitar timeouts".

Detectar contradicción (§15.5):

> Guarda en Cortex (proyecto Acme Portal): "Se va a eliminar el módulo legacy de
> facturación en la próxima release."

(Cortex debería avisar de la contradicción con la decisión vigente de mantenerlo.)
