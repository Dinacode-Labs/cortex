# Investigación — Ingesta multimodal (documentos, imágenes, vídeo, reuniones)

Cómo lo resuelven otros y qué encaja en Cortex (Node/TS, Postgres+pgvector, LLM/
embeddings por endpoint OpenAI-compatible). Motivado por el export de CE Portal, que
traía `.docx/.pdf/.xlsx`, ~300 imágenes, `.drawio` y `.mp4` que el conector (solo
`.md`) ignoró. Resumen de 4 investigaciones paralelas + verificación de capacidades
de nan.

## Capacidades reales de nan (verificado)
Modelos disponibles: `qwen3.6`, `deepseek-v4-flash`, `qwen3-embedding`, `rerank`,
`gemma4`, `mimo-v2.5`, **`whisper`**, `kokoro` (TTS).
- **Transcripción: ✅** `whisper` + endpoint `/v1/audio/transcriptions` (existe; 405 a
  GET → requiere POST multipart, contrato OpenAI). Vídeo/audio es viable ya.
- **Visión: a probar.** No hay un `*-vl` por nombre, pero `mimo-v2.5` (MiMo-VL) y
  `gemma4` (Gemma multimodal) tienen variantes con visión upstream → probar si aceptan
  `image_url` en `chat/completions`. Si no, OCR local (tesseract) como fallback.

## 1. Documentos (Word / PDF / Excel / PPT)
**Mercado:** Apache Tika (POI+PDFBox, baseline), Unstructured.io (`fast`/`hi_res`/
`ocr_only`, elementos tipados), IBM Docling (local, tablas fieles), Microsoft
MarkItDown (→ Markdown ligero), LlamaParse (SaaS, alta fidelidad — pero los datos
salen de la org), RAGFlow/DeepDoc (OCR+tabla+layout con bbox). Onyx/Dify usan libs
simples (pypdf/python-docx/openpyxl) y escalan a Unstructured solo para hi-res.
Patrón: **lib ligera para ficheros digitales; escalar a servicio OCR/layout solo
para PDF escaneados o tablas críticas. Markdown como formato intermedio.**

**Recomendación Cortex (Node/TS):** router por MIME que emite **Markdown + metadatos**:
- `.docx` → **mammoth** (a markdown). `PDF` digital → **unpdf** (pdf.js moderno;
  ⚠️ NO hace OCR — detectar capa de texto vacía = escaneado). `.xlsx` → **SheetJS
  (xlsx)** (1 chunk por hoja). `.pptx` → **officeparser** (1 chunk por slide + notas).
- Chunking layout-aware: cortar por headings, **tabla = chunk atómico**, cap ~500–1000
  tokens, prefijar título/sección. Trazabilidad §5.5 (fuente, página/hoja, confianza).
- **Escalar** a Unstructured `hi_res` o Docling (self-host, on-prem) solo si PDF
  escaneado / tablas críticas. LlamaParse descartado (SaaS, datos fuera).
- Gotchas: PDF escaneado da texto vacío (validar densidad → OCR); no partir tablas;
  `pdf-parse` sin mantenimiento (usar unpdf); quitar headers/footers antes de embeber.

## 2. Imágenes y diagramas
**Mercado:** tres patrones — (a) **OCR→texto** (Tesseract/PaddleOCR): barato, para
capturas con texto; (b) **VLM caption→texto** (GPT-4o/Qwen-VL): describe la imagen y
embebes el texto — hoy es lo mainstream para figuras/diagramas (LlamaIndex: embeber
*descripciones* supera a CLIP en retrieval); (c) **embeddings multimodales** (CLIP/
ColPali): pixeles directos, mejor recall visual pero espacio vectorial aparte. El
consenso práctico es una **cascada barato→caro** con dedup por hash.

**Recomendación Cortex (cascada sobre las imágenes):**
1. **Descarte heurístico (gratis):** fuera iconos (<~100px), banners (aspect ratio
   extremo), y duplicados por content-hash (logos/chrome repetidos). Quita la mayoría.
2. **Routing por estadística de píxel:** uniforme → decorativa (skip); mayormente
   texto → OCR; rica/colorida → VLM.
3. **OCR** (tesseract, ES+EN) para capturas de texto. Si OCR vacío en imagen "rica" →
   fallback VLM.
4. **VLM caption** (mimo-v2.5/gemma4 de nan, si soportan visión) para diagramas/
   gráficas/fotos. **Pasar siempre el texto/título de la página** en el prompt
   (mejora muchísimo el caption). Caption = chunk propio, con confianza/proveniencia.
5. **.drawio = sin visión:** es XML → parsear `<mxCell value="...">` (nodos+aristas)
   con un parser XML. Más barato y preciso que renderizar+VLM.
