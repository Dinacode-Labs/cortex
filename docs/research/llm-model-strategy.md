# Estrategia de modelos LLM y chunking — propuesta

- **Estado:** dirección acordada (2026-07-13), registrada en `docs/decisions.md`
  (**ADR-0023**). Este documento es el detalle (costes, benchmarks, métodos); el ADR
  es el resumen decisorio. Pendiente solo la implementación por fases (§8).
- **Fecha:** 2026-07-13.
- **Contexto:** hoy los 7 agentes Mastra usan **un único modelo** (`getLlmConfig()`
  no distingue roles) y el chunking tiene un fallo grave en documentos (ver §5).
  Este documento define (a) asignación de modelo por rol con estimación de costes,
  y (b) un plan de chunking con métodos contrastados, sin sobre-ingeniería.
- **Restricción nueva (2026-07-13): perdemos el acceso a NaN próximamente.** NaN servía
  4 patas (chat, embeddings `qwen3-embedding`, visión, whisper); **todas** hay que
  reubicarlas. Esto tumba la opción "todo-NaN" y la híbrida (ver §4): el plan pasa a ser
  **todo-OpenRouter para chat/visión + OpenAI para embeddings y STT**. El proveedor
  `local` actual **no es una alternativa**: es *feature hashing* léxico
  (`packages/embeddings/src/local.ts`), no un embedding semántico — sirve para tests y
  arrancar sin claves, no para relevancia real. Consecuencia: **sin NaN, hasta el
  desarrollo local necesita una API key** (coste de céntimos, ver §3.1).
- **Principio:** tiene que funcionar bien sin dispararse de coste, y queremos
  **aprender a hacer las cosas por nuestra cuenta** (retrieval sobre pgvector propio,
  no un RAG gestionado que esconda las decisiones).

## 1. Inventario de roles LLM y criticidad

El criterio de asignación no es "qué modelo es mejor" sino **qué pasa si el modelo
se equivoca**. Hay roles donde un error destruye conocimiento (reconciler decide
`supersede`, merger reescribe) y roles donde solo molesta (un rerank mediocre).

| Rol | Se llama en | Input típico | Output cap | Si falla… | Criticidad |
|---|---|---|---|---|---|
| classifier | cada save | contenido entrada | 2000 | tipo/título mal → lo corrige el lint | media |
| graph (enrich) | cada save + backfill | `content.slice(0,3500)` | 1200 | grafo con ruido | media |
| reranker | cada búsqueda | ~30 hits × 200 chars | 300 | orden subóptimo | media |
| reconciler | dedup (sim 0.82–0.95) | 2 piezas | 60 | **invalida conocimiento bueno** | **alta** |
| merger | reconcile→update | 2 piezas | 700 | **pierde matices al fusionar** | **alta** |
| distiller | captura de sesiones | ventanas ~9k chars | 1500 | **conocimiento capturado pobre** | **alta** |
| retriever | cada ask | snippets recuperados | 900 | respuesta mala **visible al usuario** | **alta** |
| media (visión/OCR) | ingesta docs/imágenes | imagen + prompt | ~1000 | doc no indexable | media |
| embeddings | todo save/búsqueda | — | — | **todo el retrieval degrada** | **alta** |

Datos reales (`llm_usage`, 24 jun–7 jul, 488 llamadas): `graph` domina el volumen
(459 llamadas, ~616 in / ~943 out tokens); embeddings ~4.5k tokens/lote. El resto
aún casi sin tráfico → las estimaciones de §3 son supuestos declarados, revisar con
`llm_usage` cuando haya uso real.

**Gap detectado:** `media.ts` usa el mismo modelo que el chat (`getLlmConfig().model`).
Con un modelo text-only (p. ej. DeepSeek) la ingesta de imágenes/PDF escaneado **falla
silenciosamente**. La visión necesita configuración propia sea cual sea la opción.

## 2. Propuesta principal: todo OpenRouter, calidad media-alta

Dos niveles dentro de OpenRouter — barato para lo mecánico de volumen, medio-alto
para el juicio — y un tercer nivel para la superficie visible (retriever). OpenRouter
**no sirve embeddings ni speech-to-text** (solo chat/completions), así que esas dos
patas van con **OpenAI** (ya soportado: `EMBEDDINGS_PROVIDER=openai`). Un mismo
proveedor (OpenAI) cubre embeddings **y** whisper → menos vendors que gestionar.

