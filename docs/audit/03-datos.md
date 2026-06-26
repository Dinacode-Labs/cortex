# Modelo de datos y correctitud — Auditoría Cortex

## Valoración

El modelo de datos está **bien concebido para una PoC**: el grafo bi-temporal
(`valid_from`/`valid_to`/`observed_at`, invalidar ≠ borrar) está implementado de forma
coherente y las consultas point-in-time son consistentes entre `vectorSearch`,
`hybridSearch` y `getContextPack`. La idempotencia online de entidades (índice único
`(type, canonical_name)` + `ON CONFLICT` en `resolveEntity`) y la exclusión de imágenes
del dedup son aciertos de diseño reales. **No está a la altura de un sistema de primera
línea** en tres frentes: (1) la identidad de entidad NO es consistente entre el camino
online (por `type+canonical`) y el batch `resolve-entities` (por nombre, ignorando el
`type`), lo que puede **corromper el grafo** fusionando entidades de distinto tipo;
(2) ninguna escritura compuesta es atómica, dejando estado parcial o duplicados vigentes
ante un fallo intermedio; (3) los umbrales de reconciliación (0.82/0.95) están calibrados
para `qwen3-embedding`, pero el proveedor **por defecto** es `local` feature-hash de
256-dim, cuya distribución de coseno es completamente distinta. A esto se suma la ausencia
de restricciones de unicidad en BD (`relations`, `source_reference`) que delega la
idempotencia/dedup a chequeos de aplicación con carreras reales, y una columna `vector`
sin dimensión fija ni validación. **Hay cero tests sobre esta lógica crítica.**

---

## Hallazgos por severidad

### 🟠 Alto

#### 1. `resolve-entities` fusiona entidades por nombre IGNORANDO el `type` → corrompe el grafo
- **Evidencia:** `packages/core/src/resolve-entities.ts:41` agrupa con
  `const key = norm(e.name)` (solo nombre); el `WHERE` de la línea 32 solo excluye
  `type <> 'project'`. Esto choca con el modelo: `entities` tiene
  `UNIQUE (type, canonical_name)` (`packages/database/migrations/0001_init.sql:45-46`) y
  `resolveEntity` crea/upserta con `ON CONFLICT (type, canonical_name)`
  (`packages/core/src/entities.ts:16-20`). El batch hace
  `DELETE FROM entities WHERE id = …` sobre los *losers*
  (`resolve-entities.ts:73,77`) y re-apunta `context_entry_entities` y `relations` a la
  canónica. Además usa `norm()` (elimina espacios/puntuación) en vez de `canonicalize()`
  (`packages/core/src/text.ts`, conserva espacios), por lo que las dos rutas **ni siquiera
  comparten normalización**.
- **Impacto:** Dos definiciones de identidad incompatibles conviviendo: online por
  `(type, canonical)`, batch por solo nombre. Ejecutar el loop de mantenimiento fusiona,
  p.ej., un `module` "auth" y una `technology` "auth" en una sola entidad de un único
  `type`, pierde el `type` y reescribe aristas del grafo de forma **irreversible**
  (`DELETE`). Degrada el retrieval por relaciones y el lint de huérfanas/gaps que dependen
  del `type`.
- **Recomendación:** Cambiar la clave de agrupación a `${e.type}:${norm(e.name)}` y, mejor
  aún, reutilizar `canonicalize()` (la del camino online) en vez de `norm()` para que ambas
  rutas compartan UNA sola definición de identidad. Añadir un test que verifique que
  `module`/`technology` homónimos NO se fusionan.
- **Esfuerzo:** S

### 🟡 Medio

#### 2. Escrituras compuestas sin transacción: estado parcial y duplicados vigentes
- **Evidencia:** `saveContext` encadena `INSERT sources`
  (`packages/core/src/operations.ts:123`) → `INSERT context_entries` (130) →
  `storeEmbedding` (141) → `links`/`relate` (145-159) como statements **autocommit**.
  `sql.begin` solo aparece en `resolve-entities.ts:63` y `migrate.ts:34`. Peor: en el
  supersede de `saveWithReconciliation`, `saveContext(nueva)`
  (`packages/core/src/dedup.ts:112`) e `invalidateEntry(vieja)` (`dedup.ts:114`) **no son
  atómicos**.
