# Modelos y costes — Auditoría Cortex

> Estado del arte jun-2026. **Precios y rankings cambian casi cada semana**: trata
> todas las cifras como orientativas y re-verifícalas en la página del proveedor antes
> de fijarlas en config. Ver "Caveats" al final.

## Tesis

Vía **OpenRouter** tenemos acceso a casi cualquier LLM, y vía proveedores enchufables
(`EMBEDDINGS_PROVIDER`, nan, Voyage, OpenAI) a embeddings/rerank/ASR/VLM. El objetivo
**no es usar el mejor modelo, sino el modelo MÍNIMO suficiente en cada rol**: clasificar,
extraer un grafo o reformular una query no aprovecha un frontier, y pagarlo es un
sobrecoste de 10–300x sin mejora medible. Solo se sube de tier donde la calidad es
**cara-al-usuario** (synthesizer con citas) o donde un error sale caro (distiller,
reconciler). El resto del pipeline interno va en tier barato.

## La frontera coste/calidad

- **Tier value (default de casi todo)**: Gemini 2.5/3.x Flash-Lite ($0.10/$0.40),
  GPT-5-nano ($0.05/$0.40), DeepSeek V3.2/V4-Flash ($0.09–0.23 in), o los **modelos
  in-house de nan** (qwen3.6). Suficiente para classifier, retriever, graph y vision
  básica. Aquí domina el **coste de input** → favorece input baratos.
- **Tier medio (donde hay razonamiento + JSON que importa)**: DeepSeek V3.2/V4-Pro
  ($0.23–0.44 in / $0.34–0.87 out), Gemini 2.5 Flash ($0.30/$2.50), GPT-5-mini
  ($0.25/$2.00). Para graph de calidad, distiller, reconciler. Aquí domina el **output**.
- **Tier frontier (solo cara-al-usuario, modo calidad)**: Gemini 3 Flash / 2.5 Pro,
  Claude Sonnet 4.6 ($3/$15), Claude Opus 4.8 ($5/$25), GPT-5.5 ($5/$30). Reservado al
  synthesizer crítico o destilados de alto valor. **Prohibido en bucles internos.**
- **Papel de nan** (`api.nan.builders`): familia Qwen3 in-house (qwen3.6 LLM, qwen3-VL
  visión, qwen3-embedding, whisper, gemma4). Misma familia/pesos que sus equivalentes
  en OpenRouter → **mismos prompts, sin reescritura**, coste de infra (no por token) y
  los datos no salen. Es el **default barato correcto**; se escala a OpenRouter/proveedor
  dedicado **por excepción medible**, no por defecto.

> Regla de oro: para tareas estructuradas (classifier/retriever/graph/reconciler) lo que
> manda no es el techo de razonamiento, sino la **adherencia fiable a JSON-schema**. Más
> fiables: OpenAI (Structured Outputs estricto, conformidad garantizada) y Gemini
> (responseSchema). DeepSeek/Qwen/Kimi soportan JSON/tool-calling pero exige validación
> zod + retry.

## Tabla por rol de Cortex

