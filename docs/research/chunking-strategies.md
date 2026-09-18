# Chunking strategies for RAG — research (Jul 2026)

- **Status:** research complete (2026-07-13). It answers the roadmap's follow-up ("research
  chunking strategies before investing more", PR #32) and the underlying doubt: *is a fixed size
  going to work for us? does chunking matter that much with hybrid RAG?*
- **Method:** deep research with adversarial verification -- 22 primary sources (papers,
  official docs, reproducible benchmarks), 109 claims extracted, 25 verified with 3 independent
  votes each: **23 confirmed, 2 refuted**. Only the confirmed ones are cited; the refuted ones
  and the biases are at the end.
- **The conclusion in one sentence:** our structural chunker v1 is exactly the pattern the
  evidence supports; what to do now is not to sophisticate the chunker but to **build the eval
  set** and add one cheap improvement (structural context at embedding time) that we largely
  already have.

## 1. How the reference frameworks chunk (verified against code/docs)

| Framework | Strategy | What matters for us |
|---|---|---|
| **Docling** (IBM) | `HierarchicalChunker` (1 chunk per structural element) + `HybridChunker` (2 token-aware passes: it splits only what exceeds the limit, and merges small neighbours sharing headings) + `contextualize()` (prepends headings/captions at embedding time -- **no LLM**) | It is the "structural → tokens" pattern, identical in spirit to our v1. Its contextualisation is a deterministic concatenation of metadata, not an LLM call. |
| **RAGFlow** | ~12 templates **per document type** (General, Laws, Paper, Manual, One…). The 'General' default: a 512-token cap with delimiter-aware boundaries. **'One'** = the whole document as 1 chunk, a first-class option | Serious products do not use a single splitter: they adapt per document type. And they validate our "a short doc = 1 chunk" behaviour. |
| **LlamaIndex** | Semantic chunking **only as an explicit option** (`SemanticSplitterNodeParser`), with an official warning: its sentence segmenter **is designed for English** and the threshold needs tuning | A direct warning against applying semantic chunking out of the box to our Spanish corpus. (Note: LlamaIndex's supposed "1024/20" defaults were **refuted** in verification -- do not cite them.) |
| **Anthropic** | Contextual Retrieval: an LLM prepends 50-100 tokens of context per chunk before embedding and before indexing into BM25 | The technique with the largest measured gains (section 3), but a vendor's internal eval. |
| **Jina** | Late chunking: embed the whole doc and split before pooling | Mechanically **unviable for us**: it needs per-token embeddings, which `text-embedding-3-large` does not expose through the API. |

## 2. The empirical evidence on size and strategy

- **Chunking matters, but within bounds** (Chroma's benchmark, reproducible, with
  `text-embedding-3-large`): the choice of strategy moved recall **by up to ~9 points** between
  the best and the worst. And the worst was precisely a popular default:
  RecursiveCharacterTextSplitter at **800 tokens with 400 of overlap** (the OpenAI
  Assistants-style default) -- worse precision/IoU with only mediocre recall.
- **A well-parameterised structural chunker ties with the semantic one** (Chroma plus a
  peer-reviewed NAACL 2025 paper): recursive at ~200 tokens gives 88.1% recall against the
  ClusterSemanticChunker's 87.3%; in the benchmark's own flagship example, even the crudest
  chunker (fixed 1200-character cuts) reaches 0.809 recall. The NAACL paper concludes in so many
  words that **semantic chunking's extra cost is not justified by consistent gains**: it only
  wins on documents artificially "stitched" with unrealistic topical diversity; on real
  documents, fixed-size won across all 4 original datasets and end-to-end generation was
  practically identical.
- **Why so many benchmarks detect nothing** ("evidence sparsity", medium confidence, a 2-1 vote
  and the author's conflict of interest): when only ~2 sentences of the document are relevant
  per query, every chunker performs almost the same; the differences surface on
  **evidence-dense** queries (~20 relevant sentences: "what was decided about X and why?") --
  which are exactly the typical ones for a project memory. Our eval set has to include them.
- **Contextual Retrieval (Anthropic)** is the only technique with large measured gains: −49% of
  retrieval failures with hybrid search and **−67% adding a reranker** (1−recall@20, internal
  evals; independent corroboration from Unstructured: −47% on SEC 10-Ks). A one-time cost of
  ~$1-5 per million document tokens. **The benefits of context, hybrid and rerank stack** --
  they do not replace each other.
- **Late chunking**: a real but modest gain (+2.7-3.6% relative nDCG@10) and corpus-dependent;
  in a small head-to-head it ties with Contextual Retrieval without the LLM cost. Irrelevant for
  us because of the API limitation (section 1).

## 3. The key question: does chunking matter with hybrid + RRF + rerank?

**The direct ablation does not exist** (nobody has published chunking × rerank in a controlled
way -- that is the central evidence gap). The indirect evidence bounds the answer from both
sides:

1. **The layers add up, they do not compensate for each other**: Anthropic's reranker brought an
   *additional* gain (2.9% → 1.9% failures) even on top of already-contextualised hybrid
   retrieval.
2. **At comparable granularity, the differences between chunkers on real corpora are already
   small even without a rerank** (NAACL 2025 used pure dense retrieval).
3. **What the rerank cannot fix**: evidence split across chunks, or document context lost inside
   a chunk. Those are fixed by overlap, size and contextualisation -- the reranker only reorders
   what was already retrieved.

The operational conclusion: with our pipeline (hybrid RRF plus an LLM rerank), the marginal
return of sophisticating the chunker beyond "structural with sensible parameters" is **low**.
The team's initial intuition was right.

> ⚠️ **An unverified lead** (extracted but outside the verified top 25): a paper
> (arXiv 2604.01733) reportedly claims that even with hybrid plus a reranker, chunking moved
> Retrieval Completeness by 8-10 pp. It would partially contradict point 2 -- **read it before
> calling this chapter closed**, but do not cite it as fact.

## 4. What this means for Cortex (the plan)

1. **Keep chunker v1** (structural: headings → paragraphs → sentences, ~1000 tokens, 400
   characters of overlap). It is the Docling/RAGFlow pattern and the evidence backs it as
   competitive. Do not migrate to semantic chunking (no peer-reviewed gains, English-only
   tooling) nor to late chunking (unviable through the API). If the evals suggest it, try
   lowering the target size (Chroma's best results sit at 200-400 tokens -- with the caveat that
   its metrics penalise large chunks and it used no rerank).
2. **Cheap contextualisation with no LLM -- we largely have it ALREADY**: `connect-docs` embeds
   `doc-title (k/N · section)\n\ncontent`, which is Docling's `contextualize()` pattern. A
   possible incremental improvement: adding project/type/date to the embedded text. Zero cost;
   measure it in the eval rather than assuming it.
3. **Our own eval set BEFORE any further chunker change** (30-100 Spanish queries over a real
   corpus, with annotated evidence; include evidence-dense queries of the "what was decided
   about X, when and why?" kind). Chroma's benchmark is open source (MIT, pluggable chunkers)
   and serves as a direct template.
4. **Per-document-type templates** (RAGFlow style) as the natural evolution: a contract is not a
   set of minutes is not a ticket is not code. The "short doc = 1 chunk" part we already do
   ("One").
5. **Contextual Retrieval with an LLM: deferred** -- it is the only upgrade with large measured
   gains, but it is a vendor benchmark and it costs ~$1-5 per million tokens. Adopt it only if
   the eval shows failures caused by lost document context. (This **downgrades** what ADR-0023
   section 5.2's plan said, which assumed it for phase 4: it is now conditional on the eval.)

## 5. Caveats and the health of the evidence

- **Vendor bias** in both headline techniques: Contextual Retrieval's numbers are Anthropic's
  internal evals (unpublished datasets); the late chunking paper is Jina's (public code,
  self-declared limitations, and independent evaluations show it does not generalise to every
  setup).
- **Practically all the evidence is in English.** There is no chunking eval in Spanish at all;
  the only explicit mention of language is LlamaIndex's English-only warning. Transferring it to
  Spanish contracts and minutes is an extrapolation -- all the more reason for our own eval.
- **Nothing about source code**: no verified claim covered code chunking (AST vs lines vs file).
  It stays open for our repo indexing.
- **Claims refuted in verification (0-3)**: LlamaIndex's "chunk_size=1024 / overlap=20" defaults
  that circulate around -- do not cite them.
- Chroma's benchmark: a small corpus (~330k tokens), synthetic queries, token-level metrics that
  mechanically penalise large overlap; it does not measure final answer quality.
- Framework defaults change fast; what is cited here is as of **2026-07**.

## Main sources

- Chroma, *Evaluating Chunking Strategies for Retrieval* (Jul 2024) plus the
  [`chunking_evaluation`](https://github.com/brandonstarxel/chunking_evaluation) repo (MIT).
- Qu et al., *Is Semantic Chunking Worth the Computational Cost?* — NAACL 2025 Findings
  ([arXiv 2410.13070](https://arxiv.org/abs/2410.13070)).
- Anthropic, [*Contextual Retrieval*](https://www.anthropic.com/engineering/contextual-retrieval) (Sep 2024).
- Günther et al. (Jina), *Late Chunking* ([arXiv 2409.04701](https://arxiv.org/pdf/2409.04701)).
- Tencent YouTu, *HiChunk / evidence sparsity* ([arXiv 2509.11552](https://arxiv.org/abs/2509.11552)) — with a declared conflict of interest.
- [Docling — chunking](https://docling-project.github.io/docling/concepts/chunking/) and
  [RAGFlow — knowledge base](https://ragflow.io/docs/configure_knowledge_base) (docs plus code).
- LlamaIndex — [node parsers](https://developers.llamaindex.ai/python/framework/module_guides/loading/node_parsers/modules/).
- Still to read (unverified): arXiv 2604.01733 (a chunking × rerank ablation?).
