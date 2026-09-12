# Conjunto de evaluación de retrieval

Un corpus fijo y un juego de preguntas con la evidencia anotada, para poder responder a la
única pregunta que importa cuando se toca el troceado, el rerank o los embeddings: **¿ha
mejorado o ha empeorado?**

## Por qué un corpus inventado y no la memoria real

Porque un eval sirve para comparar ejecuciones, y la memoria real cambia todos los días: el
mismo cambio de código daría números distintos según qué se hubiera capturado esa semana.
Además, así lo puede ejecutar cualquiera que clone el repo, sin acceso a ningún servidor.

El corpus imita lo que Cortex acumula de verdad —decisiones con su porqué, restricciones,
incidencias, convenciones, deuda— sobre un proyecto ficticio: **Nébula**, un servicio que
recibe documentos, los procesa y los factura.

## Cómo se ejecuta

```bash
pnpm admin eval                    # corpus fijo, proyecto temporal, lo borra al acabar
pnpm admin eval --keep             # deja el proyecto para inspeccionarlo
pnpm admin eval --project "X"      # contra un proyecto real, con tus propias preguntas
```

**Hace falta un proveedor de embeddings de verdad.** Con `EMBEDDINGS_PROVIDER=local` los
números no significan nada: es un hash de palabras, no entiende que «cuánto aguanta un
documento» y «límite de tamaño de subida» son lo mismo. El comando avisa y sigue, porque ver
el desastre también enseña.

## Qué se mide

- **recall@5**: de las entradas que responden a la pregunta, qué fracción aparece en los 5
  primeros resultados. Con varias evidencias, acertar una sola no es acertar.
- **MRR**: 1 partido por la posición de la primera evidencia correcta. Mide si lo bueno sale
  arriba o hay que bajar a mirar.

Las preguntas están etiquetadas por tipo para poder leer los números por separado: una caída
solo en las parafraseadas señala a los embeddings; solo en las repartidas, al troceado.

## Línea base (2026-09-12)

Con `qwen3-embedding` (4096 dim), búsqueda híbrida, sin rerank LLM:

| tipo | n | recall@5 | MRR |
| --- | --- | --- | --- |
| directa | 8 | 1.000 | 1.000 |
| parafraseada | 15 | 1.000 | 0.850 |
| razonada | 5 | 1.000 | 1.000 |
| multiple | 10 | 0.850 | 0.850 |
| **TOTAL** | **38** | **0.961** | **0.901** |

Las dos preguntas sin respuesta en el corpus puntúan 0.472 y 0.370 en su mejor resultado, muy
por debajo de lo que sale cuando la respuesta sí está. Eso es buena señal: la memoria no
aparenta saber lo que no sabe.

### Lo que ya dice esta línea base

Lo parafraseado se recupera entero (recall 1.000): los embeddings hacen su trabajo y no hay
indicio de pérdida de contexto por troceado. **Eso es justamente lo que aplazaba Contextual
Retrieval, y este número dice que sigue sin hacer falta.**

Donde se cae es en las preguntas repartidas, y una falla del todo:

> «¿Qué deuda técnica hay alrededor de la facturación?» → 0 de 2

Los cinco resultados hablan de facturación y **ninguno es del tipo `technical_debt`**. La
similitud semántica se come el tipo: cuando la pregunta nombra una categoría del dominio
—«deuda técnica», «qué decidimos», «qué restricciones hay»— la búsqueda la ignora y devuelve lo
más parecido por tema. La API ya acepta filtrar por tipo; nadie lo deduce de la pregunta.

Ese es el siguiente hilo, y ahora se puede tirar de él midiendo en vez de opinando.
