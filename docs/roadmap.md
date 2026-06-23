# Roadmap — Dinacode Cortex

Producto **interno** de Dinacode. Este fichero recoge lo que queda por hacer; las
decisiones técnicas firmes viven en [`decisions.md`](./decisions.md).

## Ingesta multimodal (captura más allá del texto)

Hoy los conectores solo capturan **texto** (`.md`, tickets, chat, código). El export
de Notion de CE Portal traía además **12 `.docx`, 10 `.pdf`, 1 `.xlsx`, ~300
`.png/.jpg`, 3 `.drawio` y 2 `.mp4`** que se ignoraron. Hay conocimiento valioso ahí.

> Investigación de cómo lo hacen otros + capacidades reales de nan:
> [`research/multimodal-ingestion.md`](./research/multimodal-ingestion.md).
> **nan tiene `whisper`** (transcripción ✅) y posible visión vía `mimo-v2.5`/`gemma4`
> (a confirmar). **Principio:** OCR/caption/transcript son **inferencias, no hechos**
> (confianza + proveniencia, §5.5); extraer **conocimiento tipado**, no volcar texto crudo.

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

### 3. Vídeo / audio (transcripción) — **viable ya**
- **Qué:** transcribir `.mp4`/audio (reuniones, demos) y extraer **conocimiento tipado**
  (decisiones/action items/incidencias + resumen + temas) con timestamps, no el
  transcript crudo.
- **Cómo (confirmado):** **nan `whisper`** vía `/v1/audio/transcriptions` (contrato
  OpenAI, multipart). Pipeline: ffmpeg (`-vn -ac 1 -ar 16000`) → chunkear (~25 MB/25 min
  límite) → transcribir (`verbose_json`) → LLM de `@cortex/agents` estructura. Interfaz
  `TranscriptionProvider` con fallback `whisper.cpp`. Diarización aparcada (frágil).
  Ref: skill `watch-video-mp4`.

### 4. Grabación de reuniones — **recomendación: NO construir (investigado)**
La investigación de mercado lo deja claro: el valor de Cortex es el **conocimiento**, no
poseer el pipeline de grabación.
- **Recomendado:** **el usuario aporta la grabación/transcript** y Cortex transcribe+
  ingiere (punto 3). Se entrega en días, sin coste por hora, sin superficie legal, y
  sirve también para reuniones presenciales. Mantener la captura **enchufable**.
- **Si más adelante se quiere automatizar:** **Recall.ai** (bot-as-a-service, una
  integración para Zoom/Meet/Teams, ~$0.65/h) o captura local estilo Granola — no
  construir bots propios.
- **Legal:** grabar = datos personales (GDPR); **España exige consentimiento de todas
  las partes**. Un bot que auto-entra lo hace obligatorio; "el usuario sube" traslada el
  consentimiento a quien dirigió la reunión. Anunciar/registrar consentimiento en
  llamadas con cliente.

## Otros pendientes (ya en curso/acordados)
- **Tests** (heurísticas, loops, integración MCP) y **despliegue** reproducible
  (docker-compose). Deploy real a server, lo último (de momento no hay server).
- **Transporte HTTP del MCP** (hoy solo stdio) — para agentes remotos/hosted (Hermes
  remoto) y para el deploy.
- **Aislamiento de datos por cliente** (permisos) — necesario al ser producto interno
  con datos sensibles de varios clientes; aparcado hasta tras consolidar la base.
- Ampliar el harness: `cortex sync --remove`, prompts/políticas corporativas.
