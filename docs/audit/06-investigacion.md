# Solidez de la investigación — Auditoría Cortex

## Valoración

La investigación de Cortex es, en lo esencial, **sólida, honesta y bien fundamentada — por
encima de lo habitual en un PoC**. Las afirmaciones más cargadas (gbrain de Garry Tan, el
"LLM Wiki" de Karpathy de abril 2026, las métricas de mem0 —91% p95, 90% tokens, +26%
exactitud LOCOMO—, *context rot* de Chroma, *lost-in-the-middle*) se verificaron contra la
fuente y **todas resultaron reales y correctamente descritas**; no se halló ninguna fuente
inventada. Tres de los cuatro documentos citan con URLs/arXiv concretos, marcan
incertidumbres explícitamente (`*(?)*`), incluyen caveats y están trazados a decisiones
reales (ADR-0009 híbrido+rerank, ADR-0011 lint, ADR-0012 bi-temporal) y al roadmap.
`memory-capture-policy.md` es ejemplar: apoyado en literatura primaria y convertido
directamente en la lógica de reconciliación ADD/UPDATE/SUPERSEDE. Las debilidades son de
**vigencia y cierre, no de rigor**: el análisis de huecos quedó desfasado respecto a lo ya
construido, los documentos no llevan fecha de revisión ni estado, y `multimodal-ingestion.md`
tiene citas flojas y dejó decisiones abiertas que la implementación no cerró. Ninguna
conclusión está mal fundamentada; el riesgo real es que un lector tome la foto de junio como
estado actual.

---

## Hallazgos por severidad

### 🟡 Medio

#### M1 · El análisis de huecos de `competitive-landscape.md` está desfasado: presenta como pendientes features ya implementadas

- **Evidencia:** `docs/research/competitive-landscape.md` §3 enumera como "Qué hacen que
  Cortex NO hace": híbrido BM25+vector+RRF ("Hoy usamos solo pgvector denso", L104), rerank
  ("Nosotros no", L106), grafo bi-temporal con invalidación (§B), resolución de entidades en
  2 fases (§C), indexación de código (§E) y operación de Lint (§D). La tabla §5 (L234) marca
  `Cortex (hoy)`: bi-temporal **No**, entidades **Parcial**. Pero `docs/decisions.md`
  ADR-0009 (híbrido+rerank), ADR-0011 (lint) y ADR-0012 (bi-temporal) están **aceptados** y
  el código los implementa: `packages/core/src/vectors.ts` (RRF), `lint.ts`,
  `resolve-entities.ts`, `code.ts`. Las propuestas "Ahora 1-4" (L188-199) ya están hechas,
  pero el documento sigue redactado como si fueran huecos.
- **Impacto:** Quien lea el panorama para priorizar concluirá que faltan piezas que ya
  existen, duplicando trabajo o desviando el roadmap. Erosiona la confianza en el documento
  como fuente de verdad sobre el estado del producto y choca con el mandato de `CLAUDE.md`
  de mantener viva y podar la doc.
- **Recomendación:** Añadir una marca de **Estado (hecho/parcial/pendiente)** en §3 y en la
  tabla §5, y un banner al inicio: "gap analysis a fecha junio 2026; ítems 1-4 ya
  implementados (ver ADR-0009/0011/0012)". Actualizar la fila `Cortex (hoy)`: bi-temporal=Sí,
  híbrido=Sí, rerank=opcional.
- **Esfuerzo:** S

#### M2 · Los documentos de research no llevan fecha de revisión ni marca de estado

- **Evidencia:** Ninguno de los cuatro `.md` en `docs/research/` tiene "última revisión" ni
  estado (vigente/superado). `competitive-landscape.md` solo dice "junio 2026" en una nota
  de cabecera (L3); `hooks-integration.md`, `memory-capture-policy.md` y
  `multimodal-ingestion.md` no datan nada. `CLAUDE.md` exige "pódalo de vez en cuando" y
  "verifica que el fichero/función/flag citado sigue existiendo". El `mtime` de los ficheros
  (Jun 22-24) no es visible para un lector.