| Rol | Recomendado (default) | Alt. barata | Alt. de calidad | Precio aprox | Por qué |
|---|---|---|---|---|---|
| **classifier** (`classify.ts`) | nan qwen3.6 / Gemini Flash-Lite | GPT-5-nano $0.05/$0.40 | — (no escalar) | $0.10/$0.40 OR · in-house nan | Etiquetar `decision/incident/convention` no necesita razonamiento; prioriza JSON fiable + latencia baja |
| **graph / enrich** (`enrich.ts`) | DeepSeek V3.2 | nan qwen3.6 / Flash-Lite | Gemini 2.5 Flash $0.30/$2.50 | $0.23/$0.34 OR | Extracción entidades+relaciones: razonamiento medio + JSON. DeepSeek es el sweet spot calidad/precio |
| **reranker** (`rerank.ts`, hoy LLM) | **Voyage rerank-2.5** | Qwen3-Reranker-4B (nan, self-host) | Cohere Rerank v4 | $0.05/M tok (Voyage) · $2/1k searches (Cohere) | Un cross-encoder dedicado bate al LLM-as-reranker en coste y latencia (50–500ms vs 4–6s). **Migrar fuera de LLM** |
| **retriever** (query rewrite/expand) | nan qwen3.6 / Gemini Flash-Lite | GPT-5-nano $0.05/$0.40 | — | $0.10/$0.40 OR · in-house nan | Reformular/expandir consulta es ligero; tier value sobra |
| **distiller** (`connect-sessions.ts`, `connect-meeting.ts`) | DeepSeek V3.2 / Gemini 2.5 Flash | nan qwen3.6 | GPT-5-mini / Claude Sonnet 4.6 | $0.23–0.30 in / $0.34–2.50 out | Define **qué se guarda** → calidad media-alta. Fidelidad importa más que en classifier |
| **reconciler** (`reconcile.ts`, ADD/UPDATE/SUPERSEDE/NOOP) | DeepSeek V3.2 | nan qwen3.6 | **GPT-5-mini** (strict JSON) | $0.23/$0.34 OR · $0.25/$2.00 | Estilo mem0: razonamiento + JSON que **debe parsear siempre**. GPT-5-mini si el formato no puede romperse |
| **synthesizer** (`synthesize.ts` → `ask_project_context`) | GPT-5-mini / Gemini 3 Flash | DeepSeek V3.2 | **Claude Sonnet 4.6 / Gemini 2.5 Pro / Opus 4.8** | $0.25/$2.00 → $3/$15 → $5/$25 | Cara-al-usuario, con citas. Sube a frontier solo en "modo calidad" o respuestas críticas |
| **vision / VLM** (caption + OCR) | nan qwen3-VL / gemma4 | Qwen3-VL-8B $0.08/$0.50 OR | **Gemini 2.5 Flash-Lite** $0.10/$0.40 · Qwen3-VL-235B $0.20/$0.88 | in-house nan → OR | nan cubre el 80%; escala a Gemini Flash-Lite (mejor OCR/€ por benchmark indep.) en escaneos críticos/tablas densas |
| **embeddings** (pgvector) | **nan qwen3-embedding** (#1 MTEB multilingüe 70.58) | OpenAI 3-small $0.02/M | voyage-3.5 $0.06/M / voyage-4 | in-house nan → API | Mejor retrieval multilingüe/español por € e in-house. Cambiar modelo/dims ⇒ **REINDEXAR pgvector** |
| **asr / whisper** (transcripción) | **nan whisper** (large-v3) | Groq Whisper turbo $0.04/h | Deepgram Nova-3 (ruidoso) · gpt-4o-transcribe (multilingüe) | in-house nan → API | Mismo Whisper que todos → calidad no diferencial. Escala solo por picos (Groq) o audio difícil (Deepgram) |

## Qué SÍ y qué NO

**SÍ compensan:**
- nan (qwen3.6/qwen3-VL/qwen3-embedding/whisper) como **default** de los roles internos y multimodales.
- Gemini Flash-Lite / GPT-5-nano para classifier y retriever (input barato + JSON fiable).
- DeepSeek V3.2 / V4-Pro para graph/distiller/reconciler (calidad casi-frontier a 1/30 del coste).
- GPT-5-mini cuando el JSON **no puede romperse** (reconciler) o hay citas (synthesizer).
- **Reranker dedicado** (Voyage rerank-2.5 gestionado, o Qwen3-Reranker-4B en nan) en vez de LLM-as-reranker.
- Qwen3-Embedding (nan) para embeddings; voyage-3.5 si no quieres operar GPUs.

**NO / evitar:**
- **Frontier (GPT-5.5, Opus 4.8, Gemini 3 Pro) en classifier/retriever/graph/reranker**: 10–300x el coste sin mejora medible. Anti-patrón puro.
- **Modelos `:free` de OpenRouter en producción**: rate limits agresivos (~20 req/min) rompen enrich/distill por lotes; algunos entrenan con tus datos. Solo prototipado.
- **LLM-as-reranker en el hot-path** de `ask_project_context`: 4–6s de latencia inviable.
- **OpenAI text-embedding-3-large como default**: desfasado (MTEB 64.6) y batido por el propio qwen3-embedding de nan.
- **Qwen2.5-VL-72B / Llama 3.3 70B**: dominados en coste/calidad por la generación Qwen3 / DeepSeek V3.2.

## 3 perfiles de configuración

Hoy el repo expone **un modelo LLM global** (`OPENROUTER_MODEL` o `NAN_LLM_MODEL`) y un
`EMBEDDINGS_PROVIDER`; no hay aún variable por-rol. Los perfiles asumen esa realidad y,
donde proponen modelo por rol, marcan lo que requeriría **cablear overrides por rol**
(p. ej. `CORTEX_MODEL_SYNTHESIZER=…`) como mejora pendiente.

### (a) Económico — todo in-house nan · coste relativo ≈ 1x

```bash
LLM_PROVIDER=nan
NAN_API_KEY=sk-...
NAN_BASE_URL=https://api.nan.builders/v1
NAN_LLM_MODEL=qwen3.6              # classifier, retriever, graph, distiller, reconciler, synthesizer
EMBEDDINGS_PROVIDER=nan
NAN_EMBEDDING_MODEL=qwen3-embedding
NAN_EMBEDDING_DIM=1024            # fija dims y reindexa pgvector en consecuencia
# vision: qwen3-VL / gemma4 in-house · asr: whisper nan
# reranker: Qwen3-Reranker-4B self-host en nan (futuro RERANK_PROVIDER=nan)
```
Coste casi solo de infra; datos no salen. Validar fiabilidad de JSON del enrich contra
Flash-Lite en una muestra real antes de producción.

### (b) Equilibrado — nan barato + OpenRouter donde importa · coste relativo ≈ 2–4x

```bash
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=deepseek/deepseek-v3.2     # default de calidad media (graph/distiller/reconciler)
# overrides por rol (a cablear):
#   classifier/retriever -> google/gemini-2.5-flash-lite  ($0.10/$0.40)
#   synthesizer          -> openai/gpt-5-mini             ($0.25/$2.00)
EMBEDDINGS_PROVIDER=nan
NAN_EMBEDDING_MODEL=qwen3-embedding
# reranker dedicado:
RERANK_PROVIDER=voyage          # voyage rerank-2.5 ($0.05/M tok) — futuro
VOYAGE_API_KEY=...
# vision: nan por defecto, escala a google/gemini-2.5-flash-lite en escaneos críticos
# asr: nan whisper; Groq turbo en picos
```
El punto recomendado para producción: barato en el pipeline interno, calidad donde el
usuario la ve.

### (c) Máxima calidad — frontier en lo cara-al-usuario · coste relativo ≈ 8–15x

```bash
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=deepseek/deepseek-v4-pro   # graph/distiller/reconciler de calidad
# overrides por rol (a cablear):
#   synthesizer -> anthropic/claude-sonnet-4.6  ($3/$15)  o  google/gemini-2.5-pro ($1.25/$10)
#   distiller crítico -> anthropic/claude-opus-4.8 ($5/$25) en "romper cristal"
#   classifier/retriever -> google/gemini-2.5-flash-lite  (NO subir: no aporta)
EMBEDDINGS_PROVIDER=voyage
VOYAGE_API_KEY=...                          # voyage-3.5 / voyage-4
RERANK_PROVIDER=voyage                       # voyage rerank-2.5
# vision: gemini-2.5-flash-lite / qwen3-vl-235b · asr: deepgram nova-3 / gpt-4o-transcribe
```
Frontier solo en synthesizer/distiller; classifier/retriever **siguen baratos** (subirlos
sería desperdicio). El 8–15x viene del output frontier en la tool cara-al-usuario.

## Embeddings y reranking

- **OpenRouter es chat-completions**: **no** sirve embeddings ni rerankers dedicados.
  Van por API propia (Voyage/Cohere/Jina) o self-host (nan/local) vía `EMBEDDINGS_PROVIDER`
  y un futuro `RERANK_PROVIDER`. Por eso esos modelos están fuera de `LLM_PROVIDER`.
- **Embeddings (multilingüe/español)**: el default correcto es **qwen3-embedding (nan)**
  — #1 MTEB multilingüe (70.58), in-house, dims ajustables (MRL 32–4096; fija 1024 para
  acotar la columna pgvector). Alternativa gestionada sin GPUs: **voyage-3.5** ($0.06/M)
  o voyage-4 (200M tokens gratis). Evita OpenAI 3-large como default (MTEB 64.6, más caro,
  más flojo en español). **Cualquier cambio de modelo o dims ⇒ re-embeber todo el corpus
  + cambiar `vector(N)` + reindexar HNSW/IVFFlat**: planifícalo como migración.
