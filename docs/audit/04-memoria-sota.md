# Calidad de memoria y retrieval vs estado del arte — Auditoría Cortex

## Valoración

Cortex implementa una base de retrieval **sólida y bien pensada para un PoC**: búsqueda
híbrida vector+FTS fusionada con RRF (K=60, el valor canónico), modelo **bi-temporal**
(`valid_from`/`valid_to`, consultas point-in-time vía `asOf`), reconciliación de escritura
estilo mem0 (ADD/UPDATE/SUPERSEDE/NOOP), herencia jerárquica de context-packs, grafo de
entidades/relaciones y trazabilidad por entrada (fuente/fecha/autor/confianza/vigencia).
Esto lo sitúa **conceptualmente por encima de un RAG plano** y en la línea de las ideas de
Zep (temporalidad) y mem0 (reconciliación). Sin embargo, frente al estado del arte 2025–2026
**no está en primera línea**: no hay ninguna evaluación de retrieval ni umbrales calibrados,
las entradas no se trocean (un vector por entrada + truncado a 8000 chars), la pieza estrella
estilo-mem0 está degradada en la práctica, el grafo es superficial, la KNN es exacta O(n) sin
índice ANN, no hay reranker cross-encoder y falta la distinción episódica/semántica. Son brechas
de **madurez y profundidad**, no de concepto: la arquitectura es correcta; le falta evaluación,
chunking y reranking para poder reclamar calidad "SOTA".

Ninguno de los hallazgos es crítico ni alto: el grueso son brechas de madurez (severidad media)
sobre una base intencionadamente de PoC ("hipótesis a validar"), más dos aciertos a preservar.

---

## Hallazgos por severidad

### 🟡 Medio

#### M1 — Sin evaluación de retrieval ni calibración de umbrales (no hay golden set, recall/precision/nDCG/MRR)
- **Evidencia:** no existe ningún harness de evaluación en el repo (grep de `eval`/`benchmark`/`recall`/`precision`/`ndcg`/`mrr`/`golden` → 0 código, sin script `eval`). El único test de búsqueda (`tests/integration/core.test.ts:25`) es un smoke test: comprueba `hits.some(h => /pgvector/.test(h.entry.content))`. Todos los umbrales son constantes mágicas sin calibrar: dup `0.85` (`operations.ts:196`), UPDATE `0.82` / NOOP `0.95` (`dedup.ts:17-18`), dedup batch `dist<0.05` (`reconcileProject`, `dedup.ts:143`). El comentario `dedup.ts:14-15` dice "calibrados con qwen3-embedding" pero no hay dataset ni script reproducible. El estado del arte publica y reproduce LOCOMO/LongMemEval/BEAM (mem0 reporta 92.5 LoCoMo / 94.4 LongMemEval con metodología abierta), y la propia disputa Zep-vs-mem0 (84% vs 58.44% vs 75.14%) demuestra que sin un harness propio no se puede afirmar calidad ni detectar regresiones.
- **Impacto:** imposible saber si un cambio mejora o degrada el retrieval; los umbrales pueden estar mal para el embedding real en uso (local vs qwen vs voyage) y nadie lo detectaría. Es el gap **más estructural** para aspirar a "primera línea": no hay forma objetiva de demostrar calidad ni de evitar regresiones al tocar RRF, dedup o reranking.
- **Recomendación:** crear un golden set pequeño (50–150 queries con relevancias por proyecto de demo) y un script `eval` que mida recall@k, nDCG@k y MRR sobre `hybridSearch`, más precisión/recall de la reconciliación (ADD/UPDATE/NOOP) y de la detección de duplicados/contradicciones. Re-calibrar `0.82/0.95/0.85/0.05` por modelo de embedding con ese set y fijarlo en CI como gate. Idealmente correr un subconjunto de LOCOMO/LongMemEval para una cifra comparable con mem0/Zep.
- **Esfuerzo:** L
- **Matiz:** los umbrales de dedup SÍ son configurables por env (`CORTEX_DEDUP_*`); es un gap de madurez/proceso real, no de severidad alta, en un PoC interno explícitamente "hipótesis a validar".

