# Arquitectura: las fronteras que no se cruzan

## Quién puede importar a quién

```
shared      → (nada)                          tipos, enums, zod v3, contrato HTTP, env, scrub, marca
client      → shared                          HTTP, credenciales, .cortex.json, transcripts
database    → shared                          postgres.js + migraciones
embeddings  → shared                          proveedor enchufable
core        → client, database, embeddings, shared    dominio determinista, SIN LLM
agents      → client, core, database, shared          capa LLM (Mastra, zod v4 aislado)
apps/*      → cualquier package
```

- Un package **jamás** importa de `apps/*`, ni un fichero de otro package por ruta: solo su
  entrada pública `@cortex/<x>`.
- **`apps/cli` solo puede depender de `client` y `shared`.** Si un comando necesita la base de
  datos, el modelo o levantar un servicio, va en `apps/admin`.
- **`client` se mantiene ligero a propósito**: nada de Postgres, Mastra ni embeddings. Es lo que
  permite distribuir el CLI con `npm i -g` sin arrastrar ~95 MB al portátil de cada dev
  (ADR-0025).
- Las dos últimas las vigila `tests/client-package.test.ts`. No añadas excepciones: si te hace
  falta una, el comando está en el sitio equivocado.

## `core` no sabe que existe el LLM

- `core` es **determinista**. Lo que necesite un modelo se declara como hook en `core`
  (`setClassifier`, `setReranker`, `setReconciler`, `setMediaExtractor`, `registerUsageSink`) y
  lo cablea `agents` en un único sitio: `packages/agents/src/wire.ts`.
- Un entrypoint hace siempre, en este orden: `loadEnv()` → `wireLlm()` → arrancar.
- **Sin `LLM_PROVIDER` todo tiene que seguir funcionando**, con heurísticas y calidad peor. Si tu
  cambio no funciona sin modelo, está en la capa equivocada. Los tests de integración corren con
  `LLM_PROVIDER=none` precisamente para que esto no se erosione.
- zod **v3** en todo el repo; `agents` usa **v4** porque lo exige Mastra. No cruces schemas entre
  ambos.

## Side effects: solo en entrypoints

- `loadEnv()`, `wireLlm()`, `serve()`, `process.exit()`, abrir conexiones: **solo** en el
  `index.ts` de una app (o en un `*-cli.ts`). Importar un módulo de librería no debe hacer nada.
- Recurso compartido → singleton perezoso (`getSql()`, `getEmbeddingProvider()`), nunca creado al
  importar.

## La app se compone; el entrypoint la arranca

`createApp()` solo compone (middleware + rutas + `onError`) y no tiene efectos; `index.ts` carga
entorno, cablea y sirve. Así los tests ejercitan las rutas con `app.request()` sin abrir un
puerto — y por eso `createApp()` recibe sus dependencias caras inyectadas (`AppDeps.distill`).

## `web` y `server` son dos clientes de `core`, no dos capas

- `apps/web` llama a `core` **directamente**. No añadas un `fetch("/api/…")` desde un handler de
  la web (ADR-0042): sirven a clientes distintos —navegador con cookie frente a CLI con bearer— y
  lo que dupliquen se extrae a un helper, no se acopla.
- Lee `docs/design.md` **antes** de tocar `apps/web`: dice para qué es la UI y para qué no.

## El CLI y el servidor no van en lockstep

El contrato es la API HTTP (ADR-0062), y cada uno se actualiza por su lado:

- Campo nuevo en una respuesta → **opcional** donde se lee.
- Endpoint nuevo → un **404 significa «servidor viejo»**, no un error: se degrada (omite la
  función, conserva el comportamiento anterior, o dilo claramente).
- Lo único que bloquea es `minClientVersion`, y solo escrituras.
- Los hooks y `cortex mcp` **nunca** escriben en stdout nada que no sea protocolo, ni siquiera un
  aviso de versión. Hay test.

## Base de datos

- **Sin ORM.** postgres.js con tagged templates; nunca concatenes SQL en un string.
- `snake_case` en la base, `camelCase` en TypeScript. La traducción vive en un solo sitio:
  `packages/core/src/map.ts` (ADR-0022).
- Cambio de esquema = migración nueva en `packages/database/migrations/NNNN_desc.sql`,
  **idempotente** (`IF NOT EXISTS`). Nunca edites una migración ya aplicada.
- El filtro de acceso va **en la consulta**, nunca después de un `limit` (ADR-0052): si no, la
  página se queda vacía porque el recorte se comió lo que sí podías ver.

## Secretos y trazabilidad

- `scrub()` (`packages/shared/src/scrub.ts`) es una función pura y se aplica **dos veces a
  propósito**: en `agents` antes de mandar nada al modelo, y en `core` al persistir. Es
  idempotente. Si abres una vía de entrada de texto nueva, pásala por uno de esos dos puntos.
- Nada de secretos en el repo: `.env` está ignorado y `.env.example` es la plantilla. Hay un test
  que comprueba que la plantilla no miente en ninguna dirección.
- Cada unidad de conocimiento conserva **fuente, fecha, autor, confianza, estado y vigencia**. No
  conviertas una inferencia en un hecho: lo que sale de un modelo entra con confianza baja.