- **Reranking**: migrar el LLM-as-reranker actual (`packages/agents/src/rerank.ts`) a un
  **cross-encoder dedicado**. Mejor opción gestionada: **Voyage rerank-2.5** ($0.05/M tok,
  ~595ms, SOTA en MAIR; lite a $0.02/M). In-house coherente con nan: **Qwen3-Reranker-4B**
  (Apache-2.0, 100+ idiomas, sin coste por query). Cohere Rerank v4 ($2/1k searches) si ya
  hay contrato Cohere/Bedrock. BGE-reranker-v2-m3 como fallback local sin claves.
- **Multilingüe/español**: Qwen3 (embedding + reranker), Voyage y Cohere son fuertes en
  español; OpenAI y BGE-M3 quedan por detrás. **Mide retrieval en TU corpus** (decisiones/
  incidencias en español), no confíes solo en MTEB.

## Caveats

- **Precios y rankings volátiles**: foto de jun-2026, caduca en semanas. Ej.: Gemini 2.5
  Flash subió de $0.075/$0.40 a $0.30/$2.50; GPT-5.5 también subió. Cifras marcadas de
  agregadores (Qwen3-235B, Qwen3-VL, Kimi, voyage, OpenAI embeddings) **confírmalas en la
  página oficial** antes de fijarlas.
