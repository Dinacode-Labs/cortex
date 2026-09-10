# Estrategias de chunking para RAG — investigación (jul 2026)

- **Estado:** investigación completada (2026-07-13). Responde al follow-up del roadmap
  («investigar estrategias de chunking antes de invertir más», PR #32) y a la duda de
  fondo: *¿el tamaño fijo nos va a funcionar? ¿importa tanto el chunking con RAG híbrido?*
- **Método:** deep-research con verificación adversarial — 22 fuentes primarias (papers,
  docs oficiales, benchmarks reproducibles), 109 afirmaciones extraídas, 25 verificadas
  con 3 votos independientes cada una: **23 confirmadas, 2 refutadas**. Se citan solo las
  confirmadas; las refutadas y los sesgos, al final.
- **Conclusión en una frase:** nuestro chunker estructural v1 es exactamente el patrón
  que la evidencia respalda; lo que toca ahora no es sofisticar el chunker sino
  **construir el eval set** y añadir una mejora barata (contexto estructural al embeber)
  que en gran parte ya tenemos.

## 1. Cómo trocean los frameworks de referencia (verificado contra código/docs)

| Framework | Estrategia | Lo relevante para nosotros |
|---|---|---|
| **Docling** (IBM) | `HierarchicalChunker` (1 chunk por elemento estructural) + `HybridChunker` (2 pasadas token-aware: divide solo lo que excede el límite, fusiona vecinos pequeños con mismos headings) + `contextualize()` (prepende headings/captions al embeber — **sin LLM**) | Es el patrón "estructural → tokens" idéntico en espíritu a nuestro v1. Su contextualización es concatenación determinista de metadata, no una llamada LLM. |
| **RAGFlow** | ~12 plantillas **por tipo de documento** (General, Laws, Paper, Manual, One…). Default 'General': tope de 512 tokens con límites delimiter-aware. **'One'** = documento entero como 1 chunk, opción de primera clase | Los productos serios no usan un splitter único: adaptan por tipo de doc. Y validan nuestro comportamiento de "doc corto = 1 chunk". |
| **LlamaIndex** | Semantic chunking **solo como opción explícita** (`SemanticSplitterNodeParser`), con advertencia oficial: su segmentador de frases **está diseñado para inglés** y el umbral necesita tuning | Aviso directo contra aplicar semantic chunking out-of-the-box a nuestro corpus en español. (Ojo: los supuestos defaults "1024/20" de LlamaIndex fueron **refutados** en verificación — no citarlos.) |
| **Anthropic** | Contextual Retrieval: LLM prepende 50–100 tokens de contexto por chunk antes de embeber y de indexar en BM25 | La técnica con mayores ganancias medidas (§3), pero eval interno de vendor. |
| **Jina** | Late chunking: embeber el doc entero y trocear antes del pooling | Mecánicamente **inviable para nosotros**: requiere embeddings por token, que `text-embedding-3-large` vía API no expone. |

## 2. La evidencia empírica sobre tamaño y estrategia

- **El chunking importa, pero de forma acotada** (benchmark de Chroma, reproducible,
  con `text-embedding-3-large`): la elección de estrategia movió el recall **hasta ~9
  puntos** entre la mejor y la peor. Y la peor fue precisamente un default popular:
  RecursiveCharacterTextSplitter a **800 tokens con 400 de solape** (el default estilo
  OpenAI Assistants) — peor precisión/IoU con recall solo mediocre.
- **El estructural bien parametrizado empata con el semántico** (Chroma + paper
  peer-reviewed NAACL 2025): recursive ~200 tokens 88.1% de recall vs 87.3% del
  ClusterSemanticChunker; en el ejemplo insignia del propio benchmark, hasta el chunker
  más tosco (cortes fijos de 1200 chars) da 0.809 de recall. El paper NAACL concluye
  textualmente que **el coste extra del semantic chunking no está justificado por
  ganancias consistentes**: solo gana en documentos artificialmente "cosidos" con
  diversidad temática irreal; en docs reales, fixed-size ganó en los 4 datasets
  originales y la generación end-to-end fue prácticamente idéntica.
- **Por qué tantos benchmarks no detectan nada** ("evidence sparsity", confianza media,
  voto 2-1 y conflicto de interés del autor): cuando solo ~2 frases del doc son
  relevantes por query, todos los chunkers rinden casi igual; las diferencias afloran en
  queries **evidence-dense** (~20 frases relevantes: "¿qué se decidió sobre X y por
  qué?") — que son justo las típicas de una memoria de proyecto. Nuestro eval set debe
  incluirlas.
- **Contextual Retrieval (Anthropic)** es la única técnica con ganancias grandes
  medidas: −49% de fallos de retrieval con híbrido y **−67% añadiendo reranker**
  (1−recall@20, evals internos; corroboración independiente de Unstructured: −47% en
  10-Ks de la SEC). Coste one-time ~$1–5/M tokens de documento. **Los beneficios de
  contexto, híbrido y rerank se apilan** — no se sustituyen.
- **Late chunking**: ganancia real pero modesta (+2.7–3.6% relativo de nDCG@10) y
  dependiente de corpus; en un head-to-head pequeño empata con Contextual Retrieval sin
  coste LLM. Irrelevante para nosotros por la limitación de API (§1).

## 3. La pregunta clave: ¿importa el chunking con híbrido + RRF + rerank?

**No existe la ablación directa** (nadie ha publicado chunking × rerank de forma
controlada — es el hueco de evidencia central). La evidencia indirecta acota la
respuesta por los dos lados:

1. **Las capas se suman, no se compensan**: el reranker de Anthropic aportó ganancia
   *adicional* (2.9%→1.9% de fallos) incluso sobre retrieval híbrido ya contextualizado.
2. **A granularidad comparable, las diferencias entre chunkers en corpus reales ya son
   pequeñas incluso sin rerank** (NAACL 2025 usó denso puro).
3. **Lo que el rerank no puede arreglar**: evidencia partida entre chunks o contexto de
   documento perdido dentro del chunk. Eso lo arreglan el solape, el tamaño y la
   contextualización — el reranker solo reordena lo que ya se recuperó.

Conclusión operativa: con nuestro pipeline (híbrido RRF + rerank LLM), el retorno
marginal de sofisticar el chunker más allá de "estructural con parámetros sensatos" es
**bajo**. La intuición inicial del equipo era correcta.

> ⚠️ **Pista sin verificar** (extraída pero fuera del top-25 verificado): un paper
> (arXiv 2604.01733) afirmaría que incluso con híbrido + reranker, el chunking movió
> 8–10 pp de Retrieval Completeness. Contradiría parcialmente el punto 2 — **leerlo
> antes de dar este capítulo por cerrado**, pero no citarlo como hecho.

## 4. Qué significa para Cortex (plan)

1. **Mantener el chunker v1** (estructural: headings→párrafos→frases, ~1000 tokens,
   solape 400 chars). Es el patrón Docling/RAGFlow y la evidencia lo respalda como
   competitivo. No migrar a semantic chunking (sin ganancias peer-reviewed, tooling
   English-only) ni a late chunking (inviable vía API). Si los evals lo sugieren,
   probar bajar el tamaño objetivo (los mejores resultados de Chroma están en 200–400
   tokens — con el caveat de que sus métricas penalizan chunks grandes y no usó rerank).
2. **Contextualización barata sin LLM — en gran parte YA la tenemos**: `connect-docs`
   embebe `título-doc (k/N · sección)\n\ncontenido`, que es el patrón `contextualize()`
   de Docling. Mejora incremental posible: añadir proyecto/tipo/fecha al texto embebido.
   Coste cero; medirla en el eval, no asumirla.
3. **Eval set propio ANTES que cualquier cambio más de chunker** (30–100 queries en
   español sobre corpus real, con evidencia anotada; incluir queries evidence-dense
   tipo "¿qué se decidió sobre X, cuándo y por qué?"). El benchmark de Chroma es
   open-source (MIT, chunkers enchufables) y sirve de plantilla directa.
4. **Plantillas por tipo de documento** (a lo RAGFlow) como evolución natural:
   contrato ≠ acta ≠ ticket ≠ código. El "doc corto = 1 chunk" ya lo hacemos ("One").
5. **Contextual Retrieval con LLM: aplazado** — es el único upgrade con ganancias
   grandes medidas, pero es benchmark de vendor y cuesta ~$1–5/M tokens. Adoptarlo solo
   si el eval muestra fallos por pérdida de contexto de documento. (Esto **rebaja** lo
   que decía el plan de ADR-0023 §5.2, que lo daba por hacer en Fase 4: ahora queda
   condicionado al eval.)

## 5. Caveats y salud de la evidencia

- **Sesgo de vendor** en las dos técnicas estrella: los números de Contextual Retrieval
  son evals internos de Anthropic (datasets sin publicar); el paper de late chunking es
  de Jina (código público, limitaciones autodeclaradas, y evaluaciones independientes
  muestran que no generaliza a todos los setups).
- **Prácticamente toda la evidencia es en inglés.** No existe ningún eval de chunking
  en español; la única mención explícita de idioma es la advertencia English-only de
  LlamaIndex. La transferencia a contratos/actas en español es una extrapolación —
  razón de más para el eval propio.
- **Nada sobre código fuente**: ningún claim verificado cubrió chunking de código
  (AST vs líneas vs fichero). Sigue abierto para nuestra indexación de repos.
- **Claims refutados en verificación (0-3)**: los defaults "chunk_size=1024 /
  overlap=20" de LlamaIndex que circulan por ahí — no citarlos.
- Benchmark de Chroma: corpus pequeño (~330k tokens), queries sintéticas, métricas
  token-level que penalizan mecánicamente el solape grande; no mide calidad de
  respuesta final.
- Los defaults de frameworks cambian rápido; lo aquí citado es a **2026-07**.

## Fuentes principales

- Chroma, *Evaluating Chunking Strategies for Retrieval* (jul 2024) + repo
  [`chunking_evaluation`](https://github.com/brandonstarxel/chunking_evaluation) (MIT).
- Qu et al., *Is Semantic Chunking Worth the Computational Cost?* — NAACL 2025 Findings
  ([arXiv 2410.13070](https://arxiv.org/abs/2410.13070)).
- Anthropic, [*Contextual Retrieval*](https://www.anthropic.com/engineering/contextual-retrieval) (sep 2024).
- Günther et al. (Jina), *Late Chunking* ([arXiv 2409.04701](https://arxiv.org/pdf/2409.04701)).
- Tencent YouTu, *HiChunk / evidence sparsity* ([arXiv 2509.11552](https://arxiv.org/abs/2509.11552)) — con conflicto de interés declarado.
- [Docling — chunking](https://docling-project.github.io/docling/concepts/chunking/) y
  [RAGFlow — knowledge base](https://ragflow.io/docs/configure_knowledge_base) (docs + código).
- LlamaIndex — [node parsers](https://developers.llamaindex.ai/python/framework/module_guides/loading/node_parsers/modules/).
- Pendiente de leer (sin verificar): arXiv 2604.01733 (¿ablación chunking×rerank?).
