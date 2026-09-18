# Research — capture every conversation? A memory capture policy

Prompted by a fair doubt about the auto-capture hook (SessionEnd → distill the session). The
question: does it make sense to capture **every** conversation? The short answer from the
literature and from the serious projects: **NOT indiscriminately and not raw.** What is needed
is **distil + filter by relevance + reconcile against what exists + date with
provenance/confidence/validity + decay**. Capturing everything is the pattern good systems
deliberately avoid.

## What the real projects do (none does a blind "append")
- **mem0**: an LLM **extracts** salient facts and, for each one, decides **ADD / UPDATE /
  DELETE / NOOP** against the most similar already stored (reconciliation, not append). It
  reports ~91% lower p95 latency and >90% fewer tokens than full context (Chhikara 2025).
- **Letta/MemGPT** (Packer 2023): OS-like tiers; the **agent edits its own memory** with tools
  and decides what gets promoted to long-term storage.
- **Zep/Graphiti** (Rasmussen 2025): a **bi-temporal** graph; it **invalidates (does not
  delete)** what was superseded, with validity timestamps. (Close to our section 5.5 principle
  plus temporal invalidation.)
- **Cognee**: dedup by content hash plus entity merging by ontology. **A-MEM**: it rewrites old
  notes as new ones arrive. **Reflexion** (Shinn 2023): it stores distilled self-critiques in a
  bounded buffer.
- **claude-mem** is the closest to "capture everything" (it compresses sessions), and its
  acknowledged weakness is precisely **having neither dedup nor forgetting**.

## What the papers say
- **Generative Agents** (Park 2023): observations are **not all equal** -- retrieval = recency ×
  **importance** × relevance; importance = poignancy 1-10 by an LLM; **reflection** synthesises
  abstractions once a threshold is crossed. Salience plus distillation, not raw text.
- **MemGPT** (Packer 2023): context is finite → page it; not everything stays resident.
- **Mem0** (2025): extraction plus update beats dumping the history on cost, latency and
  accuracy.
- **MemoryBank** (Zhong 2023): Ebbinghaus decay `R = e^(−t/S)`; use reinforces, disuse forgets.

## The risks of "capture everything"
- **Context rot** (Chroma 2025): across 18 models, accuracy **drops** as the input grows; even a
  **single distractor** lowers it.
- **Lost in the middle** (Liu 2023): a U-shaped accuracy curve; what sits in the middle is lost.
- **Distractors** (Cuconasu 2024; Amiraz 2025): similar-but-wrong content **actively misleads**
  (RAG −6 to −11 points). **Near-duplicates and stale content are exactly this.** On top of
  that: redundancy, cost, and hallucinated "facts" stored unverified.

## Where we are (Cortex) and what is missing
**Good:** we already **distil** (we do not dump raw), we dedup **within a run**, and we have the
right primitives: **section 5.5 (source/confidence/validity)**, **bi-temporality**
(invalidation) and a **near-dup lint**.
**Bad / to fix:** the hook captures **every** session indiscriminately; the dedup is only within
a run (not against the existing memory); there is no **relevance gate** and no **decay**;
auto-captured knowledge enters as though it were truth (rather than as a proposal).

## Recommendation (the write-path gate)
1. Do **not** auto-commit every session as knowledge. Auto-capture is a **proposal**, not silent
   truth.
2. **Extract** units, not transcripts (we already do).
3. **Reconcile** against similar existing knowledge: **ADD/UPDATE/DELETE/NOOP** (mem0) -- not a
   blind append. Reuse the lint's near-dup at write time.
4. **A relevance gate**: capture only when the session produced durable knowledge (skip the
   trivial); mark it with **lower confidence** because it is an agent's inference.
5. **Provenance plus validity** (section 5.5) plus **decay/flagging** of the stale
   (bi-temporal).
6. **propose → curation, NOT a blocking human review** (that would kill capture's agility):
   auto-captured knowledge writes immediately with low confidence, and `maintain` **auto-cures**
   it with no human -- promoting what was corroborated (it recurred / was merged) and decaying
   the old and never corroborated. An optional `/review` view can serve manual curation, but it
   never blocks capture or search.

## What this implies for the roadmap
The auto-capture hook must move from "distil and store everything" to **"propose, with
reconciliation and a relevance gate"**: dedup-against-existing at write time, low confidence for
what was auto-captured, and the option of review. It is an evolution, not a rejection.

## Sources
- Mem0: https://arxiv.org/abs/2504.19413 · MemGPT: https://arxiv.org/abs/2310.08560
- Zep: https://arxiv.org/html/2501.13956v1 · A-MEM: https://arxiv.org/abs/2502.12110
- Reflexion: https://arxiv.org/abs/2303.11366 · Generative Agents: https://arxiv.org/abs/2304.03442
- MemoryBank: https://arxiv.org/abs/2305.10250 · Context Rot: https://www.trychroma.com/research/context-rot
- Lost in the Middle: https://arxiv.org/abs/2307.03172 · Distractors: https://arxiv.org/html/2505.06914v1
- Anthropic context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
