---
paths:
  - "apps/cli/**/*.ts"
  - "apps/admin/**/*.ts"
  - "packages/client/**/*.ts"
---

# CLI y cliente

## Dónde va un comando

`cortex` es el CLI de **developer** y se instala con `npm i -g`: solo puede depender de `client` y
`shared`. Si el comando necesita la base de datos, el modelo o levantar un servicio, va en
`cortex-admin`, que vive en la imagen (ADR-0025). Lo vigila `tests/client-package.test.ts`.

## Cómo se escribe

- `apps/cli/src/commands/<cmd>.ts` exportando `run(args: string[]): Promise<void>`.
- **Sin `process.exit` y sin efectos al importar**: el dispatcher es el dueño del ciclo de vida.
- Regístralo en `COMMANDS` (`apps/cli/src/index.ts`) con su línea de ayuda **en inglés**. La carga
  es perezosa y con ruta literal: `cortex --help` no debe pagar el coste de cargar nada.
- Toda la salida, en inglés.

## Varios servidores, un cliente

El servidor sale del `.cortex.json` del repo, no de una variable global (ADR-0033): pasa por
`useProjectServer(cwd)` antes de llamar a la API, y busca el token **por servidor** —
`readCredentials()` sin argumento no tiene por qué ser el correcto.

## Compatibilidad

El CLI y el servidor no van en lockstep (ADR-0062): un 404 en un endpoint nuevo significa
«servidor viejo» y se degrada; un campo nuevo se lee como opcional. Lo único que bloquea es
`minClientVersion`, y solo escrituras (`apps/cli/src/compat.ts`).

## Hooks y `cortex mcp`

Gestionan su propio ciclo de vida (`managed: false`) y **stdout es protocolo**: ni un byte de más,
ni siquiera el aviso de versión. Hay test. Y están guardados para que la ausencia del CLI o del
servidor nunca rompa la sesión del agente.

## Conectores

`connect-<x>.ts` exportando `run(args)`, reutilizando la capa `extract` de core y escribiendo por
la API autenticada (`/capture/batch`). Incrementales por `sourceReference`.