- **Nombres de versión inestables**: muchos blogs SEO citan GPT-5.2/5.5, Gemini 3.x,
  DeepSeek V4, Qwen3.5/3.7, Kimi K2.6, "Claude Fable/Mythos" con benchmarks no verificables.
  **Usa el slug real que exponga tu proveedor** (`openrouter.ai/models`); trata el resto
  con escepticismo.
- **Benchmarks ≠ tu tarea**: MTEB/AA-Index/nDCG/SWE-bench son señales, no garantía en
  español ni en tu dominio. Para synthesizer/distiller lo que manda es **faithfulness +
  seguimiento de instrucciones**, que esos benchmarks miden mal. Haz una **eval propia de
  20–50 casos reales de Cortex** antes de cambiar de modelo.
- **nan sin pricing/benchmark públicos**: el "barato" de qwen3.6/qwen3-VL/whisper es
  hipótesis razonable pero **no medida**. Valida con un A/B de calidad y €/1000 docs reales.
- **Estructura de coste**: en classifier/retriever domina el INPUT (favorece GPT-5-nano
  $0.05, Flash-Lite $0.10); en synthesizer/distiller domina el OUTPUT (cuidado con $2–$30/M).
- **Cómo re-evaluar (cada ~1–2 meses o al cambiar de proveedor)**:
  1. **OpenRouter pricing** (`openrouter.ai/models`, `/pricing`) — precio y slug reales.
  2. **Artificial Analysis** (`artificialanalysis.ai`) y **LMArena** — calidad/Intelligence Index.
  3. **MTEB leaderboard** (HF) — embeddings; **agentset.ai/rerankers** — rerankers.
  4. Re-correr la eval propia de Cortex y recalcular €/1000 docs por rol.

## Fuentes

- https://openrouter.ai/models · https://openrouter.ai/pricing
- https://openrouter.ai/google/gemini-2.5-flash · .../gemini-2.5-flash-lite · .../gemini-2.5-pro
- https://openrouter.ai/deepseek (V3.2 $0.23/$0.34, V4-Flash $0.09/$0.18, V4-Pro $0.435/$0.87)
- https://openrouter.ai/openai/gpt-5-mini · .../gpt-5-nano · https://openrouter.ai/anthropic/claude-haiku-4.5
- https://openrouter.ai/qwen (Qwen3-235B, Qwen3-VL-235B/8B, Qwen3.x Plus/Max)
- https://artificialanalysis.ai/models · https://llm-stats.com/ · https://www.clickrank.ai/llm-leaderboard/
- https://blog.voyageai.com/2025/08/11/rerank-2-5/ · https://docs.voyageai.com/docs/pricing
- https://cohere.com/pricing · https://docs.cohere.com/docs/how-does-cohere-pricing-work
- https://github.com/QwenLM/Qwen3-Embedding · https://arxiv.org/pdf/2506.05176 (Qwen3-Embedding 70.58 MTEB)
- https://agentset.ai/rerankers · https://futureagi.com/blog/best-rerankers-for-rag-2026/
- https://milvus.io/blog/choose-embedding-model-rag-2026.md · https://pecollective.com/tools/text-embedding-models-compared/
- https://www.ocrarena.ai/compare/mistral-ocr-v3/gemini-2-5-flash · https://reducto.ai/blog/lvm-ocr-accuracy-mistral-gemini
- https://arxiv.org/pdf/2511.21631 (Qwen3-VL Technical Report) · https://qwen3-vl.com/
- https://groq.com (Whisper turbo $0.04/h) · https://futureagi.com/blog/speech-to-text-apis-in-2026... (Nova-3, Scribe v2, gpt-4o-transcribe)
- https://ai.google.dev/gemini-api/docs/pricing · https://costgoat.com/pricing/openrouter
- https://betonai.net/openrouter-pricing-2026-complete-guide-to-every-model-tier-and-hidden-cost/