Precios a 2026-07-13 ($/M tokens, catálogo OpenRouter):

| Rol | Modelo | ctx | $ in | $ out | Por qué |
|---|---|---|---|---|---|
| classifier | `deepseek/deepseek-v4-flash` | 1M | 0.08 | 0.15 | mecánico, JSON, volumen |
| graph | `deepseek/deepseek-v4-flash` | 1M | 0.08 | 0.15 | el mayor consumidor: aquí manda el precio |
| reranker (LLM) | `deepseek/deepseek-v4-flash` | 1M | 0.08 | 0.15 | listwise sobre 30 títulos; sobra |
| reconciler | `deepseek/deepseek-v4-pro` | 1M | 0.43 | 0.87 | juicio noop/update/supersede |
| merger | `deepseek/deepseek-v4-pro` | 1M | 0.43 | 0.87 | reescribe conocimiento |
| distiller | `deepseek/deepseek-v4-pro` | 1M | 0.43 | 0.87 | la calidad de lo destilado es el producto |
| retriever | `x-ai/grok-4.5` | 500k | 2.00 | 6.00 | lo único que ve el usuario; mismo tier que sonnet-5 (AA II 54 vs 53) con output 40% más barato. Alternativas: `anthropic/claude-sonnet-5` (2/10), contenida `openai/gpt-5-mini` (0.25/2) |
| media/visión | `qwen/qwen3.5-flash-02-23` | 1M | 0.07 | 0.26 | multimodal barato para caption/OCR |
| embeddings | OpenAI `text-embedding-3-large` | — | 0.13 | — | 3072 dims, buen multilingüe; *upgrade* opcional Voyage `voyage-3.5` si un eval lo justifica |
| STT | OpenAI `whisper-1` | — | $0.006/min | — | OpenRouter no tiene STT |

**Embeddings — por qué OpenAI y no local/MiniLM.** Con NaN fuera, la elección real es
API (OpenAI/Voyage) vs. servir un modelo local en Node. Recomendamos
`text-embedding-3-large` por calidad multilingüe (el corpus es en **español**),
simplicidad operativa (misma cuenta que whisper) y coste marginal (§3.1). **MiniLM
queda descartado**, y conviene entender por qué no es solo "gratis vs. de pago":

- **Idioma.** `all-MiniLM-L6-v2` está entrenado en inglés; sobre contenido en español
  rinde flojo. La variante multilingüe (`paraphrase-multilingual-MiniLM-L12-v2`) mejora
  pero sigue en gama media (MTEB ~56 vs. ~64+ de 3-large).
- **Arrastra al write path.** Toda la dedup/reconciliación (umbrales 0.82/0.95) cabalga
  sobre la calidad del embedding: un modelo débil → más falsos merges y duplicados. El
  error sale caro y es el flujo que menos queremos degradar.
- **Peso operativo.** En Node exige `transformers.js`+onnxruntime (binding nativo) o un
  sidecar Python; una API de embeddings es más simple de operar en un producto que
  "tiene que funcionar".
- **Cuándo SÍ tendría sentido lo local:** un cliente con exigencia de *no-API externa /
  datos on-prem*. Y ahí tampoco elegiríamos MiniLM sino un multilingüe bueno
  (**bge-m3** o **multilingual-e5-large**). Lo dejamos como contingencia documentada,
  no como plan.

Notas operativas OpenRouter:

- **Fallbacks nativos**: el parámetro `models: [...]` permite lista de respaldo por
  petición, y el routing entre providers del mismo modelo da resiliencia sin código.
- **Prompt caching**: DeepSeek cachea prefijos automáticamente (lecturas ~90% más
  baratas); nuestros system prompts son cortos, beneficio menor pero gratis.
- OpenRouter cobra ~5% al comprar créditos; incluido de sobra en el margen de §3.
- Reranker dedicado: si el rerank LLM se queda corto, `voyage rerank-2.5`
  (~$0.05/M, API aparte) es el candidato del ADR-0009 — no urgente.
- **Política de datos:** Cortex maneja conocimiento corporativo confidencial.
  Al elegir provider en OpenRouter, activar el filtro de providers sin
  data-collection (ZDR donde exista) y verificar la política del provider
  concreto que sirve cada modelo (aplica a xAI, DeepSeek y a cualquiera).

