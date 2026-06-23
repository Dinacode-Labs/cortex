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

### 1. Captura de documentos (Word / PDF / Excel) — **hecho (v1)**
- **Implementado:** `connect-docs <Proyecto> <dir>` (`@cortex/core`) recorre un
  directorio y extrae texto de `.docx` (mammoth), `.pdf` (unpdf) y `.xlsx` (SheetJS),
  ingiriendo cada uno como `sourceType: document` (2 fases, embeddings por lotes); el
  grafo lo añade `maintain`/`enrich`. PDF escaneado (sin capa de texto) se omite.
  Verificado: 23 documentos de CE Portal (contratos, certificados, registros de
  mantenimiento…), 0 secretos.
- **Pendiente:** `.pptx` (officeparser), OCR para PDF escaneado (Unstructured/Docling
  self-host o tesseract), trocear documentos muy largos (hoy cap por entrada).

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

## Consolidar `ai-manager` dentro de Cortex (→ Alejandro)

`git@github.com:Dinacode-Labs/ai-manager.git` es hoy donde Dinacode **comparte las
configs de Claude por proyecto**. Esto **solapa directamente** con el harness de Cortex
(`config/toolbelt.json` + `cortex sync`, que ya reparte MCPs/skills/comandos a
Claude/Codex/OpenCode/Hermes). La idea: **Cortex se encarga de TODO** — unificar la
distribución de config de IA (global y **por proyecto**) en un único sistema.

- **Qué falta:** soportar config **por-proyecto** en el registry (hoy el toolbelt es
  global); que `cortex sync` instale también la config específica del proyecto (CLAUDE.md,
  permisos, hooks, MCPs/skills del proyecto) — lo que hoy vive en ai-manager.
- **Migración:** importar lo de ai-manager al modelo de Cortex y deprecar el repo.
- **Responsable:** **Alejandro.** (Aquí solo queda indicado.)

## Hooks del agente (automatizar el bucle, multi-agente)

Aprovechar los **hooks** de los agentes para que el bucle de Cortex sea **automático**:
inyectar el context-pack al arrancar/por prompt (`SessionStart`/`UserPromptSubmit` →
`additionalContext`) y auto-capturar la sesión al terminar (`Stop`/`SessionEnd` →
`save_project_context`). Análisis completo + cómo lo hacen otros (claude-mem, mem0,
disler observability) + fricción: [`research/hooks-integration.md`](./research/hooks-integration.md).

- **Hallazgo:** los hooks ya **no son solo de Claude** — Codex, OpenCode (plugins TS) y
  Hermes también tienen ciclo de vida; la fricción es de **forma** (formato/eventos/
  payload), no de ausencia.
- **Estrategia:** **MCP = baseline portable**; hooks como **mejora progresiva** con
  **adaptadores finos por agente** (shell Claude/Codex/Hermes, plugin TS OpenCode) que
  llaman a las mismas tools de Cortex. Distribuirlos vía `cortex sync` (sección `hooks`
  en el toolbelt). No construir features exclusivas de hooks (rompe la promesa multi-agente).
- **Depende de:** transporte HTTP del MCP (para `SessionStart`, donde el MCP aún no está
  conectado).

## Backfill de conversaciones de agente → Cortex (depuradas) — **v1 hecho (Claude)**

Comando para **revisar todas las sesiones de un agente en un proyecto y subir el
conocimiento a Cortex**, depurando (no volcar el transcript crudo). **Complementa a los
hooks**: los hooks capturan en tiempo real (hacia delante); esto hace **backfill
retroactivo** del historial y sirve para plataformas donde el hook es incómodo.

> **Implementado (v1, Claude Code):** `connect-sessions <Proyecto> <ruta-repo>`
> (`@cortex/agents`). Lee `~/.claude/projects/<ruta>/*.jsonl`, condensa el diálogo
> (descarta tool calls/thinking/volcados), **borra secretos** (scrub), **destila con el
> agente `distiller` de Mastra** a entradas tipadas, e ingiere (sourceType
> `agent_session`, proveniencia por sesión, incremental). Verificado dogfooding sobre
> las sesiones de Cortex (0 secretos colados). **Pendiente:** Codex/OpenCode/Hermes,
> dedup contra lo ya existente (hoy solo intra-run), ventanas completas en sesiones largas.

- **Fuentes (verificado):** las sesiones se guardan por plataforma —
  Claude Code `~/.claude/projects/<ruta-saneada>/*.jsonl` (1 carpeta por proyecto),
  Codex `~/.codex/sessions`, OpenCode `~/.local/share/opencode`, Hermes `~/.hermes`.
  Un **lector por plataforma** mapea proyecto → sus sesiones. (Aviso: son grandes —
  cortex ≈ 23 MB en 2 sesiones — de ahí la depuración obligatoria.)
