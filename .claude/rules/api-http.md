---
paths:
  - "apps/server/**/*.ts"
  - "apps/mcp-server/**/*.ts"
---

# API HTTP y MCP

## Una ruta HTTP

1. Un router por recurso en `routes/<recurso>.ts`, montado en `createApp()`. `createApp()` solo
   compone y no tiene efectos: los tests la ejercitan con `app.request()` sin abrir un puerto, y
   lo caro se le inyecta (`AppDeps.distill`).
2. **Valida el body en el borde** con zod: `const body = await parseBody(c, schema);` y
   `if (body instanceof Response) return body;`. Los schemas que comparten cliente y servidor
   viven en `packages/shared/src/api-contract.ts`, para que no se desincronicen en silencio.
3. **Autentica y autoriza antes de tocar nada**: `currentUser(c)` → `checkProjectAccess(...)`. Es
   la política **única** de acceso (ADR-0046); `forbidden` se le cuenta al de fuera como «not
   found», y nadie inventa su propia regla.
4. Respuestas y errores en **inglés**. Los errores no controlados **no** se capturan aquí: suben
   al `onError`, que registra el detalle en el servidor y devuelve algo genérico.
5. `core` vuelve a validar y a escrubar lo que recibe. Es deliberado: el servidor no confía en que
   el cliente lo haya hecho.

Añadir un endpoint o un campo es un cambio de contrato: quien lo lee tolera su ausencia
(ADR-0062), porque enfrente puede haber un CLI de hace meses.

## Una tool MCP

- Se registran en `apps/mcp-server/src/server.ts`, con `inputSchema` tomado del schema de dominio
  (`saveContextInput.shape`), no reescrito a mano.
- Título y descripción **en inglés**: los lee un modelo que puede estar trabajando en cualquier
  idioma.
- Con `user` (HTTP autenticado) se atribuye la escritura (`createdBy`) y se aplican permisos con el
  mismo `guard`; sin `user` (stdio local) no hay guard.
- Un fallo se devuelve como `isError` con un texto que el agente pueda usar, nunca como excepción.