### 2.1 Base de evidencia (benchmarks, 2026-07-13)

Puntuaciones del [Artificial Analysis Intelligence Index v4.1](https://artificialanalysis.ai/leaderboards/models)
(reasoning/agentic; complementa, no sustituye, a nuestros mini-evals del §7):

| Modelo | AA II v4.1 | Blended $/M | Lectura |
|---|---|---|---|
| GPT-5.6 Sol (max) | 59 | 4.35 | frontier, fuera de presupuesto para esto |
| Claude Opus 4.8 | 56 | 3.85 | ídem |
| **Grok 4.5** | **54** | **1.35** | el top-10 más barato → pick del retriever |
| Claude Sonnet 5 | 53 | 1.54 | alternativa al retriever (1M ctx, mejor en coding) |
| Gemini 3.5 Flash | 50 | 1.31 | alternativa media |
| Qwen3.7 Max | 46 | 1.43 | — |
| **DeepSeek V4 Pro** | **44** | **0.18** | líder open-weights (empatado con MiniMax-M3 0.22 y Kimi K2.6 0.70) → juicio |
| **DeepSeek V4 Flash** | **40** | **0.06** | a 4 puntos del Pro por ⅓ del precio → mecánico |
| Grok 4.3 | 38 | 0.64 | ⚠️ parece chollo por precio, pero puntúa por debajo de v4-flash: descartado |

Caveats: (a) el índice mide razonamiento/agentic, no síntesis fundamentada en
español ni extracción JSON — para eso mandan nuestros mini-evals; (b) el precio
"blended" de AA incluye tokens de reasoning y difiere del precio de lista;
(c) los scores son de variantes con esfuerzo alto (max/high) — en producción
usaremos esfuerzos por defecto. Revisar el leaderboard al implementar Fase 3.

## 3. Estimación de costes

Supuestos (equipo ~10 devs, 22 días laborables/mes, declarados para revisar):
2.200 entries/mes (saves+conectores), 3.520 ventanas de distill, 6.600 búsquedas,
1.100 asks, ~1.000 páginas/imágenes ingeridas, ~35M tokens de embeddings.

| Partida | Modelo | Tokens/mes (in/out) | Coste/mes |
|---|---|---|---|
| classify + graph | v4-flash | 5.5M / 3M | ~$0.90 |
| distill | v4-pro | 8.8M / 1.8M | ~$5.35 |
| reconcile + merge | v4-pro | ~1M / 0.35M | ~$0.75 |
| rerank | v4-flash | 13.2M / 1M | ~$1.20 |
| retriever (asks) | grok-4.5 | 1.65M / 0.55M | ~$6.60 |
| visión/OCR | qwen3.5-flash | ~1.3M / 0.3M | ~$0.20 |
| embeddings | 3-large | ~35M | ~$4.55 |
| **Total** | | **~36M** | **~$20/mes** |

- Con `claude-sonnet-5` en retriever: +$2. Con `gpt-5-mini`: **~$14/mes**. Con
  `text-embedding-3-small`: −$4.
- Escenario ×5 (uso intenso): **~$100–110/mes**. Sigue siendo marginal frente a una
  sola licencia de herramienta SaaS.
- Punto de atención: **reindexado completo de código** de un repo grande puede ser
  ~50M tokens de embeddings ≈ $6.5 por reindex con 3-large. Indexar incremental
  (por mtime/hash, ya soportado) y no reindexar en bucle.

**Conclusión de coste:** con esta arquitectura el coste no es el problema; el trabajo
está en el routing por rol y en el chunking (§5). El riesgo de "salirnos por un ojo
de la cara" solo aparecería metiendo modelos frontier en el write path — y no hay
motivo: la evidencia (Contextual Retrieval de Anthropic, pipelines RAG del mercado)
es que el write path funciona con modelos pequeños si el retrieval está bien hecho.

### 3.1 Coste de ingerir el backlog existente (one-time)

Hoy solo hemos embebido **a nivel de pruebas**, así que no hay que *reembeddar* nada
real (la calibración de umbrales §6.5 se hace una vez con el modelo elegido, sin
migración). Lo que sí habrá que presupuestar es la **carga inicial** del contenido que
ya tenemos: documentación, tareas/tickets, notas de reunión, código de repos.

Hay que separar dos costes que la gente confunde:

- **Embeddings puros** (vectorizar el texto): **baratísimo**. Regla de oro con
  `text-embedding-3-large`: **~$0.13 por millón de tokens**. Para estimar tokens de un
  corpus: `chars/4`, o a ojo `docs × 2.500 + tareas × 200 + líneas_de_código × 12`.
- **Pipeline de enriquecimiento** (correr classify + graph + distill + —opcional—
  el prefijo de Contextual Retrieval por chunk): aquí manda el LLM, no el embedding.
  Es donde de verdad se acumula el coste de "ingerir bien" un backlog grande.

Escenarios (tokens = contenido total del corpus a ingerir):

| Escenario | Tokens aprox | Solo embeddings (3-large) | + Pipeline completo (flash/pro) | Total one-time |
|---|---|---|---|---|
| 1 proyecto piloto (tipo CE Portal) | ~1M | ~$0.13 | ~$1–2 | **< $3** |
| Backlog moderado (~10 proyectos) | ~15M | ~$2 | ~$5–8 | **~$10** |
| Todo, agresivo (~30 proyectos, mucho doc+código) | ~100M | ~$13 | ~$35–50 | **~$50–65** |

Notas:

- Con `text-embedding-3-small` la columna de embeddings baja ~6× (100M → ~$2) a costa
  de algo de calidad; con Voyage `voyage-3.5` queda en un punto intermedio (~$6 a 100M).
- El **pipeline completo es opcional y gradual**: puedes embeber ya (barato) y correr
  el enriquecimiento por lotes/de fondo, o solo sobre los proyectos que se van
  activando. No es un big-bang obligatorio.
- El **Contextual Retrieval** (§5.2) es la partida más cara del pipeline porque hace
  1 llamada LLM por chunk; con prompt caching del documento y modelo flash sigue siendo
  del orden de esas cifras. Actívalo cuando el eval (§7) demuestre que mejora el
  retrieval, no "por si acaso".
- Cota superior mental: **embeber TODO lo que Dinacode tenga hoy cuesta decenas de
  dólares una vez**, no miles. El gasto recurrente relevante es el mensual del §3.

## 4. Alternativas consideradas (y por qué quedan fuera)

- **Todo NaN (coste 0€) — DESCARTADA: perdemos el acceso.** El cluster cubría todos
  los roles gratis (qwen3.6, deepseek-v4-flash, qwen3-embedding, whisper, rerank), pero
  dejaremos de tener acceso próximamente, incluso para desarrollo. Queda como registro
  histórico de por qué el código soporta `LLM_PROVIDER=nan`/`EMBEDDINGS_PROVIDER=nan`
  (se pueden podar cuando se confirme la baja).
- **Híbrida NaN + OpenRouter — DESCARTADA:** dependía de NaN como default. Sin NaN no
  hay nada que hibridar. La resiliencia se cubre con los **fallbacks nativos de
  OpenRouter** (`models: [...]` y routing entre providers), sin segundo proveedor.
- **Embeddings locales (MiniLM u otros) — DESCARTADA como plan** (detalle en §2):
  MiniLM es inglés-céntrico y gama media sobre un corpus español, y arrastra al dedup;
  cualquier opción local buena (bge-m3/e5) añade runtime nativo en Node. Contingencia
  documentada solo para un futuro requisito on-prem/no-API de algún cliente.
- **Vertex AI / RAG gestionado: descartado por ahora.** Lo que aportaría (RAG Engine,
  Vector Search gestionado) es exactamente lo que queremos aprender a hacer nosotros,
  con costes de suelo (índices gestionados facturan por infra desplegada, decenas de
  $/mes en vacío), lock-in de embeddings/índice, y sin ventaja de calidad sobre
  pgvector + híbrido + rerank bien hechos a nuestra escala. Revisar solo si algún
  cliente exige SLA/compliance de hyperscaler o la escala supera lo razonable en un
  Postgres (decenas de millones de vectores).

## 5. Chunking: diagnóstico y plan

Auditoría del pipeline actual, de peor a mejor:

| # | Qué | Dónde | Gravedad |
|---|---|---|---|
| 1 | Documentos: **sin chunking + truncado silencioso a 8.000 chars** — un doc entero es 1 entry / 1 vector | `apps/cli/src/commands/connect-docs.ts` (`MAX_CONTENT`) | 🔴 crítica |
| 2 | Transcripts: cap de 8 ventanas (~72k chars) pierde la cola; ventanas sin solapamiento parten decisiones | `packages/agents/src/transcript-utils.ts` | 🟠 media |
| 3 | Asimetría query/documento no aprovechada (relevante con Voyage `input_type`; con 3-large no aplica) | `packages/embeddings/src/remote.ts` | 🟢 según modelo |
| 4 | Código: 60 líneas fijas / overlap 10 — sin conciencia de límites de función | `packages/core/src/code.ts` | 🟢 aceptable |
| 5 | Entries atómicas 1:1 con su vector — correcto por diseño (piezas de 1–3 frases) | `packages/core/src/save.ts` | 🟢 ok |

El punto 1 significa que **hoy ingerir documentación larga no sirve**: de un PDF de
40 páginas solo sobreviven ~3, y lo que sobrevive se recupera mal (un vector no
representa un documento). Es el fix con más impacto por línea de código de todo el
sistema.

### Métodos propuestos (con fundamento, sin inventos)

1. **Structure-aware chunking para documentos.** Trocear respetando la estructura
   (headings de Markdown, páginas/secciones de PDF, párrafos como último recurso) en
   chunks objetivo de **800–1.200 tokens**, con solape 10–15% solo donde no haya
   frontera natural. Cada chunk guarda referencia al doc padre y su posición
   (`metadata: {file, section, order}`). Es el estándar de facto; lo exótico sería
   no hacerlo.
2. **Contextual Retrieval** (Anthropic, 2024). Antes de embeder cada chunk, generar
   con LLM un prefijo de 50–100 tokens que sitúe el chunk en su documento ("Este
   fragmento pertenece al contrato X, sección de penalizaciones…"). Combinado con
   búsqueda híbrida + rerank (que ya tenemos, ADR-0009) reduce fallos de retrieval
   ~50–65% según su evaluación. Coste con v4-flash: ~$1/mes a nuestro volumen
   (con prompt caching del doc, menos). Barato porque el write path es barato.
   > **Actualización (jul 2026):** APLAZADO tras la investigación de
   > [chunking-strategies.md](./chunking-strategies.md) — números de vendor no
   > reproducibles, y la contextualización barata (título+sección ya embebidos por el
   > chunker v1) captura parte del beneficio. Adoptar solo si el eval set muestra
   > fallos por pérdida de contexto de documento.
3. **Parent-document retrieval (small-to-big).** Se busca por el vector del chunk
   (preciso), se entrega al context-pack/síntesis la sección padre (contexto
   completo). Encaja directo con el `context_pack` actual.
4. **Transcripts:** subir `CORTEX_SESSIONS_MAX_WINDOWS` (8 → 32, es env) y añadir
   solape de ~500 chars entre ventanas. El distiller ya deduplica aguas abajo
   (dedup/reconcile), así que el solape no genera duplicados netos.
5. **Asimetría query/documento** (dependiente del modelo): con `text-embedding-3-large`
   no aplica (no distingue rol). Si migramos a **Voyage**, usar `input_type="query"` vs
   `"document"` mejora el retrieval sin reembeddar los documentos. Antes lo cubría el
   instruct-prefix de qwen3-embedding (ya retirado con NaN).
6. **Código (futuro, no urgente):** chunking por límites de función/clase con
   tree-sitter en vez de 60 líneas fijas. Solo cuando la búsqueda de código muestre
   fallos reales atribuibles a cortes.

### Qué NO vamos a hacer (y por qué)

- **Late chunking / token-level pooling:** requiere acceso a los embeddings por
  token, que las APIs (NaN/OpenAI/Voyage) no exponen. No viable sin servir el
  modelo nosotros.
- **Semantic chunking por similitud entre frases:** complejidad y coste extra sin
  evidencia consistente de que supere al chunking estructural en corpus como el
  nuestro (docs de proyecto con estructura clara).
- **GraphRAG completo:** ya tenemos grafo ligero de entidades (ADR del enrich);
  construir comunidades/resúmenes jerárquicos es otra liga de coste y complejidad
  para un beneficio no demostrado a nuestra escala.

## 6. Cambios de arquitectura necesarios

1. **Config de modelo por rol.** `getLlmConfig(role?)`: cada rol resuelve
   `CORTEX_MODEL_<ROLE>` (p. ej. `CORTEX_MODEL_DISTILLER=deepseek/deepseek-v4-pro`)
   con fallback al modelo por defecto del provider. Un solo punto de cambio en
   `mastra.ts` (hoy construye un modelo compartido para todos los agentes).
2. **Modelo de visión separado:** `CORTEX_VISION_MODEL` para `media.ts` (hoy hereda
   el modelo de chat y se rompe con modelos text-only).
3. **Loguear el modelo servido:** `recordUsage` guarda el modelo *pedido*; añadir el
   `model` que devuelve la respuesta (detecta la degradación silenciosa de NaN y
   el routing de OpenRouter).
4. **Resiliencia de provider:** usar `models: [...]` de OpenRouter (lista de respaldo
   por petición) en lugar de un segundo proveedor. Con la config por rol esto es una
   tabla, no un if.
5. **Umbrales de dedup acoplados al embedding:** 0.82/0.95 se calibraron para
   qwen3-embedding (4096-dim). Al fijar `text-embedding-3-large` (3072-dim) hay que
   **recalibrar** `CORTEX_DEDUP_THRESHOLD`/`CORTEX_DEDUP_NOOP` con el nuevo modelo.
   Como hoy solo hay embeddings de prueba, **no hay migración**: se calibra una vez con
   el modelo definitivo (medir exacto/paráfrasis/distinto sobre unas decenas de pares).

## 7. Validación: aprender midiendo (mini-evals)

Para "hacer las cosas bien por nuestra cuenta" hace falta medir, no opinar:

- **Set de evaluación de retrieval:** 30–50 preguntas reales con las entries/chunks
  que deberían recuperar (sobre el seed + un proyecto real). Medir recall@5 y MRR.
- Ejecutarlo **antes y después** de cada cambio de §5 (chunking de docs, contextual
  retrieval, instruct-prefix) y de cualquier cambio de modelo de embeddings.
- **Re-test del rerank dedicado:** el ADR-0009 evaluó `/v1/rerank` de NaN; existe un
  `/v2/rerank` posterior. Test barato: 20 queries del set con juicio manual.
- Cortes de coste reales: revisar `llm_usage` mensualmente contra las estimaciones
  de §3 y ajustar el routing si algún rol se dispara.

## 8. Plan por fases

| Fase | Qué | Impacto |
|---|---|---|
| 0 | Migrar off-NaN: `EMBEDDINGS_PROVIDER=openai` (3-large) + STT/visión a OpenAI/OpenRouter + calibrar umbrales (§6.5) | **urgente**: sin NaN, hoy no hay embeddings semánticos |
| 1 | Chunking de documentos (§5.1) + set de evals | desbloquea la ingesta de docs |
| 2 | Config por rol + visión separada + log de modelo servido (§6.1–3) | habilita el routing |
| 3 | Routing propuesto (§2) — flash/pro/grok-4.5 por rol | calidad media-alta a ~$20/mes |
| 4 | Contextual retrieval (§5.2) | +calidad retrieval, medida con evals |
| 5 | Resiliencia OpenRouter `models:[...]` (§6.4), re-test rerank v2 | robustez y throughput |

## 9. Riesgos y cuándo revisar

- **Dependencia dura de API (nuevo, tras perder NaN):** ya no hay proveedor gratis ni
  local semántico. Cortex necesita OpenRouter (chat/visión) + OpenAI (embeddings/STT)
  para funcionar de verdad, también en desarrollo. Gestionar las keys y un tope de
  gasto/alerta por proveedor. El `local` feature-hash solo sirve para tests/CI.
- Precios de OpenRouter cambian sin aviso → revisar catálogo al implementar Fase 3.
- DeepSeek v4 es hoy la mejor relación calidad/precio; si aparece un sustituto
  claro, la config por rol (Fase 2) hace el cambio trivial — esa es la apuesta
  arquitectónica real de este documento.
- Si el volumen real supera ×5 las estimaciones, reevaluar (seguiría siendo ~$100/mes,
  pero conviene mirar prompt caching y batching en serio).
- Vertex/gestionado: revisar solo con exigencia de SLA/compliance de cliente o
  escala fuera del rango razonable de pgvector.