- **Impacto:** Sin marca temporal el lector no puede distinguir una conclusión vigente de
  una foto superada (justo el problema de M1). En un producto que predica
  trazabilidad/vigencia (§5.5) para el conocimiento que ingiere, su propia doc de research
  carece de esa misma metadata.
- **Recomendación:** Cabecera estándar en cada doc: fecha de creación, última revisión y
  estado. Revisar en cada PR que toque el área. Coherente con el principio de vigencia que
  el propio producto aplica a las entradas.
- **Esfuerzo:** S

#### M3 · Recomendación de research no implementada: transcripción enchufable con fallback local

- **Evidencia:** `docs/research/multimodal-ingestion.md` L77 recomienda "Interfaz
  `TranscriptionProvider` con fallback `whisper.cpp` local (patrón embeddings)" y L9-16
  verifica el endpoint `/v1/audio/transcriptions` específicamente de **nan**. La
  implementación cablea whisper al provider `nan` (`visionConfig` reutiliza
  `LLM_PROVIDER`); con `LLM_PROVIDER=openrouter` no existe `/audio/transcriptions` y toda
  transcripción falla en silencio (404 → null). La pluggability recomendada por el research
  no se construyó.
- **Impacto:** La decisión derivada del research quedó a medias: el research advirtió
  correctamente que whisper es específico de nan y propuso abstracción, pero el código no la
  entregó, dejando un fallo silencioso. Conviene reexaminarla a la luz del research que la
  motivó.
- **Recomendación:** Implementar la interfaz `TranscriptionProvider` que el propio research
  propuso, o documentar explícitamente en `multimodal-ingestion.md`/`decisions.md` que la
  transcripción está atada a `nan` y por qué se aparcó la abstracción.
- **Esfuerzo:** M

#### M4 · Incertidumbre de research enviada a producción sin cerrarse: capacidad de visión "a probar"

- **Evidencia:** `docs/research/multimodal-ingestion.md` L13-16 deja la visión como
  hipótesis abierta: "Visión: a probar. No hay un `*-vl` por nombre, pero `mimo-v2.5`
  (MiMo-VL) y `gemma4` ... probar si aceptan `image_url` ... Si no, OCR local (tesseract)
  como fallback". El código (`extract.ts`, `visionCall`) ya depende de ese caption de visión
  en la ingesta multimodal, pero no consta en el research que se cerrara la prueba ni el
  fallback OCR.
- **Impacto:** Una incertidumbre marcada honestamente como "a probar" se convirtió en
  dependencia operativa sin registrar el resultado del experimento. Si mimo-v2.5/gemma4 no
  aceptan `image_url`, la cascada cae y produce entradas vacías/erróneas sin que el research
  lo haya confirmado.
- **Recomendación:** Cerrar la pregunta con un sondeo real (un POST con `image_url` a cada
  modelo) y anotar el resultado en el doc; si falla, conectar el fallback OCR (tesseract)
  que el research ya previó. Marcar la incertidumbre como resuelta.
- **Esfuerzo:** S

### 🟢 Bajo

#### B1 · Citas débiles en `multimodal-ingestion.md` frente al estándar de los otros documentos

- **Evidencia:** `docs/research/multimodal-ingestion.md` L117-119 cierra con "Fuentes: ver
  enlaces en los hilos de investigación (Unstructured, Docling, MarkItDown, LlamaParse,
  RAGFlow; ... Recall.ai, IAPP/GDPR)" — nombres sin URLs. Los otros tres docs citan con
  enlaces concretos (`competitive-landscape` §6 con github/arxiv; `memory-capture-policy`
  con arXiv por paper; `hooks-integration` con docs oficiales).
- **Impacto:** Reduce auditabilidad y reproducibilidad justo en el documento con
  afirmaciones técnicas concretas (libs, contratos de API, límites de 25MB/25min, costes
  $/h). Un lector no puede verificar cada claim sin rehacer la búsqueda.
- **Recomendación:** Añadir URLs concretas a las afirmaciones cargadas (contrato OpenAI
  `/audio/transcriptions`, límites, precios Recall.ai, libs mammoth/unpdf/SheetJS), al nivel
  de los otros tres docs.
- **Esfuerzo:** S

#### B2 · Detalles internos de terceros apoyados solo en fuentes secundarias (flaggeado, pero a vigilar)

