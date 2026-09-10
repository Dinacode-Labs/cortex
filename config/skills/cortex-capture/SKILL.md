---
name: cortex-capture
description: >-
  Captura el contexto de la tarea actual en Dinacode Cortex (la memoria de
  proyecto). Úsala al TERMINAR una tarea de desarrollo, o cuando el usuario diga
  "guarda/captura en Cortex", "guarda esto en la memoria", "registra la decisión",
  o tras un cambio relevante (decisión técnica, incidencia resuelta, workaround,
  restricción del cliente). Cierra el bucle: trabajas → Cortex aprende.
---

# Capturar contexto en Cortex

Cuando termines una tarea o el usuario lo pida, **resume el trabajo y guárdalo** en
la memoria del proyecto llamando a la tool MCP `mcp__cortex__save_project_context`.

## Cuándo

- Al cerrar una tarea de desarrollo (cambios de cierto calado).
- Cuando se tome una **decisión técnica**, aparezca una **restricción de cliente**,
  se resuelva una **incidencia** o se aplique un **workaround**.
- Cuando el usuario lo pida explícitamente.

No captures ruido (cambios triviales, "ok", pruebas locales sin conclusión).

## Cómo

1. **Identifica el proyecto.** Usa el nombre del proyecto/cliente en Cortex (p.ej.
   "Acme Portal"). Si no está claro, pregúntalo en una frase.
2. **Redacta un resumen estructurado** (conciso, en español), con solo las secciones
   que apliquen:

   ```
   Resumen: <qué se hizo / qué se decidió, en 1-3 frases>
   Decisiones: <decisiones tomadas y por qué; alternativas descartadas>
   Archivos: <rutas relevantes tocadas>
   Riesgos / cuidado: <qué es sensible o puede romper>
   Pendientes: <lo que queda>
   Fuentes: <ticket/PR si aplica>
   ```

3. **Llama a la tool**:

   ```
   mcp__cortex__save_project_context({
     project: "<proyecto>",
     content: "<el resumen estructurado>",
     type: "decision" | "incident" | "pr_summary" | "technical_debt" | "convention" | ...,
     sourceType: "claude_code",
     sourceReference: "<id de tarea/PR si lo hay>",
     createdBy: "claude-code"
   })
   ```

   Omite `type` si no lo tienes claro: Cortex lo clasifica solo.

4. **Revisa la respuesta**: si Cortex avisa de un **duplicado** o una
   **contradicción** con conocimiento existente, coméntaselo al usuario (no insistas
   en duplicar; propón consolidar o validar).

## Antes de tocar algo

Recuerda lo simétrico: **antes** de empezar una tarea sobre un módulo, consulta
`mcp__cortex__get_project_context_pack` o `mcp__cortex__ask_project_context` para
traer decisiones vigentes, restricciones y riesgos del proyecto.
