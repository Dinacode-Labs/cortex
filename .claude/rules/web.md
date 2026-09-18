---
paths:
  - "apps/web/**/*.ts"
  - "apps/web/public/**"
---

# UI web

**Lee `docs/design.md` antes de tocar nada aquí.** Dice para qué existe la interfaz y para qué no,
y evita volver a meter pantallas que no se pueden usar.

La tesis, en una línea: **los agentes escriben y las personas revisan**. La UI es donde alguien
audita y repara una memoria escrita por máquinas — no es una herramienta de alta de datos, ni un
dashboard, ni la forma principal de usar Cortex.

## Reglas

- **Server-rendered, sin build** (ADR-0042). Hono + `hono/html`, que autoescapa cada
  interpolación. `raw()` **solo** sobre SVG de configuración o literales del propio fichero,
  **jamás** sobre datos.
- **La web habla con `core` directamente**, nunca con la API HTTP: no añadas un `fetch("/api/…")`
  desde un handler.
- **Componentes, no HTML suelto**: los ladrillos están en `views/components.ts` y las rutas
  componen (ADR-0053). Si un componente no encaja, arregla el componente.
- **Tokens, no valores a pelo**: una hoja de estilos es el sistema de diseño. Si el número que
  necesitas no está en la escala, la escala está mal o el diseño está mal.
- **Todo cuelga del proyecto** (`/p/<slug>/…`, ADR-0050), y las URLs viejas redirigen: un enlace
  que alguien pegó en un chat hace tres semanas sigue funcionando.
- **Nada de pantallas que enseñan un problema y no dejan arreglarlo**: enseñan a ignorarlo.
- **Nombre del producto, jamás en el markup**: la marca es configuración (`getBrandName()`).
- El acceso lo decide `checkProjectAccess`, y «no puedes verlo» se pinta como «no existe».
- La herencia **sube**: un hijo lee lo de su cliente, nunca lo de un hermano. Cruzar hacia abajo es
  un acto deliberado y filtrado por permisos (ADR-0063).
- Textos en **inglés**.
