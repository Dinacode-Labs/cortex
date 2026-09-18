# Tests

`pnpm typecheck` y `pnpm test` en verde, siempre. `pnpm test:integration` si tocas `core`,
`database` o las apps HTTP.

## Dónde va cada uno

- **Unit** (`tests/*.test.ts`, `pnpm test`): lógica pura y determinista — schemas, permisos,
  slugs, parsers de sesión, compatibilidad de versiones. Sin base de datos y sin red.
- **Integración** (`tests/integration/*.test.ts`, `pnpm test:integration`): contra Postgres real
  (`cortex_test`), embeddings `local` y `LLM_PROVIDER=none`. Herméticos: sin red y sin claves.
  Cubren persistencia y búsqueda, jerarquía y herencia, permisos y cascadas, captura por lotes y
  auth. Necesitan `pnpm db:up`; el `globalSetup` crea y migra la base.
- Comparten base, así que van en serie y cada test se aísla con un sufijo único (`RID`).

## La regla que distingue a este repo

> **Toda regla que se pueda romper sin darse cuenta se convierte en test.**

No es retórica, es lo que ya hay: que el CLI no engorde (`client-package.test.ts`), que
`.env.example` no mienta (`env-example.test.ts`), que no haya enlaces rotos ni ADR fantasma ni
material corporativo (`docs.test.ts`), que toda clase CSS emitida tenga una regla detrás
(`web-styles.test.ts`), que el `dist/` arranque de verdad (el smoke de CI).

Antes de escribir un párrafo pidiendo que alguien se acuerde de algo, pregúntate si puede ser un
test. Si puede, que sea un test.

## Cómo se escriben

- `describe` e `it` **en español**, y describiendo el **comportamiento**, no el nombre de la
  función: `it("el OTP se busca en la línea de SU email, no el primer número que pase")`.
- Encima del test, un comentario de bloque con **qué incidente evita**. Un test sin ese porqué
  acaba borrado por el primero que lo vea fallar.
- **Inyecta en vez de mockear** lo que la app ya deja inyectar (`createApp({ distill })`); ejercita
  las rutas con `app.request()`, sin levantar un puerto.
- Un `expect` que enseña **todos** los infractores, no los tres primeros: con tres, arreglas tres
  y el cuarto sigue ahí.

Añade tests con tu PR siempre que toques lógica testeable.