- **Impacto:** Un fallo del proveedor de embeddings (`packages/core/src/vectors.ts:14`,
  `vectors[0]!`) o de un link deja `source`+`entry` committeados pero sin vector → entrada
  no buscable por la vía vectorial y no deduplicable. En el supersede, un crash entre ambos
  pasos deja la nueva vigente **Y** la vieja sin invalidar → dos entradas `current`
  duplicadas, exactamente el "context rot" que el subsistema dice evitar. Atenuantes: la
  entrada huérfana sigue siendo alcanzable por la rama FTS (`vectors.ts:108`) y por lecturas
  SQL; falta de embedding es un estado ya tolerado (camino batch `skipEmbedding`); y la
  ventana de doble-`current` es condicional a fallo y se autocorrige vía `reconcileProject`
  (`dedup.ts:143`).
- **Recomendación:** Envolver `saveContext` (source+entry+embedding+links) en
  `sql.begin(tx)` propagando el `tx` a `storeEmbedding`/`relate`/`linkEntryToEntity`. Hacer
  atómico el par supersede (`saveContext`+`invalidateEntry`) en una sola transacción. Donde
  el embedding sea por lotes posterior, marcar la entrada como "incompleta" hasta tener
  vector.
- **Esfuerzo:** M

#### 3. Umbrales de reconciliación calibrados para `qwen3` pero el proveedor por defecto es `local` feature-hash
- **Evidencia:** `packages/core/src/dedup.ts:17-18` fija `UPDATE_THRESHOLD = 0.82` /
  `NOOP_THRESHOLD = 0.95`, documentados (`dedup.ts:14-15`) como "calibrados con
  qwen3-embedding (exacto ~0.99, paráfrasis ~0.84, distinto ~0.67)". Pero el proveedor por
  defecto es `LocalEmbeddingProvider` (feature-hashing 256-dim;
  `packages/embeddings/src/index.ts:20` default `'local'`,
  `packages/embeddings/src/local.ts:13`), cuya distribución de coseno no tiene relación con
  la de qwen3. Los mismos cortes fijos reaparecen en `operations.ts:196` (0.85) y
  `packages/core/src/lint.ts:60` (0.12).
- **Impacto:** Con la configuración por defecto (sin claves, la que arranca el repo y la
  demo), 0.82/0.95 no corresponden a "paráfrasis"/"casi idéntico": las decisiones
  ADD/UPDATE/NOOP operan sobre un espacio mal calibrado, con riesgo de falsos NOOP (pérdida
  de conocimiento) o falsos ADD (duplicados). Atenuante: el camino destructivo
  (UPDATE/SUPERSEDE) está *gated* tras un reconciler LLM inyectado (`dedup.ts:108`), ausente
  en el arranque por defecto sin claves; ahí solo actúa el NOOP/dedup a `≥0.95`
  (conservador, falsos NOOP improbables y la invalidación es reversible §5.5), y los cortes
  de `lint`/`operations` son solo avisos no destructivos.
- **Recomendación:** Hacer los umbrales dependientes de `provider.model`/`version` (tabla de
  calibración por modelo) o al menos documentar/forzar que la reconciliación solo se active
  con un embedding semántico real. Idealmente derivar el umbral de una calibración empírica
  por modelo (percentiles de pares conocidos) en vez de constantes mágicas compartidas.
- **Esfuerzo:** M

#### 4. Columna `vector` sin dimensión fija ni validación `length(vector)=dim`
- **Evidencia:** `embeddings.vector` y `code_chunks.embedding` son `vector` **sin**
  dimensión (`0001_init.sql:132`, `0003_code.sql:18`). La columna `dim` es puramente
  informativa: ninguna `CHECK` ni trigger garantiza que `length(vector)=dim` ni que dos
  filas del mismo proyecto/modelo compartan dimensión. Las búsquedas se protegen filtrando
  por `embedding_model`+`version` (`vectors.ts:101,170`), pero nada en la BD lo impone, y no
  existe índice ANN (`0001_init.sql:124`).
- **Impacto:** Cambiar `EMBEDDINGS_PROVIDER` (p.ej. `local` 256-dim → qwen 4096-dim) sin
  re-embeber deja vectores viejos de otra dimensión en la misma columna; quedan
  silenciosamente fuera de toda búsqueda (el filtro por modelo los excluye) sin error ni
  aviso → entradas "fantasma" no recuperables. Un proveedor que devuelva un vector de
  dimensión incorrecta se inserta sin rechazo. Sin índice ANN, además, toda búsqueda es KNN
  secuencial O(n). Atenuante: es una decisión documentada de PoC (ADR-0005) y el filtro
  model+version mitiga el peor caso.