- Gotchas: coste = solo el paso VLM (la cascada lo reduce a unas pocas decenas);
  **bajar resolución** antes de enviar (tokens ∝ píxeles); OCR/caption son inferencias
  (marcar confianza, no convertir en hechos); para texto denso usar OCR, no "describe".

## 3. Vídeo / audio (transcripción)
**Mercado:** pipeline universal **ffmpeg → ASR (familia Whisper) → [diarización] →
LLM estructura el transcript**. APIs (OpenAI whisper/gpt-4o-transcribe, Deepgram,
AssemblyAI) traen diarización; self-host: whisper.cpp (ligero), faster-whisper,
**WhisperX** (alineación + pyannote = "quién dijo qué"). Otter/Fireflies/Fathom/
Granola coinciden: **la salida estructurada (resumen + action items + decisiones +
temas, con timestamps) vale más que el transcript crudo.** Contrato OpenAI
`/v1/audio/transcriptions`: multipart `file`+`model`, `response_format` (`verbose_json`
con `segments`/`words`), `timestamp_granularities`; **límite ~25 MB/25 min → chunkear.**

**Recomendación Cortex:**
1. **ffmpeg**: `-vn -ac 1 -ar 16000` (mono 16kHz).
2. **Chunkear** por silencio (`silencedetect`) o ventanas ~10 min con solape; arrastrar
   `prompt` (cola del chunk previo) para continuidad; stitch de offsets a tiempo absoluto.
3. **Transcribir con nan** (`whisper`, `/v1/audio/transcriptions`, `verbose_json`).
   Interfaz `TranscriptionProvider` con fallback `whisper.cpp` local (patrón embeddings).
4. **Diarización: aparcada** (lo más frágil; nan probablemente no la expone). Añadir
   WhisperX self-host solo si "quién dijo qué" demuestra hacer falta.
5. **Transcript → conocimiento** (el valor): el LLM de `@cortex/agents` extrae
   **entradas tipadas** (decision/constraint/action_item/incident) + resumen + temas,
   cada una con fuente=reunión, fecha, rango de timestamps (deep-link), confianza.
- Gotchas: **no ingerir el transcript crudo** como conocimiento (ruido en la búsqueda);
  coste API ~$0.18–0.36/h (self-host rentable solo a alto volumen); VAD para evitar
  alucinación en silencios; mapear `SPEAKER_00` a nombres a mano.

## 4. Grabación de reuniones — build vs defer
**Mercado (cómo consiguen la grabación):** (a) **bot que entra a la llamada** (Fireflies/
Otter/Fathom; casi todos compran **Recall.ai**, ~$0.50/h + $0.15/h transcripción, una
integración para Zoom/Meet/Teams/Webex) — bot visible, fricción de consentimiento; (b)
**APIs nativas** (Zoom Cloud/Teams Graph) post-reunión — sin bot, pero requiere planes
de pago/OAuth admin por tenant; (c) **captura de audio local** estilo **Granola** (sin
bot, privacy-friendly, pero app de escritorio propia); (d) **el usuario sube el fichero**
— cero infraestructura.

**Recomendación: DEFERIR la captura. Empezar con "el usuario aporta la grabación/
transcript" y Cortex transcribe+ingiere.** El valor de Cortex es el **conocimiento**, no
poseer el pipeline de grabación: upload-only se entrega en días, sin coste por hora, sin
superficie legal, y sirve también para reuniones presenciales. Mantener la captura
**enchufable** detrás del ingest. Si más tarde se quiere automatizar → **Recall.ai**
(o su Desktop SDK / captura local estilo Granola para menor exposición legal), no
construir bots propios.
- Legal/consentimiento (importante para una consultora): grabar = datos personales bajo
  **GDPR** (base legal + aviso + retención). **España/Alemania y varios estados US =
  consentimiento de todas las partes**; un bot que auto-entra lo hace obligatorio. "El
  usuario sube" traslada el consentimiento a quien ya dirigió la reunión. Anunciar y
  registrar consentimiento igualmente en llamadas con cliente.

## Síntesis para el roadmap
- **Documentos** y **vídeo/audio** son viables ya (libs Node + `whisper` de nan).
  Visión depende de confirmar mimo-v2.5/gemma4 (o OCR local).
- En todo: **derivados (OCR/caption/transcript) son inferencias, no hechos** (confianza
  + proveniencia, §5.5); extraer **conocimiento tipado**, no volcar texto crudo.
- **Grabación de reuniones: no construir** — el usuario aporta la grabación (Recall.ai
  como opción futura si se automatiza).

Fuentes: ver enlaces en los hilos de investigación (Unstructured, Docling, MarkItDown,
LlamaParse, RAGFlow; kapa.ai/LlamaIndex multimodal, Qwen-VL/vLLM; WhisperX/OpenAI audio,
Otter/Fireflies/Granola; Recall.ai, IAPP/GDPR).
