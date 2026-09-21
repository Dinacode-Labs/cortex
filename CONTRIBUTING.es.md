# Contribuir a Cortex

*In English: [`CONTRIBUTING.md`](./CONTRIBUTING.md) — es la versión de referencia y la que debe
estar al día cuando las dos discrepen.*

Los arreglos, las mejoras y las capacidades nuevas llegan como **pull requests**. Esta página
resume lo imprescindible; el detalle completo —el mapa del repositorio, las reglas de
dependencia, cómo se publica una versión— está en [`CONTRIBUTING.md`](./CONTRIBUTING.md).

> **Nada corporativo aquí.** Clientes por su nombre, personas como responsables de un trabajo,
> herramientas internas y material de marca **no** van en este repositorio: viven en uno privado
> aparte (ADR-0026). En la documentación un cliente es «un proyecto real» o «Acme», y una tarea
> no tiene responsable.
>
> **Tampoco cómo lo operamos** (ADR-0031): qué proveedor usamos con qué clave y a qué coste,
> auditorías de seguridad, planes de refactor con hallazgos por fichero, prioridades de negocio.
> El producto documenta *cómo configurarlo*, no *con qué está configurado nuestro despliegue*.
> Regla rápida: si ayuda a alguien de fuera a usar, entender o mejorar Cortex, es público; si
> describe cómo lo operamos nosotros, no. En la duda, no.

## Para empezar

```bash
pnpm install
cp .env.example .env          # embeddings/LLM; funciona sin ninguna clave en modo local
pnpm db:up && pnpm db:migrate # Postgres + pgvector (Docker) + esquema
pnpm typecheck                # tipos en todo el monorepo, sin build
pnpm test                     # tests unitarios
pnpm test:integration         # tests de integración (requiere pnpm db:up)
```

**En desarrollo no hace falta compilar**: todo corre con `tsx` directamente sobre las fuentes,
gracias a una condición `development` en los `exports` de cada paquete. **Producción sí
compila**: `pnpm build` lanza `tsc -b` y deja un `dist/` en cada paquete y app.

## El idioma del repositorio ([ADR-0064](./docs/decisions.md#adr-0064))

**El repositorio está en inglés, entero**: el README, esta guía, la política de seguridad, los
mensajes del CLI, las descripciones de las tools MCP, la UI web, el código, sus comentarios, los
ADR, el roadmap, la investigación y los prompts de los agentes.

Es un repositorio público, y uno que cambia de idioma a la mitad es un repositorio del que la
mitad no la puede leer nadie de fuera — y justo la mitad que explica **por qué** las cosas son
como son.

Dos cosas se quedan en castellano a propósito, y las dos son **datos, no prosa que hayamos
escrito nosotros**:

- **Los patrones que casan con el corpus**, que es español: las reglas de clasificación de
  `packages/core/src/text.ts`, los deícticos de `packages/shared/src/domain.ts` y los conjuntos
  de eval de `evals/` (la línea base se midió contra ellos). Casan con lo que escribe la gente,
  no con el idioma del fichero en el que viven.
- **El idioma de salida de los agentes LLM** (`OUTPUT_LANGUAGE` en
  `packages/agents/src/mastra.ts`). Los prompts están en inglés; lo que los agentes producen son
  entradas de conocimiento que se guardan junto a un corpus que ya es español, así que cambiarlo
  es una decisión de producto, no una traducción.

Lo que pertenece a un sistema externo conserva también su grafía (el `'Histórico'` de Plane, los
nombres de propiedad de Notion, los nombres de fichero de las migraciones, que son claves
primarias en `schema_migrations`). Cada una de esas excepciones lleva un comentario en inglés
explicando el porqué, y `tests/docs.test.ts` las vigila: una excepción que no está escrita no se
distingue de un descuido.

Como somos españoles, los dos puntos de entrada se mantienen también en castellano
—[`README.es.md`](./README.es.md) y esta página— y el inglés es la versión que manda.

## Convenciones

- **Nada de secretos en el repositorio.** `.env` está ignorado; usa `.env.example`. Los secretos
  se limpian antes de que nada llegue a un LLM y otra vez antes de guardarlo.
- **Trazabilidad.** Cada unidad de conocimiento conserva fuente, fecha, autor, confianza, estado
  y vigencia. No conviertas inferencias en hechos.
- **zod va partido**: `agents` usa **zod v4** (lo exige Mastra); el resto usa **v3**. No cruces
  schemas entre los dos.
- **El CLI puede estar hablando con un servidor de hace meses**
  ([ADR-0062](./docs/decisions.md#adr-0062)). No se versionan juntos: el contrato es la API
  HTTP. Si añades un endpoint o un campo, el lado que lo lee trata su ausencia como «este
  servidor todavía no lo tiene», nunca como un error.
- **Sin comentarios que expliquen el QUÉ del código.** Un comentario documenta un **porqué** no
  obvio: una restricción oculta, un workaround concreto, una invariante sutil.
- **Calidad**: `pnpm typecheck` y `pnpm test` en verde, y tests nuevos con tu PR cuando tocas
  lógica comprobable.

## Pull requests

1. Rama desde `main`; mantén el cambio acotado.
2. `pnpm typecheck` en verde.
3. **Actualiza la documentación que afectes** en el mismo PR. Un PR que cambia comportamiento
   sin tocar la documentación está a medias.
4. En el PR: qué cambia, por qué y cómo lo has verificado.
5. **Una línea en `CHANGELOG.md`, bajo `[Unreleased]`.** Escribe qué cambia para quien lo usa,
   no qué has hecho tú: las notas de la release salen de ahí.