#### M2 — Las entradas de contexto no se trocean: un solo embedding por entrada y truncado duro a 8000 chars
- **Evidencia:** `storeEmbedding`/`storeEmbeddingsBatch` insertan SIEMPRE `chunk_index=0` (`vectors.ts:17,42`): una entrada = un único vector, sin importar su longitud. La columna `chunk_index` existe pero solo se usa para código (`code.ts`, `chunkFile`, tabla `code_chunks` aparte). Los conectores truncan a `MAX_CONTENT=8000` (`connect-docs.ts:53`, `connect-notion-export.ts:137`) con `slice` sin partir: un PDF de 50 páginas o una transcripción larga se convierte en UNA entrada truncada (pérdida silenciosa). El embed solo concatena título+contenido (`operations.ts:107,141`) sin contexto de documento/sección. El estado del arte usa chunking sistemático y, más allá, contextual/late chunking (Anthropic Contextual Retrieval; Late Chunking) que prepende contexto del documento al chunk antes de embeber, con ganancias grandes de recall.
- **Impacto:** pérdida directa de fidelidad: la cola de documentos largos es invisible a la búsqueda y un único vector promedia múltiples temas diluyendo la señal (peor recall y precisión). Causa más probable de "la respuesta estaba en el doc pero no la encontró" en cualquier corpus real.
- **Recomendación:** trocear entradas largas en chunks (ventana con solape) almacenados como filas con `chunk_index>0` y agregadas en el ranking (max/suma de los mejores chunks por entrada). Incorporar contexto al texto embebido (proyecto/sección/documento) como contextual chunking. Sustituir el truncado a 8000 chars por chunking en los conectores.
- **Esfuerzo:** L
- **Matiz:** impacto concentrado en los conectores de documentos largos; la memoria core son unidades de conocimiento atómicas cortas donde un solo vector es razonable, y la rama FTS recupera parte del recall.

#### M3 — La reconciliación estilo mem0 está degradada en la práctica (token cap de 60) y solo evalúa el vecino #1
- **Evidencia:** `saveWithReconciliation` (`dedup.ts:99-130`) implementa ADD/UPDATE/SUPERSEDE/NOOP, pero depende del reconciliador LLM inyectado, que corre con `maxOutputTokens=60` (`reconcile.ts:18`) frente a los 700 del merger (`reconcile.ts:11`) sobre un modelo de razonamiento por defecto: si el razonamiento agota el presupuesto, la respuesta sale vacía/truncada y el `catch` cae a `'update'`; además la decisión se extrae con `raw.match(/noop|update|supersede/i)` sobre todo el texto (puede capturar la palabra de la cadena de pensamiento). `findNearest` usa `limit:1` (`dedup.ts:38`): solo se reconcilia contra el duplicado más cercano, sin clustering. Sin LLM, el fallback determinista solo hace NOOP de near-idénticos (≥0.95, `dedup.ts:106`), y `reconcileProject` exige `dist<0.05` (`dedup.ts:143`), así que los cuasi-duplicados 0.82–0.95 se acumulan. mem0 hace una actualización de memoria LLM robusta comparando contra el conjunto recuperado, no contra 1.
- **Impacto:** el mecanismo que evita el "context rot" (la propuesta de valor diferencial vs RAG plano) no funciona como se anuncia: o no reconcilia (sin LLM, salvo casi-idénticos) o tiende a 'update' (con LLM mal presupuestado). Resultado: acumulación de cuasi-duplicados que `reconcileProject` tampoco limpia. La memoria puede degradarse con el uso, justo lo contrario del objetivo.
- **Recomendación:** subir el cap de tokens del reconciler a un valor realista para razonamiento (≥512) o separar reasoning de salida; forzar salida estructurada (JSON/enum) y parsear solo el campo de decisión, no un match libre. Comparar contra los top-k vecinos (no 1) y agrupar clusters. Avisar cuando la reconciliación queda degradada (sin LLM) en vez de fallar en silencio.
- **Esfuerzo:** M
- **Matiz:** el "SIEMPRE update" asume que el modelo por defecto emite reasoning que consume el cap y se filtra a `res.text` (dependiente del proveedor, no verificable); con `json_object` forzado (`mastra.ts`), 60 tokens bastan para `{"decision":...}`. El default real es `LLM_PROVIDER=none` (dedup determinista documentado), por lo que es degradación de calidad de la memoria, no fallo de correctitud.

