---
description: Resume el trabajo de esta sesión y lo guarda en Dinacode Cortex
argument-hint: "[proyecto]"
---

Resume el trabajo realizado en esta sesión/tarea y guárdalo en la memoria de
Dinacode Cortex con la tool MCP `mcp__cortex__save_project_context`.

Proyecto: $ARGUMENTS (si está vacío, dedúcelo del repo/carpeta actual o pregúntalo).

Sigue la skill `cortex-capture`: redacta un resumen estructurado (resumen,
decisiones, archivos, riesgos, pendientes, fuentes) con `sourceType: "claude_code"`,
y si Cortex avisa de duplicados o contradicciones, indícalo en vez de duplicar.
