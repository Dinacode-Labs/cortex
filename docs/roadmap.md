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

### 2. Captura de imágenes y diagramas — **hecho (v1)**
- **Implementado en `extract.ts`:** imágenes (`.png/.jpg/.jpeg/.webp/.gif`) → **caption
  con el modelo de visión** del proveedor (verificado: **qwen3.6 y gemma4 de nan ven
  imágenes**; el 403 era el User-Agent de Cloudflare). `.drawio` → texto de nodos/aristas
  del XML (maneja diagramas comprimidos con inflate), sin visión. Los conectores
  (notion, docs) los recogen solos vía `SUPPORTED_EXTS` y los enlazan a su página.
  Filtro de ruido: imágenes < 8 KB se omiten; el VLM marca `IRRELEVANTE` los iconos.
- **Pendiente:** dedup por content-hash (no captionar imágenes repetidas), OCR como
  fallback para texto denso, cascada coste (clasificar antes de llamar al VLM).

### 3. Vídeo / audio (transcripción) — **hecho (v1)**
- **Implementado en `extract.ts`:** audio (`.opus` de WhatsApp, mp3, m4a, ogg, wav,
  flac, amr…) y vídeo (mp4, mov, mkv, webm…) → **transcripción con `whisper` de nan**
  (`/v1/audio/transcriptions`, multipart). Vídeo y formatos no soportados se
  **transcodifican con ffmpeg** a mp3 mono 16 kHz antes. Los conectores los recogen y
  enlazan a su página. Verificado: mp4 de CE Portal (grabación de un bug) → transcripción
  correcta.
- **Pendiente:** **chunking** para audios > ~24 MB / largos (hoy se omiten); diarización
  (quién dijo qué); destilar el transcript a conocimiento tipado (no volcar crudo) —
  el `distiller` ya existe (connect-sessions), se puede reutilizar para reuniones.

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

## Hooks del agente (automatizar el bucle) — **v1 hecho (Claude Code)**

Bucle automático sin invocación manual. Análisis + fricción:
[`research/hooks-integration.md`](./research/hooks-integration.md).

> **Implementado (Claude Code):**
> - **SessionStart → inyección de contexto** (`@cortex/core hook:context`): resuelve el
>   proyecto del repo (`.cortex.json`: `{"project":"…"}`) y emite el context-pack como
>   `additionalContext`. Va directo a la BD (el MCP aún no está conectado en SessionStart).
> - **SessionEnd → auto-captura** (`@cortex/agents hook:capture`): destila la sesión
>   actual (reutiliza `connect-sessions`/`distiller`) y la guarda en Cortex. Silencioso,
>   idempotente.
> - **Distribución:** `cortex sync` los instala/actualiza en `~/.claude/settings.json`
>   (preserva lo existente). Verificado: inyección OK, captura idempotente.

- **Hallazgo:** los hooks ya **no son solo de Claude** (Codex, OpenCode plugins TS,
  Hermes también) — la fricción es de **forma**, no de ausencia.

> **Adaptadores de inyección de contexto — hechos (los 4 agentes), distribuidos por `cortex sync`:**
> - **Codex**: `[[hooks.SessionStart]]` en `config.toml` → `hook:context` (mismo
>   `additionalContext` que Claude, contrato idéntico).
> - **OpenCode**: plugin TS generado (`~/.config/opencode/plugin/cortex.js`) que en
>   `session.created` hace shell-out a `hook:context --format text` e inyecta en `chat.message`.
> - **Hermes**: `pre_llm_call` en `~/.hermes/config.yaml` → `hook:context --format hermes`
>   (salida `{"context":…}`).
> - `hook:context` es multi-formato (`--format claude|hermes|text`, `--cwd`).
> Codex/OpenCode/Hermes construidos según sus contratos documentados; runtime no
> probado localmente (esos agentes no tienen sesión aquí), como el MCP de Hermes.

- **Gate de la auto-captura — hecho.** No se captura en crudo ni se duplica (anti-patrón:
  context rot/distractores; ver [`research/memory-capture-policy.md`](./research/memory-capture-policy.md)).
  `ingestSessionFile` (hook + backfill) hace **reconciliación estilo mem0 ADD/UPDATE/NOOP**
  (`core/dedup.ts`): por cada unidad destilada busca la más similar del proyecto y
  **ADD** (nueva, `confidence: low`), **UPDATE** (fusiona con el agente `merger` si
  refina, 0.82–0.95), **SUPERSEDE/DELETE** (si un juez LLM `reconciler` detecta
  contradicción → ADD la nueva como vigente + **invalida la vieja** bi-temporalmente,
  §5.5 invalidar≠borrar; si la vieja es **curada**, no se toca: se marca `contradicts`
  para revisión) o **NOOP** (casi idéntico ≥0.95). Verificado: el `reconciler` clasifica
  contradicción→supersede, refinamiento→update, idéntico→noop.
- **Auto-curación (sin humano) — hecho.** Nada de review humano bloqueante (mataría la
  agilidad): la captura escribe ya, con confianza baja. `maintain` ejecuta `autoCurate`
  (`core/curate.ts`): **promueve** a confianza media lo auto-capturado que se
  **corroboró** (se reforzó/fusionó tras crearse → recurrió en otra sesión) y **decae**
  (`obsolete`, sale de búsqueda) lo viejo nunca corroborado (> `CORTEX_DECAY_DAYS`, def.
  120). La calidad sube sola con el tiempo, la captura sigue 100% ágil.
- **Reconciliación en conectores — hecho.** El primitivo `saveWithReconciliation`
  (`core/dedup.ts`) unifica el gate; las **sesiones** lo usan con el reconciliador LLM
  inyectado (`setReconciler`) → ADD/UPDATE/SUPERSEDE/NOOP. Los **conectores** (CLIs de
  core, embeben por lotes, sin LLM) se reconcilian en `maintain` vía **`reconcileProject`**:
  dedup de near-idénticos del mismo `source_type` **reusando los embeddings** ya
  calculados (sin coste). **Excluye formatos imagen** (su embedding es un caption genérico
  → agruparía imágenes distintas). Verificado en CE Portal: 11 near-dups de texto
  deduplicados, 0 imágenes tocadas.
- **Pendiente:** `/review` opcional NO bloqueante (curado a mano), solo si hace falta;
  merge LLM (no solo dedup) en el pase de maintain.
- **Pendiente:** **auto-captura** en Codex/OpenCode/Hermes (Claude tiene `transcript_path`
  + SessionEnd limpios; los demás no exponen transcript / no tienen session-end → se
  cubren con el **backfill batch** `connect-sessions` por plataforma). `UserPromptSubmit`
  (RAG por prompt). Bin `cortex` para no arrancar pnpm/tsx en cada hook (latencia).

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