#### M4 — Búsqueda vectorial KNN exacta O(n) sin índice ANN (hnsw/ivfflat)
- **Evidencia:** `embeddings.vector` (`0001_init.sql:132`, comentario en `:124`: "búsqueda exacta, sin ivfflat/hnsw") y `code_chunks.embedding` (`0003_code.sql`, solo índices project/path/GIN) son `vector` sin dimensión fija y sin índice ANN. Toda búsqueda escanea secuencialmente con `ORDER BY distance LIMIT` (`vectors.ts:97-105,181-188`; `code.ts:172-177`). Solo hay índices GIN para FTS (`0002_fts.sql:10`). Hay self-joins O(n²) reales sobre `embeddings` en `lint.ts:54-60` y `reconcileProject` (`dedup.ts:149-162`). El estado del arte usa HNSW por defecto (pgvector, Qdrant) para latencia sublineal a escala.
- **Impacto:** aceptable para la demo, pero la latencia y el coste crecen linealmente con el corpus; con decenas de miles de entradas o el código de varios repos, la búsqueda y los self-joins se vuelven impracticables. Techo de escalado a "memoria corporativa" real.
- **Recomendación:** fijar dimensión de la columna `vector` por modelo y crear índice HNSW (o ivfflat) por `(embedding_model, embedding_version)`. Añadir validación de que `length(vector)=dim`. Paginar/limitar los self-joins de `reconcileProject` y `lint`.
- **Esfuerzo:** M
- **Matiz:** limitación intencionada y documentada (ADR-0005: la dimensión variable por proveedor impide por diseño un índice que exige `vector(N)`); las consultas filtran por `project_id`+modelo (no todo el corpus). No es bug en el estado PoC actual, solo un techo a corregir antes de producción.

#### M5 — Score expuesto incoherente con el orden del ranking (mezcla coseno y RRF normalizado)
- **Evidencia:** `hybridSearch` ordena por `rrf` pero reporta `score: s.cosine ?? s.rrf / maxRrf` (`vectors.ts:144`): un hit #1 con coseno bajo puede mostrar score menor que un #2 solo-FTS (`rrf/maxRrf≈0.95`), contradiciendo el orden. `searchProjectCode` reporta `s.cosine ?? s.rrf` con rrf SIN normalizar (~0.016) junto a cosenos ~0.8 en la misma lista (`code.ts:216`). RRF es por diseño "normalization-free" y debe exponerse de forma homogénea.
- **Impacto:** el score mostrado al usuario/agente no es monótono con el ranking ni comparable entre resultados, minando la confianza y cualquier umbral aguas abajo (p.ej. "mostrar solo score>0.7"). Afecta a `/search`, `/code` y al MCP.
- **Recomendación:** exponer una única señal consistente: o el RRF normalizado para todos los hits (recomendado en híbrido), o re-puntuar con el reranker. No mezclar coseno y RRF en la misma lista. Misma corrección en `searchProjectCode`.
- **Esfuerzo:** S