- **Evidencia:** `docs/research/competitive-landscape.md` L250-252 lo reconoce honestamente:
  "Algunos detalles internos (Cursor/Turbopuffer, resolución de entidades de Graphiti, 3
  capas de Hermes) provienen de fuentes secundarias". La verificación web detectó que gbrain
  hoy expone **74 tools** (el doc dice "30+", L54) y trae reranker ZeroEntropy por defecto —
  el panorama de un repo que se mueve rápido envejece. La provenance del propio research ("4
  agentes en paralelo", L3) implica contenido generado por LLM.
- **Impacto:** Las decisiones de nicho (p.ej. "resolución de entidades 2 fases MinHash+LSH
  como Cognee/Graphiti", §C/ADR) se apoyan en descripciones de segunda mano que podrían no
  reflejar la implementación real del referente. Bajo riesgo porque está marcado, pero
  conviene verificar antes de apostar roadmap.
- **Recomendación:** Antes de copiar un patrón concreto de un competidor (Graphiti
  entity-res, schema packs de gbrain), validar contra su código/doc primaria y anotar la
  verificación. Refrescar las cifras de referentes rápidos (gbrain: 74 tools, reranker).
- **Esfuerzo:** S

---

## Qué está bien

#### ✅ Research primario verificable y trazado a implementación (`memory-capture-policy` y traza a ADRs)

- **Evidencia:** `docs/research/memory-capture-policy.md` se apoya en literatura primaria
  (mem0 arXiv:2504.19413, MemGPT 2310.08560, Zep 2501.13956, Generative Agents 2304.03442,
  *Context Rot* de Chroma, *Lost-in-the-Middle* 2307.03172). Se verificaron mem0 (91% p95,
  90% tokens, +26% LOCOMO), el LLM Wiki de Karpathy (abr 2026) y gbrain: todos reales y bien
  descritos. Sus conclusiones se materializaron en la reconciliación ADD/UPDATE/SUPERSEDE
  (`dedup.ts`) y los ADR citan los research files (`roadmap.md` L37/108/135/206 enlazan a
  `docs/research/*`). El propio doc marca incertidumbres con `*(?)*` y separa lo verificado
  de lo secundario.
- **Por qué importa:** La cadena research → decisión → código es real y auditable, que es
  exactamente lo que se espera de una "memoria corporativa de contexto". Es el activo más
  fuerte de esta dimensión.
- **Acción:** Mantener y extender este mismo estándar (citas arXiv/primarias + traza a ADR +
  marca de incertidumbre) a `multimodal-ingestion.md` y a futuros research (p.ej. el
  `context-index.md` previsto en `roadmap.md` L286).

Además, en términos generales:

- Verificación independiente de las afirmaciones más cargadas: **0 fuentes inventadas**.
- Tres de cuatro documentos citan con URLs/arXiv concretos y sección de caveats.
- Honestidad metodológica: incertidumbres marcadas (`*(?)*`), provenance declarada y límites
  de las fuentes secundarias reconocidos explícitamente.

---

## Recomendaciones priorizadas

1. **(M1, S)** Actualizar `competitive-landscape.md`: banner de fecha + columna de estado en
   §3 y §5; corregir la fila `Cortex (hoy)` (bi-temporal=Sí, híbrido=Sí, rerank=opcional).
   Es lo que más erosiona la confianza en la doc como fuente de verdad.
2. **(M2, S)** Cabecera estándar (creación / última revisión / estado) en los cuatro docs de
   `docs/research/`; revisar en cada PR que toque el área.
3. **(M4, S)** Cerrar el sondeo de visión (POST `image_url` a mimo-v2.5/gemma4), anotar el
   resultado y conectar el fallback OCR si falla.
4. **(M3, M)** Implementar `TranscriptionProvider` enchufable con fallback local, o
   documentar y justificar el acoplamiento a `nan`.
5. **(B1, S)** Añadir URLs concretas a las afirmaciones técnicas de `multimodal-ingestion.md`.
6. **(B2, S)** Validar contra fuente primaria los patrones de nicho antes de copiarlos al
   roadmap; refrescar cifras de referentes rápidos (gbrain: 74 tools, reranker).