- **Comando:** `cortex ingest-sessions <proyecto> [--platform claude|codex|...] [--since]`
  (conector `connect-sessions`). Incremental: registrar sesiones ya ingeridas para no
  duplicar.
- **Pipeline de depuración (lo importante):** leer transcript → segmentar por sesión →
  **destilar con LLM a conocimiento TIPADO** (decisiones, restricciones, incidencias,
  convenciones, how-tos, gotchas) descartando ruido (tool calls, volcados de ficheros,
  narración verbosa, caminos abandonados) → **dedup contra lo ya existente** (reusar el
  near-dup/lint) → guardar con proveniencia (source=`agent_session`, plataforma, id de
  sesión, fecha, **confianza**; §5.5). NO ingerir el transcript crudo.
- **Cautelas:** **secretos/PII** en transcripts (claves pegadas, `.env`) → **scrub
  antes** de enviar al LLM y de guardar; **coste** (chunking + resumen jerárquico; solo
  el proyecto pedido); **dedup vs hooks** (si el hook ya capturó, no duplicar);
  privacidad (las sesiones son logs de trabajo personales — uso interno).
- **Pendiente de dominio:** sourceType `agent_session` (hoy existe `claude_code`).
- **Cómo lo hacen otros:** claude-mem/mem0 ya "comprimen sesiones" (ver
  [`research/hooks-integration.md`](./research/hooks-integration.md)); esto es la versión
  **batch + multi-plataforma** que alimenta a Cortex con el mismo `save_project_context`.

## Procesos periódicos / scheduler

**Decisión (usuario):** el **sync de fuentes NO se automatiza** — lo dispara el
developer (tiene el contexto/criterio del origen). El **mantenimiento sí** (ocurre 100%
en server) → automatizado.

> **Implementado:** `maintain` (`@cortex/agents`) — pipeline único e idempotente
> enrich(only-missing) → resolve-entities → temporal → lint, con **advisory lock** (no
> solapa) y por-proyecto o global. Worker programado `maintain:worker` (node-cron,
> `CORTEX_MAINTAIN_CRON`, def 3:00 diario). Verificado (captó entradas nuevas, lint por
> proyecto, lock OK).
> **Para "en marcha" en server:** correr `maintain:worker` como servicio (o cron del
> sistema llamando a `maintain`) — se cablea en el **docker-compose al desplegar** (hoy
> el compose solo tiene Postgres; el servicio worker necesita la imagen de la app).

Loops cubiertos: enrich, resolve, temporal, lint. **Pendiente:** dedup explícito como
paso, observabilidad de ejecuciones (tabla `jobs`), y el servicio en compose (deploy).

**Qué debería correr periódico (dos familias):**
1. **Sync de fuentes** (ingesta de lo nuevo): GitHub/Plane/Chat/sesiones/(multimodal).
   Frecuencia: diaria/horaria por proyecto.
2. **Mantenimiento/mejora** (§12), tras ingesta o nocturno: `enrich` (only-missing),
   `resolve-entities`, `temporal` (invalidación), `lint` (salud), dedup.

**Opciones de diseño:**
- **A. Cron + CLIs (MVP, recomendado para empezar):** contenedor `worker` en el
  docker-compose con cron que ejecuta los comandos en horarios. Cero código nuevo
  (reusa los CLIs, ya idempotentes). Encaja con el **despliegue**.
- **B. Scheduler in-app:** worker Node (node-cron) + tabla `jobs` (estado, locking,
  última ejecución, errores) → reintentos + observabilidad (encaja con `ai_traces`/
  `/usage`) + posible UI de jobs.
- **C. Por eventos/incremental:** tras cada `save`/ingesta, encolar `enrich` del nuevo
  + debounce de `resolve`/`temporal`. Más reactivo, más complejo.

**Transversal:** idempotencia (ya la tenemos), **locking** (no solapar enriquecimientos),
incrementalidad (`enrich` only-missing ya existe; resolve/temporal son full pero baratos),
registrar ejecuciones, por-proyecto.

**Deliverable concreto sugerido:** un comando único `cortex maintain <proyecto>` que
encadene enrich(only-missing) → resolve-entities → temporal → lint (lo que hoy hago a
mano), y que el cron invoque. **Recomendación:** empezar con **A** al desplegar y
evolucionar a **B** cuando queramos reintentos/observabilidad. **Depende del despliegue**
(no hay server aún).

## Otros pendientes (ya en curso/acordados)
- **Tests** (heurísticas, loops, integración MCP) y **despliegue** reproducible
  (docker-compose). Deploy real a server, lo último (de momento no hay server).
- **Transporte HTTP del MCP** (hoy solo stdio) — para agentes remotos/hosted (Hermes
  remoto) y para el deploy.
- **Aislamiento de datos por cliente** (permisos) — necesario al ser producto interno
  con datos sensibles de varios clientes; aparcado hasta tras consolidar la base.
- Ampliar el harness: `cortex sync --remove`, prompts/políticas corporativas.
