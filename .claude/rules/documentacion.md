# Documentación y entrega

La documentación es parte del trabajo, no un extra. Un PR que cambia comportamiento sin tocar
documentación está a medias.

## En el mismo PR

- `README.md` si cambian capacidades, arquitectura, comandos o estructura.
- `docs/decisions.md` si la decisión es de calado (ver abajo).
- `docs/roadmap.md`, `CONTRIBUTING.md`, `.env.example` y `CLAUDE.md` según lo que hayas tocado.
- Una línea en `CHANGELOG.md`, sección `[Unreleased]`: **qué cambia para quien lo usa**, no qué
  hiciste. Las notas de la release salen de ahí, no de los commits.
- `CLAUDE.md` y estas reglas: mantenlas al día **y pódalas**. Cortas y veraces valen más que
  largas y desfasadas.

## ADR

Formato fijo: **status · context · decision · alternatives · revisit when**. En inglés. Los
números son identificadores estables porque se citan desde el código: nunca los reordenes ni los
reutilices.

Una decisión es una **hipótesis a revisar**. Lo que hace útil el registro es el «revisit when», y
registrar lo que **no** funcionó (Mastra workflows evaluados y descartados, búsqueda full-text
solo en español, tabla de precios a mano) es lo que lo mantiene honesto.

Antes de afirmar que algo «funciona así», comprueba que el fichero, la función o el flag que citas
sigue existiendo. **El código manda sobre la doc.**

## Qué NO va en este repositorio

Es público (ADR-0026, ADR-0031): ni clientes por su nombre, ni personas como responsables de un
trabajo, ni herramientas internas, ni marca propia, ni decisiones operativas (qué proveedor, con
qué clave, a qué coste), ni auditorías de seguridad, ni prioridades de negocio. Eso vive en el
repositorio privado.

Regla rápida: si ayuda a alguien de fuera a usar, entender o mejorar Cortex, es público; si
describe cómo lo operamos nosotros, no. En la duda, no.

Y al contar un hallazgo: **di qué se encontró, no cómo se encontró**. «Este par de entradas puntúa
0.86–0.88» enseña algo; el montaje que lo produjo envejece mal y no ayuda a nadie de fuera.

## Disciplina de PR

Un PR por cambio, rama desde `main`, foco estrecho. Nada de arreglos «ya que estoy» fuera de
alcance: si te encuentras algo roto que no toca, anótalo en el PR y sigue.

Commits en formato convencional, con scope por paquete y descripción en español:
`fix(core): el slug del proyecto resuelve también al leer, y en un solo sitio (#136)`.