#### M6 — Sin reranker cross-encoder de 2ª etapa; el único reranker es un LLM list-rank opcional, token-capado y apagado por defecto
- **Evidencia:** el reranker es opcional y solo se activa si hay LLM (`operations.ts:246,253`). Su implementación (`rerank.ts:26`) pide a un LLM un JSON `{order:[...]}` con `maxOutputTokens=300` y ante cualquier fallo deja los hits igual; no hay cross-encoder ni puntuación por par query-doc. El estado del arte considera el reranking cross-encoder "la mejora de mayor ROI" (+15–30% RAGAS) en un pipeline retrieve-top50→rerank→top-k.
- **Impacto:** se deja sobre la mesa la mejora de retrieval más efectiva. El LLM list-reranker es frágil (parsear JSON, token-cap), caro y no determinista, y no está disponible en el camino sin-LLM (modo por defecto del repo).
- **Recomendación:** integrar un reranker cross-encoder (bge-reranker / Cohere Rerank / FlashRank local) como 2ª etapa por defecto sobre un pool de ~50 candidatos, devolviendo top-k. Mantener el LLM list-rank como opción. Sobre-recuperar (ya se hace overFetch x3) y rerankear.
- **Esfuerzo:** M

#### M7 — Detección de conflictos/contradicciones muy limitada (2 ejes de polaridad por regex ES) y resolución temporal incompleta
- **Evidencia:** `polarityTags`/`polarityContradicts` (`text.ts:100-120`) solo cubren 2 ejes (keep/remove, onprem/cloud) por regex en español; cualquier otra contradicción pasa desapercibida. En `supersede`, si la entrada vieja es fuente/curado solo se crea relación `contradicts` y AMBAS quedan vigentes (`dedup.ts:117-119`) — no hay resolución temporal de cuál gana. Zep/Graphiti modelan validez temporal de hechos y responden "qué era cierto cuándo" invalidando aristas.
- **Impacto:** el sistema marca pocas contradicciones reales y, cuando lo hace sobre conocimiento curado, deja dos hechos contradictorios ambos vigentes y recuperables, que pueden alimentar respuestas inconsistentes al agente. Debilita la promesa de "memoria coherente".
- **Recomendación:** sustituir la polaridad por detección de conflicto basada en LLM sobre los top-k similares (clasificar contradicción y proponer cuál supersede) y aplicar invalidación bi-temporal también a relaciones. Exponer las contradicciones no resueltas como señal explícita en el context-pack.
- **Esfuerzo:** M

#### M8 — Sin distinción episódica/semántica ni memoria por-usuario; curación por proxy frágil
- **Evidencia:** la memoria es por-proyecto; `source_type` (`agent_session` vs `manual`/`source`) es el único proxy de origen, pero no hay taxonomía episódica vs semántica vs procedural ni personalización por usuario (`createdBy` se guarda pero `searchContext` no lo usa). La "corroboración" que promueve confianza se infiere de `updated_at > created_at + 1min` (`curate.ts:25,32`), que cualquier UPDATE colateral dispara. Letta/MemGPT y LangMem separan episódica, semántica y procedural, y aplican retención/decay por acceso.
- **Impacto:** no se puede distinguir "lo que pasó en una sesión" del "hecho consolidado del proyecto", ni adaptar la memoria por persona/agente. La promoción de confianza puede falsear la señal de calidad (una fusión de entidades "corrobora" sin recurrencia real).
- **Recomendación:** modelar explícitamente el tipo de memoria (episódica/semántica) y, si aplica, scope por usuario/agente además de por proyecto. Basar el decay/promoción en frecuencia de acceso/recurrencia real (recuento de recuperaciones o de matches de reconciliación), no en `updated_at`.
- **Esfuerzo:** M

### 🟢 Bajo

