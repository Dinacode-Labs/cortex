# Roadmap — Dinacode Cortex

Producto **interno** de Dinacode. Este fichero recoge lo que queda por hacer; las
decisiones técnicas firmes viven en [`decisions.md`](./decisions.md).

## Ingesta multimodal (captura más allá del texto)

Hoy los conectores solo capturan **texto** (`.md`, tickets, chat, código). El export
de Notion de CE Portal traía además **12 `.docx`, 10 `.pdf`, 1 `.xlsx`, ~300
`.png/.jpg`, 3 `.drawio` y 2 `.mp4`** que se ignoraron. Hay conocimiento valioso ahí.

### 1. Captura de documentos (Word / PDF / Excel / PPT)
- **Qué:** extraer texto (y estructura básica) de `.docx`, `.pdf`, `.xlsx`, `.pptx` y
  ingerirlos como entradas (sourceType `document`/`notion_doc`), enlazados a su
  proyecto y a la página/origen.
- **Cómo:** parser por tipo (p.ej. `mammoth` docx → texto/markdown, `pdfjs`/`pdf-parse`
  para PDF, `xlsx` para hojas). Trocear documentos largos (como el código) y embeber.
- **Por qué faltaba:** `connect-notion-export` solo procesa `.md`. Ampliar ese
  conector (o un `ingest-files <dir>` genérico) para barrer estos formatos.

### 2. Captura de imágenes (capturas, diagramas)
- **Qué:** describir/transcribir imágenes (`.png/.jpg`) y diagramas (`.drawio`) →
  texto indexable (caption + OCR del texto embebido), enlazado a su entrada.
- **Cómo:** modelo de **visión** (confirmar el disponible en nan; si no, OCR local
  tipo tesseract como fallback). Para `.drawio` (XML) se puede extraer el texto de
  nodos sin visión.
- **Cuidado:** muchas imágenes son ruido (iconos); filtrar por tamaño/relevancia.

### 3. Vídeo / audio (transcripción)
- **Qué:** transcribir `.mp4`/audio (reuniones, demos) e ingerir el transcript
  (con timestamps si es posible) como entrada del proyecto.
- **Cómo:** modelo de **transcripción de nan** (whisper-like; confirmar nombre/endpoint).
  Pipeline: extraer audio (ffmpeg) → transcribir → resumir/trocear → embeber.
  Reutilizable: ya existe la skill `watch-video-mp4` (frames + Whisper) como referencia.

### 4. Grabación de reuniones — **decisión pendiente**
¿Cortex ofrece una herramienta para **grabar** reuniones, o el usuario aporta la
grabación y Cortex solo la **transcribe+ingiere**?
- **Opción A (recomendada, MVP):** el usuario provee la grabación (Meet/Teams/Zoom)
  y Cortex la transcribe e ingiere (punto 3). Menos intrusivo, sin permisos de
  audio/calendario, sin mantener un grabador.
- **Opción B:** una skill/herramienta propia de grabación (bot que entra a la
  reunión, o captura local). Más valor "llave en mano" pero mucha más superficie
  (permisos, plataformas, legal/consentimiento). Probablemente fuera de alcance: es
  cosa del usuario proveer la grabación.
- **A decidir con el usuario.**

## Otros pendientes (ya en curso/acordados)
- **Tests** (heurísticas, loops, integración MCP) y **despliegue** reproducible
  (docker-compose). Deploy real a server, lo último (de momento no hay server).
- **Transporte HTTP del MCP** (hoy solo stdio) — para agentes remotos/hosted (Hermes
  remoto) y para el deploy.
- **Aislamiento de datos por cliente** (permisos) — necesario al ser producto interno
  con datos sensibles de varios clientes; aparcado hasta tras consolidar la base.
- Ampliar el harness: `cortex sync --remove`, prompts/políticas corporativas.