- **Recomendación:** Fijar la dimensión por despliegue (`vector(N)`) o añadir
  `CHECK (vector_dims(vector)=dim)`; registrar la migración de re-embed al cambiar de modelo
  y documentarlo. Planificar índice `ivfflat`/`hnsw` con dimensión fija para escalar.
- **Esfuerzo:** M

#### 5. `findNearest` toma el vecino global y comprueba `sameKind` a posteriori → se salta dedup del mismo `sourceType`
- **Evidencia:** `saveWithReconciliation` calcula `near` con `findNearest`
  (`dedup.ts:103`), que hace `vectorSearch` con `limit 1` **sin** filtrar por `source_type`
  (`vectors.ts:152-194` no acepta `sourceType`). Luego
  `sameKind = near.sourceType === input.sourceType` se evalúa post-hoc (`dedup.ts:104`). Si
  el vecino #1 es de otro `sourceType`, `sameKind=false` aunque exista un casi-duplicado del
  MISMO `sourceType` en la posición #2.
- **Impacto:** Un casi-duplicado real (mismo origen) queda enmascarado por un vecino más
  cercano de origen distinto, y la pieza se hace ADD en vez de NOOP/UPDATE. El dedup
  posterior (`reconcileProject`) exige distancia `<0.05` y tampoco lo recoge si están entre
  0.05 y 0.18. Acumulación silenciosa de duplicados pese a tener la lógica de
  reconciliación.
- **Recomendación:** Añadir un filtro `source_type` a `vectorSearch` y que `findNearest`
  recupere el vecino más cercano DEL MISMO `sourceType` (o recuperar top-k y elegir el
  primero same-kind), no el global. Considerar comparar contra un pequeño cluster (k>1) en
  lugar de un único vecino.
- **Esfuerzo:** S

#### 6. Idempotencia de `captureBatch` por `source_reference` sin restricción única ni índice en BD
- **Evidencia:** `captureBatch` hace `SELECT id … WHERE project_id=X AND source_reference=ref`
  (`packages/core/src/capture.ts:39`) y luego `INSERT`, sin constraint único. El esquema no
  tiene índice ni unicidad sobre `context_entries(project_id, source_reference)`
  (`0001_init.sql:55-83` solo indexa project/type/status). Mismo patrón check-then-act en el
  incremental de los conectores.
- **Impacto:** Dos batches concurrentes con el mismo `sourceReference` pasan ambos el
  `SELECT` e insertan duplicados (carrera no protegida por BD), justo el caso de re-ejecutar
  un conector. Además, sin índice sobre `source_reference`, el chequeo incremental es un seq
  scan por ítem: O(items × filas) en cada ingesta. La "idempotencia" prometida es
  best-effort de aplicación.
- **Recomendación:** Añadir `UNIQUE` parcial
  `(project_id, source_reference) WHERE source_reference IS NOT NULL` e ingerir con
  `INSERT … ON CONFLICT DO NOTHING RETURNING` para distinguir added/existing atómicamente;
  el índice además acelera el incremental.
- **Esfuerzo:** S

#### 7. `relations` sin unicidad → `relate()` es TOCTOU y duplica aristas (incluido `contradicts`/`belongs_to`)
- **Evidencia:** `relate()` hace `SELECT`-existe y luego `INSERT`
  (`packages/core/src/entities.ts:50-61`) sin restricción. `relations` no tiene índice único
  sobre `(source_id, target_id, relation_type)` (`0001_init.sql:104-119`). Se invoca
  concurrentemente desde `saveContext` (`operations.ts:150`), `enrich-project` (workers con
  `CONCURRENCY`) y el supersede→`contradicts` (`dedup.ts:118`).
- **Impacto:** Dos escrituras concurrentes para la misma relación pasan ambas el `SELECT` e
  insertan duplicados. El grafo acumula aristas redundantes; las marcas
  `contradicts`/`belongs_to` se duplican y sesgan lint/queries. `resolve-entities` limpia
  duplicados exactos a posteriori (`resolve-entities.ts:86-90`), pero es una pasada batch, no
  una garantía.
