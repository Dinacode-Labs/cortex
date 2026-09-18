---
paths:
  - "**/*.ts"
---

# Estilo de código

No hay ESLint ni Prettier, y es deliberado (ADR-0064): el estilo se sostiene imitando el fichero
que tienes delante. Por eso conviene que esté escrito.

## Formato

Dos espacios, comillas **dobles** siempre, punto y coma, líneas de hasta ~120 columnas. No
reformatees código que no estés tocando: un diff de formato esconde el cambio real.

## Módulos

- ESM **NodeNext**: los imports relativos llevan extensión `.js` aunque el fichero sea `.ts`.
- `verbatimModuleSyntax` está activo → `import type { X } from "…"` explícito para los tipos.
- **Sin `export default`.** Named exports, y cada package publica por su `index.ts`.
- En `core` el barrel es una **lista explícita** de lo que se exporta, no un `export *`: obliga a
  decidir qué es API pública.

## Tipos

- `interface` para objetos y para las opciones de una función; `type` para uniones, alias y tipos
  de función.
- **Tipo de retorno explícito** en toda función exportada.
- Opciones en un objeto con default (`opts: SaveContextOptions = {}`), y cada campo documentado
  con lo que hace **y su valor por defecto**.
- Clases solo cuando hay estado real o se implementa una interfaz (`EmbeddingProvider`), y para
  errores de dominio que el llamante distingue (`NotAManagerError`, `ProjectNotEmptyError`).
- `strict` y `noUncheckedIndexedAccess` están activos: el `!` solo se usa cuando el propio código
  acaba de garantizar ese índice, y con un comentario si no salta a la vista.

## `any` y supresiones

- `any` **solo en la frontera con un formato ajeno sin esquema**: transcripts de otros agentes,
  APIs sin tipos, filas SQL a través de `Row`. Nunca cruza hacia el dominio: antes de llegar a
  `core` se valida con zod o se mapea a un tipo propio.
- `@ts-ignore` y `@ts-expect-error`: **prohibidos**. Hoy hay cero en el repo; si necesitas uno, el
  tipo está mal modelado.

## Errores

- Lo **esperado** no se lanza: se devuelve. Unión discriminada para el resultado de un guard
  (`AccessCheck`: `ok | not_found | forbidden`), `null` para «no hay».
- Se lanza cuando es un **bug del llamante**, y el mensaje lo dice:
  `throw new Error("checkProjectAccess: se necesita 'name' o 'slug' (bug del caller).")`.
- Los errores no controlados suben al `onError` de la app: log completo en el servidor, respuesta
  genérica al cliente. **Nunca** filtres internals al que llama.
- **Degradar antes que romper**: un healthcheck con tope de tiempo, un logo inválido que cae al
  wordmark, un hook que devuelve pack vacío si el proyecto desaparece a mitad. Un `catch` que se
  traga todo, no: captura el caso concreto y deja subir el resto.

## Tamaño y forma

- Ficheros pequeños: hoy ninguno llega a 500 líneas. Un fichero, un tema. **Nada de `utils.ts`**
  como cajón de sastre.
- Precedencia explícita y en una línea legible: lo que pide el llamante > lo que dice el LLM >
  la heurística (`parsed.type ?? llm?.type ?? classifyType(content)`).

## Comentarios

- Solo el **porqué**. El qué ya lo dicen los nombres; si no lo dicen, arregla el nombre.
- El comentario bueno de este repo cuenta **qué pasó**: la restricción oculta, el incidente que
  motivó la línea, el ADR que lo decidió. «222 nodos con nombres como una frase entera» enseña;
  «extrae las entidades» no.
- Nunca referencies la tarea, el ticket o el PR en curso desde el código.
