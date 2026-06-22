# Guion de demo — Dinacode Cortex

Secuencia para enseñar la demo funcional (§15 y §20.8 del plan). Asume Postgres
levantado y datos sembrados (`pnpm db:up && pnpm db:migrate && pnpm db:seed`) y el
MCP conectado a Claude Code (ver `config/claude-code/README.md`).

Escenario: proyecto **Acme Portal**, cliente **Acme Corp**, stack Laravel + Vue +
PostgreSQL, con un módulo legacy de facturación sensible.

## 1. El problema

El contexto de un proyecto vive disperso (decisiones, restricciones, incidencias).
Un developer nuevo tarda semanas en adquirirlo. Cortex lo centraliza y lo sirve a
personas y a Claude Code.

## 2. Consultar contexto antes de tocar un módulo (§15.3)

En Claude Code:

> Antes de modificar el módulo de facturación de Acme Portal, consulta Cortex con
> `get_project_context_pack` y dime qué debo tener en cuenta.

Resultado esperado: decisiones vigentes (mantener el legacy), restricciones del
cliente (infra propia), riesgos (módulo sensible), deuda técnica (sin tests),
módulos sensibles e incidencias relevantes al área.

## 3. Guardar contexto con baja fricción (§15.2)

> Guarda en Cortex esta decisión de Acme Portal: "Se añadió caché en la generación
> de PDF de facturación para evitar timeouts en exportaciones grandes".

Cortex clasifica el tipo, extrae entidades (facturación), genera embedding y lo
deja disponible. No hay que rellenar formularios largos.

## 4. Búsqueda semántica / relacional (§15.6)

> Busca en Cortex incidencias parecidas relacionadas con la generación de
> documentos.

Devuelve la incidencia previa de timeouts y el ticket TASK-123 resuelto.

## 5. Loop de mejora: contradicción (§15.5)

> Guarda en Cortex (Acme Portal): "Se va a eliminar el módulo legacy de facturación
> en la próxima release."

Cortex detecta la **contradicción** con la decisión vigente de mantenerlo y pide
revisión humana en lugar de aceptarla a ciegas.

## 6. Validación

> Marca como validada la entrada `<id>` en Cortex.

(con `validate_context_entry`).

## 6b. Orquestación con Mastra (workflow)

Muestra el motor de workflows de Mastra orquestando la ingesta como pasos
observables (clasificar → persistir):

```bash
pnpm workflow:capture "Migramos los informes a generación asíncrona con colas para evitar timeouts" "Acme Portal"
```

Salida: el tipo y título propuestos por el LLM, la entrada persistida y las
señales del loop de mejora. (Requiere LLM configurado.)

## 7. Preparado para Codex

Las tools MCP son neutras: cualquier herramienta que hable MCP (Codex, ChatGPT,
bots internos) puede consumir la misma capa sin cambios en Cortex.

## Qué demuestra (§21)

1. El conocimiento entra con poca fricción.
2. Hay orquestación real, no una simple llamada a un modelo.
3. MCP conecta Claude Code sin acoplarlo todo.
4. El sistema recupera contexto útil, no solo documentos parecidos.
5. Cortex mejora el conocimiento (duplicados, contradicciones, validación).