- **Recomendación:** Añadir `UNIQUE (source_id, target_id, relation_type)` y cambiar
  `relate()` a `INSERT … ON CONFLICT DO NOTHING` (mismo patrón que
  `linkEntryToEntity`/`resolveEntity`, que sí están protegidos). Decidir si la unicidad debe
  incluir la ventana temporal para relaciones bi-temporales.
- **Esfuerzo:** S

#### 8. Self-join de duplicados en `lint` compara por `embedding_model` pero no por `embedding_version`
- **Evidencia:** `lint.ts:56-57` une `a.embedding_model = b.embedding_model` **sin** incluir
  `embedding_version` (ni `chunk_index`). `reconcileProject` sí une por
  `model`+`version`+`chunk` (`dedup.ts:151-152`), así que las dos rutas de dedup difieren.
- **Impacto:** Si conviven dos versiones del mismo modelo con distinta dimensión, el operador
  `a.vector <=> b.vector` falla por mismatch de dimensiones (error en runtime del lint). Si
  la dimensión coincide pero los vectores son de versiones distintas, compara espacios no
  comparables y reporta duplicados/contradicciones espurios. Inconsistente con el resto del
  sistema, que siempre filtra por model+version.
- **Recomendación:** Añadir `AND a.embedding_version = b.embedding_version` (y `chunk_index`)
  al join del lint, alineándolo con `reconcileProject` y con los filtros de `vectors.ts`.
- **Esfuerzo:** S

#### 9. Decisión `update` del LLM sobre conocimiento no-`agent_session` cae a ADD silencioso
- **Evidencia:** En `saveWithReconciliation`, si `decision==='update'` pero
  `near.sourceType !== 'agent_session'`, el bloque (`dedup.ts:122-125`) no entra y la
  ejecución cae hasta el ADD final (`dedup.ts:128`). La pieza casi-duplicada (score
  0.82-0.95) se inserta como nueva.
- **Impacto:** Se crea una entrada casi-duplicada que `reconcileProject` NO deduplicará
  (exige distancia `<0.05`, equivalente a score `>0.95`). La intención de no reescribir
  fuentes/curado es correcta, pero el efecto es acumular duplicados en la franja 0.82-0.95
  sobre fuentes, que es la zona que ningún barrido posterior limpia.
- **Recomendación:** Cuando el LLM dice `update` sobre una fuente/curado, en vez de ADD,
  registrar una relación `related_to`/`supersedes` hacia la entrada existente (o degradar a
  NOOP con aviso), evitando crear una entrada vigente duplicada. Como mínimo, emitir un
  warning de duplicado.
- **Esfuerzo:** S

#### 10. Doble fuente de verdad para "vigente": `validity` vs `valid_to`/`status`
- **Evidencia:** `invalidateEntry` fija a la vez `valid_to`, `validity='historical'` y
  `status='superseded'` (`dedup.ts:62-66`). Pero las consultas filtran por
  `valid_to IS NULL` (`operations.ts:268,410-415`; `vectors.ts:91,177`) o por
  `status NOT IN (…)` — la columna `validity` **no se usa** en ningún filtro de retrieval.
  `autoCurate` marca `status='obsolete'` sin tocar `valid_to`
  (`packages/core/src/curate.ts:30`).
- **Impacto:** Tres señales de estado (`valid_to`, `validity`, `status`) que deben mantenerse
  coherentes a mano en cada ruta de mutación. `validity` es efectivamente columna muerta para
  retrieval y puede divergir (p.ej. un futuro UPDATE que mueva `valid_to` sin tocar
  `validity`, o `validateEntry` que mueve `status` sin `valid_to`). Riesgo de inconsistencias
  sutiles en consultas point-in-time.
- **Recomendación:** Definir UNA señal autoritativa (recomendado `valid_to` para vigencia
  temporal; `status` para ciclo de validación) y derivar `validity`, o eliminarla. Documentar
  el invariante y centralizar la invalidación en una única función que toque siempre el
  conjunto coherente.
- **Esfuerzo:** M

#### 11. `createProject` por colisión de slug devuelve un proyecto preexistente AJENO
- **Evidencia:** `slugify` trunca/colapsa el nombre y `createProject`, si
  `findProjectBySlug(slug)` encuentra algo, devuelve ese proyecto sin verificar que sea "el
  mismo" (`packages/core/src/projects.ts:52-56`). Dos nombres distintos que slugifican igual
  colisionan. Además es check-then-act sin transacción
  (`findProjectBySlug` → `resolveEntity` → `UPDATE`), y el segundo `UPDATE` bajo carrera
  violaría el índice único parcial de slug (`0008_project_slug.sql:13`).