#### B1 — FTS y embeddings monolingües sin detección de idioma
- **Evidencia:** la rama léxica hardcodea config `'spanish'` para entradas (`vectors.ts:109,111`) y `'simple'` para código (`0003_code.sql:15`); no hay detección de idioma del contenido. Un corpus en inglés (frecuente en software) se stemmiza con reglas españolas, degradando el BM25/`ts_rank`. No hay ponderación BM25 vs vector configurable en la fusión RRF.
- **Impacto:** pérdida de precisión léxica en contenido no español. El RRF mitiga algo vía la rama vectorial, pero la consulta léxica aporta poco en inglés.
- **Recomendación:** detectar idioma por entrada y almacenar el `tsvector` con la config adecuada (o `'simple'` + n-gramas para multilingüe). Permitir peso configurable entre ramas en la fusión.
- **Esfuerzo:** M

---

## Qué está bien (preservar)

#### 🟢 Búsqueda híbrida vector+FTS+RRF correctamente implementada
`hybridSearch` (`vectors.ts:64-146`) ejecuta rama vectorial (pgvector `<=>`) y léxica (FTS) y las fusiona con **RRF K=60** (valor canónico), sobre-recupera `pool=max(limit*4,40)` y aplica filtros comunes (proyecto/tipo/temporal/estado) a ambas ramas de forma coherente. Coincide con el patrón recomendado por el estado del arte (BM25+vector→RRF, +8–15% sobre métodos puros). Base de retrieval correcta y por encima de un RAG vector-only. **Mantener**; como mejora incremental, parametrizar K y el tamaño del pool y añadir el reranker cross-encoder (M6).

#### 🟢 Modelo bi-temporal + provenance por entrada: ventaja real frente a memorias planas
Cada entrada conserva fuente/fecha/autor/confianza/estado/vigencia y soporta consultas point-in-time con `asOf` (`vectors.ts:88-92`, `operations.ts:308` `getContextPack(...,asOf)`). La invalidación es "invalidar ≠ borrar" (`valid_to`/`validity='historical'`/`superseded_by`, `dedup.ts:61-67`). Es exactamente la dimensión temporal por la que Zep/Graphiti puntúan mejor en preguntas "qué era cierto cuándo"; muchas memorias flat (mem0 clásico) no la tienen. **Diferenciador genuino** para una memoria corporativa auditable, bien alineado con el principio de trazabilidad del proyecto. **Mantener y explotarlo:** exponer point-in-time en UI/MCP de forma más visible, extender la validez temporal a las relaciones del grafo (hoy solo a entradas) y validar el formato de `asOf` (hoy un `Invalid Date` se propaga silencioso en el MCP).

---

## Recomendaciones priorizadas (esta dimensión)

1. **Crear un harness de evaluación + golden set** (M1, L) — sin esto no se puede demostrar calidad ni evitar regresiones; es el prerrequisito para tocar con seguridad RRF, dedup y reranking.
2. **Añadir reranker cross-encoder de 2ª etapa por defecto** (M6, M) — la mejora de retrieval de mayor ROI; disponible también en el modo sin-LLM.
3. **Trocear entradas largas con (contextual) chunking** y eliminar el truncado a 8000 chars en los conectores (M2, L) — recupera la cola de documentos largos.
4. **Arreglar la reconciliación estilo-mem0**: cap de tokens realista + salida estructurada + top-k con clustering + aviso en modo degradado (M3, M).
5. **Homogeneizar el score expuesto** (RRF normalizado consistente) en `hybridSearch` y `searchProjectCode` (M5, S) — quick win de coherencia/confianza.
6. **Índice ANN (HNSW/ivfflat) + dimensión fija por modelo** y paginar self-joins (M4, M) — antes del salto a producción/escala.
7. **Detección de conflictos por LLM + invalidación bi-temporal de relaciones** (M7, M).
8. **Modelar memoria episódica/semántica y basar el decay en recurrencia real de acceso** (M8, M).
9. **Detección de idioma para FTS/embeddings + pesos configurables en la fusión** (B1, M).
10. **Preservar y explotar** la base híbrida RRF y el modelo bi-temporal+provenance (activos diferenciales).
