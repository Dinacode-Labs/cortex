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

> **Actualizada el mismo día**: al deducir el tipo de la pregunta (ver abajo) pasa a
> recall@5 **0.987** y MRR **0.928**. La tabla de aquí es la de antes de ese cambio, que es
> contra lo que se comparó.


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

Ese hilo ya se ha tirado, midiendo: la búsqueda **deduce el tipo de la pregunta** cuando esta
nombra una categoría, y empuja ese tipo hacia arriba sin filtrar por él —filtrar perdería la
respuesta cuando está guardada con otro tipo—. Resultado:

| | recall@5 | MRR | repartidas (recall) |
| --- | --- | --- | --- |
| antes | 0.961 | 0.901 | 0.850 |
| después | **0.987** | **0.928** | **0.950** |

Sin tocar lo demás: directas, parafraseadas y razonadas siguen en 1.000, y las preguntas sin
respuesta se mueven menos de una milésima (0.472 → 0.473), así que el empujón no hace que la
memoria aparente saber lo que no sabe.

El tamaño del empujón (`CORTEX_SEARCH_TYPE_BOOST`) se eligió midiendo, no a ojo: entre 0.12 y
0.20 el resultado es idéntico y es el mejor; por debajo se queda corto y desde 0.30 el recall
vuelve a caer, porque empieza a colar entradas del tipo correcto pero de otro asunto. Está en
0.15, el centro de esa meseta.