- **Impacto:** Correctitud de identidad del proyecto: `cortex link --create "Nombre X"` puede
  vincular el repo a un proyecto distinto que comparte slug, colgando conocimiento
  (potencialmente sensible) en el proyecto equivocado. Bajo concurrencia, la violación del
  índice único aflora como excepción no gestionada (500/crash) en vez de manejo limpio.
- **Recomendación:** Tratar la colisión de slug como conflicto explícito (error/solicitud de
  desambiguación), no como "devolver el existente". Resolver la creación con
  `INSERT … ON CONFLICT (slug)` atómico y devolver un resultado tipado
  (`created|existing|conflict`) que el caller maneje.
- **Esfuerzo:** M

### 🟢 Bajo

#### 12. Heurística de "corroborado" (`updated_at > created_at + 1 min`) frágil para la auto-curación
- **Evidencia:** `autoCurate` promueve confianza si
  `updated_at > created_at + interval '1 minute'` y decae si no (`curate.ts:25,32`). Pero el
  trigger `context_entries_set_updated_at` (`0001_init.sql:85-87`) avanza `updated_at` en
  CUALQUIER `UPDATE`: `validateEntry` (`operations.ts:284`), invalidación,
  `updateEntryContent`, etc.
- **Impacto:** Cualquier mutación posterior (cambio de estado, supersede, merge) promueve la
  confianza aunque NO haya habido recurrencia real del conocimiento; e inversamente,
  conocimiento realmente corroborado por una vía que no toque `updated_at` no se promueve. La
  promoción de confianza —señal de calidad de la memoria— se basa en un proxy poco fiable.
- **Recomendación:** Registrar la corroboración de forma explícita (p.ej.
  `metadata.corroborations++` o una tabla de eventos) en el momento del UPDATE/merge real, y
  curar a partir de esa señal en vez de comparar timestamps.
- **Esfuerzo:** M

#### 13. Faltan índices para los patrones de consulta calientes (vigencia y `source_reference`)
- **Evidencia:** Las consultas de pack/decisions filtran por
  `(project_id, type, valid_to IS NULL)` (`operations.ts:266-270,411-415`) pero solo hay
  índices de columna única project/type/status/valid_to (`0001_init.sql:81-83`,
  `0004_temporal.sql:12`). No hay índice sobre `context_entries(source_reference)` pese al
  lookup incremental por ítem.
- **Impacto:** A escala, el filtro de vigencia y el chequeo incremental degradan a scans; el
  índice de `valid_to` por sí solo es poco selectivo (la mayoría de filas son
  NULL=vigentes). No es crítico en demo, pero el modelo no está preparado para volumen.
- **Recomendación:** Añadir índices compuestos alineados con las consultas:
  `(project_id, type) WHERE valid_to IS NULL`, y `(project_id, source_reference)`. Revisar al
  introducir el índice ANN.
- **Esfuerzo:** S

#### 14. Columnas bi-temporales de `relations` declaradas pero nunca usadas en escritura/lectura
- **Evidencia:** `0004_temporal.sql:14-20` añade `valid_from`/`valid_to`/`observed_at` a
  `relations`, pero `relate()` (`entities.ts:57-61`) nunca las setea más allá del default y
  ninguna consulta de grafo (`queries.ts`, `lint.ts`) filtra por `valid_to` en `relations`. La
  invalidación bi-temporal solo se aplica a `context_entries`.
- **Impacto:** El grafo de aristas no es realmente bi-temporal: una relación
  `contradicts`/`supersedes` nunca se cierra temporalmente, solo se borra en
  `resolve-entities`. Asimetría con el modelo de entradas; las consultas point-in-time del
  grafo no son posibles pese al esquema. Deuda/over-engineering inconsistente.
- **Recomendación:** O bien implementar la invalidación temporal de relaciones (cerrar
  `valid_to` en vez de borrar) y filtrar por ella en las consultas de grafo, o retirar las
  columnas si no se van a usar, para no inducir a error.
- **Esfuerzo:** M

---

## Qué está bien

