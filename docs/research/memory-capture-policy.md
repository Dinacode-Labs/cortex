# Investigación — ¿Capturar toda conversación? Política de captura de memoria

Motivado por una duda válida sobre el hook de auto-captura (SessionEnd → destilar la
sesión). Pregunta: ¿tiene sentido capturar **toda** conversación? Respuesta corta de la
literatura y de los proyectos serios: **NO de forma indiscriminada ni en crudo.** Hay
que **destilar + filtrar por relevancia + reconciliar contra lo existente + datar con
proveniencia/confianza/vigencia + decaer**. Capturar todo es el patrón que los buenos
sistemas evitan deliberadamente.

## Qué hacen los proyectos reales (ninguno hace "append" ciego)
- **mem0**: LLM **extrae** hechos salientes y, por cada uno, decide **ADD / UPDATE /
  DELETE / NOOP** contra los más similares ya guardados (reconciliación, no append).
  Reporta ~91% menos latencia p95 y >90% menos tokens vs. full-context (Chhikara 2025).
- **Letta/MemGPT** (Packer 2023): tiers tipo SO; el **agente edita su memoria** con
  tools y decide qué se promociona a largo plazo.
- **Zep/Graphiti** (Rasmussen 2025): grafo **bi-temporal**; **invalida (no borra)** lo
  superado, con timestamps de validez. (≈ nuestro principio §5.5 + invalidación temporal.)
- **Cognee**: dedup por content-hash + merge de entidades por ontología. **A-MEM**:
  reescribe notas viejas al llegar nuevas. **Reflexion** (Shinn 2023): guarda
  auto-críticas destiladas en un buffer acotado.
- **claude-mem** es el más cercano a "capturar todo" (comprime sesiones), y su debilidad
  reconocida es justo **no tener dedup ni forgetting**.

## Qué dicen los papers
- **Generative Agents** (Park 2023): las observaciones **no son iguales** — recuperación
  = recencia × **importancia** × relevancia; importancia = poignancy 1–10 por LLM;
  **reflexión** sintetiza abstracciones al cruzar un umbral. Salience + destilación, no crudo.
- **MemGPT** (Packer 2023): el contexto es finito → paginar; no todo se queda residente.
- **Mem0** (2025): extracción + update gana a volcar el historial en coste/latencia/exactitud.
- **MemoryBank** (Zhong 2023): decaimiento Ebbinghaus `R = e^(−t/S)`; el uso refuerza, el desuso olvida.

## Riesgos de "capturar todo"
- **Context rot** (Chroma 2025): en 18 modelos, la exactitud **cae** al crecer el input;
  hasta un **único distractor** la baja.
- **Lost in the middle** (Liu 2023): exactitud en U; lo de en medio se pierde.
- **Distractores** (Cuconasu 2024; Amiraz 2025): contenido similar-pero-erróneo
  **engaña activamente** (RAG −6 a −11 pts). Los **near-duplicates y lo obsoleto son
  exactamente esto.** Más: redundancia, coste, y "hechos" alucinados guardados sin verificar.

## Dónde estamos (Cortex) y qué falta
**Bien:** ya **destilamos** (no volcamos crudo), dedup **intra-run**, y tenemos los
primitivos correctos: **§5.5 (fuente/confianza/vigencia)**, **bi-temporal** (invalidación)
y **lint near-dup**.
**Mal / a corregir:** el hook captura **toda** sesión indiscriminadamente; el dedup es
solo intra-run (no contra la memoria existente); no hay **gate de relevancia** ni
**decay**; lo auto-capturado entra como si fuera verdad (no como propuesta).

## Recomendación (gate del write-path)
1. **No** auto-commitear toda sesión como conocimiento. Auto-captura = **propuesta**, no
   verdad silenciosa.
2. **Extraer** unidades, no transcripts (ya lo hacemos).
3. **Reconciliar** contra lo similar existente: **ADD/UPDATE/DELETE/NOOP** (mem0) — no
   append ciego. Reusar el near-dup del lint en el momento de guardar.
4. **Gate de relevancia**: capturar solo si la sesión produjo conocimiento duradero
   (saltar triviales); marcar **confianza más baja** por ser inferencia de agente.
5. **Proveniencia + vigencia** (§5.5) + **decay/flag** de lo obsoleto (bi-temporal).
6. **propose → review → commit** (LLM-judge o humano) para escrituras duraderas.

## Implicación para el roadmap
El hook de auto-captura debe pasar de "destila y guarda todo" a **"propón con
reconciliación y gate de relevancia"**: dedup-vs-existente al guardar, confianza baja
para lo auto-capturado, y opción de revisión. Es una evolución, no un descarte.

## Fuentes
- Mem0: https://arxiv.org/abs/2504.19413 · MemGPT: https://arxiv.org/abs/2310.08560
- Zep: https://arxiv.org/html/2501.13956v1 · A-MEM: https://arxiv.org/abs/2502.12110
- Reflexion: https://arxiv.org/abs/2303.11366 · Generative Agents: https://arxiv.org/abs/2304.03442
- MemoryBank: https://arxiv.org/abs/2305.10250 · Context Rot: https://www.trychroma.com/research/context-rot
- Lost in the Middle: https://arxiv.org/abs/2307.03172 · Distractores: https://arxiv.org/html/2505.06914v1
- Anthropic context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