#### ✅ Grafo bi-temporal coherente (invalidar ≠ borrar) con point-in-time consistente
- `invalidateEntry` cierra la ventana (`valid_to=now`, `validity='historical'`,
  `superseded_by`, `status='superseded'`) **sin borrar** (`dedup.ts:61-67`); el filtro
  `asOf` (`valid_from<=asOf AND (valid_to IS NULL OR valid_to>asOf)`) es **idéntico** en
  `vectorSearch` (`vectors.ts:175-179`), `hybridSearch` (`vectors.ts:88-92`) y
  `getContextPack`/`entriesByType` (`operations.ts:408-415`). El `UPDATE` de invalidación es
  condicional (`WHERE valid_to IS NULL`), evitando re-cerrar. Es la base de una memoria
  corporativa auditable.
- **Recomendación:** Mantener. Reforzar con tests de point-in-time (entrada creada,
  superada, consultada `asOf` antes/después) para blindar la consistencia entre las tres
  rutas ante refactors.

#### ✅ Exclusión de imágenes del dedup por embedding (caption ≠ identidad)
- `reconcileProject` excluye formatos de imagen del self-join
  (`dedup.ts:141,159-160`, `NON_DEDUP_FORMATS`) razonando que el embedding de una imagen es
  un caption generado, no su identidad, y captions genéricos agruparían imágenes distintas.
  Evita un modo de fallo real que la mayoría de pipelines de dedup ingenuos no contemplan.
- **Recomendación:** Mantener. Considerar generalizar la marca `metadata.format` a otros
  artefactos cuyo embedding sea derivado (audio/transcripción) para excluirlos del dedup por
  vector cuando proceda.

#### ✅ Idempotencia online de entidades
- Índice único `(type, canonical_name)` + `ON CONFLICT` en `resolveEntity`
  (`entities.ts:16-20`) y `linkEntryToEntity` definen una identidad de entidad correcta y
  atómica en el camino online — el patrón que el batch `resolve-entities` (hallazgo 1)
  debería compartir y no comparte.

---

## Recomendaciones priorizadas

1. **(Hallazgo 1, S)** Unificar la identidad de entidad: agrupar `resolve-entities` por
   `(type, canonicalize(name))`, reutilizando la misma función del camino online. Test que
   garantice que homónimos de distinto `type` no se fusionan. *Evita corrupción irreversible
   del grafo.*
2. **(Hallazgo 2, M)** Atomizar `saveContext` y el par supersede
   (`saveContext`+`invalidateEntry`) con `sql.begin(tx)`. *Elimina estado parcial y dobles
   `current`.*
3. **(Hallazgos 6 y 7, S)** Añadir restricciones `UNIQUE` en BD:
   `(project_id, source_reference)` parcial y `(source_id, target_id, relation_type)`, con
   `INSERT … ON CONFLICT DO NOTHING`. *Convierte best-effort en garantía y acelera el
   incremental.*
4. **(Hallazgo 5, S)** Filtrar `vectorSearch`/`findNearest` por `source_type` para que el
   dedup compare contra el vecino del mismo origen, no el global.
5. **(Hallazgo 8, S)** Alinear el self-join de `lint` con `reconcileProject`: incluir
   `embedding_version` (y `chunk_index`) en el join. *Evita errores de dimensión y
   comparaciones espurias.*
6. **(Hallazgo 3, M)** Hacer los umbrales de reconciliación dependientes del modelo, o forzar
   que la reconciliación destructiva solo se active con un embedding semántico real.
7. **(Hallazgo 4, M)** Fijar dimensión del `vector` por despliegue o añadir
   `CHECK (vector_dims=dim)`; documentar que cambiar de proveedor exige re-embeber; planificar
   índice ANN.
8. **(Hallazgos 9, 10, 11, M)** Cerrar los caminos de duplicado/identidad: `update` no-agent
   → relación en vez de ADD; única fuente de verdad para vigencia; colisión de slug como
   conflicto explícito.
9. **(Hallazgos 12, 13, 14, S/M)** Deuda de fondo: corroboración explícita en vez de proxy de
   `updated_at`; índices compuestos para consultas calientes; decidir el destino de las
   columnas bi-temporales de `relations`.
10. **Transversal:** añadir una suite de tests sobre esta lógica crítica (point-in-time,
    dedup, reconciliación, idempotencia). Hoy es **cero**.
