# Roadmap — Cortex

Lo que queda por hacer en el producto. Las decisiones técnicas firmes viven en
[`decisions.md`](./decisions.md).

> Aquí solo va el **qué** técnico. Las prioridades de negocio, los responsables y la
> configuración concreta de cada despliegue son de cada operador y no se documentan en este
> repo (ADR-0031).

## Refactor de arquitectura — ✅ COMPLETADO (julio 2026)

Refactor por fases **completado** (PRs #2–#20): informe, hallazgos y estado de cada paso
en [`refactor/`](./refactor/README.md). Fase A (parches de riesgo + unificación de
lookups/wiring), B (entrypoints a `apps/cli`, `core` sin LLM), C (apps testeables + split
de la web con `hono/html` + guards unificados), D (splits internos, consolidaciones,
helper de env, hardening de BD). Más el fix de seguridad P0 (backlog #1). Reglas de
dependencia formalizadas en `CLAUDE.md`; decisiones y lo aplazado por proporcionalidad en
[`decisions.md`](./decisions.md) (ADR-0017–0022). Los hallazgos comunes con la auditoría de
junio quedan referenciados en su [backlog](./audit/99-backlog-priorizado.md).

## Identidad, atribución y permisos (para "luego", necesita servidor)

- **Necesidad:** registrar **quién** mete **qué** dato y **cuándo** (atribución/auditoría).
  Media base ya hecha: cada entrada tiene `created_by` + `created_at` (§5.5); hoy
  `created_by` es el origen (`session-backfill`, `notion`…). Con identidad real,
  `created_by` = el **email autenticado** → atribución sin cambiar el modelo.
- **Auth propuesta: email + OTP (sin passwords).** El usuario **es** su correo
  (el dominio lo fija `CORTEX_AUTH_DOMAIN`). Flujo tipo `gh auth login`: `cortex auth login` → email → OTP →
  token local (`~/.cortex/credentials`); cada save/captura viaja firmada por el email.
- **Permisos/compartición:** sobre lo anterior — proyecto como entidad gestionada
  (dueño + miembros, read/write/share). El **gate de slug** (`resolveLinkedProject`) es
  el punto donde enchufar "resolver usuario → permiso sobre el proyecto".
- **Dependencia dura:** hoy los hooks/CLI hablan **directo a Postgres**. Auth multi-
  usuario + permisos exigen que **Cortex sea un servicio con API HTTP** autenticada →
  se acopla a *transporte HTTP del MCP* + *despliegue real*. Atribución, permisos y auth
  **llegan juntos con el servidor**. Necesita además un servicio de envío de email (OTP).
- **Hecho:** servidor HTTP (apps/server) + auth email/OTP + endpoints autenticados
  `/context-pack`, `/capture`, `/projects`. Los **hooks** ya pasan por la API (cliente
  `core/api-client`): `cortex hook-context`→GET /context-pack, `cortex hook-capture`→distila local y POST
  /capture con atribución (created_by=email) + permisos. **Requiere el servidor en marcha**
  (`cortex server`); si no, los hooks degradan en silencio. **Pendiente:** migrar los
  conectores batch (docs/notion/github/backfill) — necesitan un `POST /capture/batch` (para
  conservar el embedding por lotes) y `/relate` (enlaces de adjuntos).

## Ingesta multimodal (captura más allá del texto)

Hoy los conectores solo capturan **texto** (`.md`, tickets, chat, código). El export
de Notion de un cliente real traía además **12 `.docx`, 10 `.pdf`, 1 `.xlsx`, ~300
`.png/.jpg`, 3 `.drawio` y 2 `.mp4`** que se ignoraron. Hay conocimiento valioso ahí.

> **Principio:** OCR/caption/transcript son **inferencias, no hechos**
> (confianza + proveniencia, §5.5); extraer **conocimiento tipado**, no volcar texto crudo.

### 1. Captura de documentos (Word / PDF / Excel) — **hecho (v1)**
- **Implementado:** `connect-docs <Proyecto> <dir>` (`@cortex/core`) recorre un
  directorio y extrae texto de `.docx` (mammoth), `.pdf` (unpdf) y `.xlsx` (SheetJS),
  ingiriendo cada uno como `sourceType: document` (2 fases, embeddings por lotes); el
  grafo lo añade `maintain`/`enrich`. PDF escaneado (sin capa de texto) se omite.
  Verificado: 23 documentos de un proyecto piloto (contratos, certificados, registros de
  mantenimiento…), 0 secretos.
- **Chunking de docs largos — hecho (#30):** ya no se trunca; `chunkDocument` trocea por
  estructura con solape (ver «Estrategia de modelos LLM y chunking» más abajo).
- **Pendiente:** `.pptx` (officeparser), OCR para PDF escaneado (Unstructured/Docling
  self-host o tesseract).

### 2. Captura de imágenes y diagramas — **hecho (v1)**
- **Implementado en `extract.ts`:** imágenes (`.png/.jpg/.jpeg/.webp/.gif`) → **caption
  con el modelo de visión** del proveedor (`CORTEX_VISION_MODEL`; verificado con modelos
  multimodales reales — un 403 inicial resultó ser el User-Agent, no el modelo). `.drawio` → texto de nodos/aristas
  del XML (maneja diagramas comprimidos con inflate), sin visión. Los conectores
  (notion, docs) los recogen solos vía `SUPPORTED_EXTS` y los enlazan a su página.
  Filtro de ruido: imágenes < 8 KB se omiten; el VLM marca `IRRELEVANTE` los iconos.
- **Dedup por content-hash — hecho:** `captionImage` cachea por sha256 del fichero
  (en proceso) → no llama al VLM dos veces para la misma imagen (frecuente en exports).
- **Pendiente:** OCR como fallback para texto denso, cascada de coste (clasificar antes
  de llamar al VLM), persistir el cache de captions entre ejecuciones.

### 3. Vídeo / audio (transcripción) — **hecho (v1)**
- **Implementado en `extract.ts`:** audio (`.opus` de WhatsApp, mp3, m4a, ogg, wav,
  flac, amr…) y vídeo (mp4, mov, mkv, webm…) → **transcripción por STT**
  (`/v1/audio/transcriptions`, multipart; `CORTEX_STT_*`). Vídeo y formatos no soportados se
  **transcodifican con ffmpeg** a mp3 mono 16 kHz antes. Los conectores los recogen y
  enlazan a su página. Verificado: mp4 de un proyecto piloto (grabación de un bug) → transcripción
  correcta.
- **Chunking — hecho:** los audios largos (> límite de whisper, ~24 MB) se **trocean con
  ffmpeg** (`-f segment`, segmentos mono 16 kHz de `CORTEX_AUDIO_SEGMENT_SEC`, def. 600 s)
  y se transcriben por partes, uniendo el texto. Verificada la segmentación.
- **Pendiente:** diarización (quién dijo qué); destilar el transcript a conocimiento tipado (no volcar crudo) —
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

## Config de IA por proyecto en el registry (pendiente)

Hoy el toolbelt es **global**: reparte los mismos MCPs, skills y comandos a todos los
repos. Falta soportar config **por proyecto** en el registry (el `CLAUDE.md`, los permisos,
los hooks y los MCPs que solo tienen sentido en un repo concreto) para que `cortex toolbelt
sync` la instale junto con la global. Esquema del registry en
[`toolbelt-registry.md`](./toolbelt-registry.md).

## Hooks del agente (automatizar el bucle) — **v1 hecho (Claude Code)**

Bucle automático sin invocación manual. Análisis + fricción:
[`research/hooks-integration.md`](./research/hooks-integration.md).

> **Implementado (Claude Code):**
> - **SessionStart → inyección de contexto** (`cortex hook-context`): resuelve el
>   proyecto del repo (`.cortex.json`: `{"project":"…"}`) y emite el context-pack como
>   `additionalContext`. Va directo a la BD (el MCP aún no está conectado en SessionStart).
> - **SessionEnd → auto-captura** (`cortex hook-capture`): destila la sesión
>   actual (reutiliza `connect-sessions`/`distiller`) y la guarda en Cortex. Silencioso,
>   idempotente.
> - **Distribución:** `cortex setup` los instala/actualiza (hoy vía plugin; antes en `settings.json`)
>   (preserva lo existente). Verificado: inyección OK, captura idempotente.

- **Hallazgo:** los hooks ya **no son solo de Claude** (Codex, OpenCode plugins TS,
  Hermes también) — la fricción es de **forma**, no de ausencia.

> **Adaptadores de inyección de contexto — hechos (los 5 agentes), distribuidos por `cortex setup`:**
> - **Codex**: `[[hooks.SessionStart]]` en `config.toml` → `cortex hook-context` (mismo
>   `additionalContext` que Claude, contrato idéntico).
> - **OpenCode**: plugin TS generado (`~/.config/opencode/plugin/cortex.js`) que en
>   `session.created` hace shell-out a `cortex hook-context --format text` e inyecta en `chat.message`.
> - **Hermes**: `pre_llm_call` en `~/.hermes/config.yaml` → `cortex hook-context --format hermes`
>   (salida `{"context":…}`).
> - `cortex hook-context` es multi-formato (`--format claude|hermes|text`, `--cwd`).
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
  → agruparía imágenes distintas). Verificado en el proyecto piloto: 11 near-dups de texto
  deduplicados, 0 imágenes tocadas.
- **Pendiente:** `/review` opcional NO bloqueante (curado a mano), solo si hace falta;
  merge LLM (no solo dedup) en el pase de maintain.
- **Auto-captura del resto — hecho (backfill).** Claude tiene captura en tiempo real
  (SessionEnd + transcript); Codex/OpenCode/Hermes no exponen un session-end con
  transcript completo, así que se cubren con **backfill batch** desde su store:
  `cortex connect-sessions "<slug>" <repo> codex|opencode|hermes`. Lectores en
  `session-readers.ts` (Codex `~/.codex/sessions/*.jsonl`; OpenCode
  `~/.local/share/opencode/storage` join session→message→part; Hermes `~/.hermes/state.db`
  SQLite vía `node:sqlite`), pipeline compartido `captureCondensedViaApi` (destila + POST
  autenticado). Codex/OpenCode verificados con stores sintéticos; Hermes degrada bien sin
  db (lógica no probada con datos reales). Pendiente: programarlo (cron) y probar Hermes real.
- **Pendiente:** `UserPromptSubmit` (RAG por prompt) opcional.

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

## Índice navegable de contexto dentro de un proyecto (a estudiar)

**Propuesta:** dentro de un mismo proyecto con mucha información, un índice/mapa navegable
(por área o módulo, con resúmenes) que el agente pueda recorrer, en vez de depender solo de
la búsqueda semántica.

**Contraargumento a validar:** un índice siempre-en-contexto **compite por el presupuesto
de contexto** y **se desactualiza** (hay que mantenerlo en cada cambio); el retrieval
semántico evita ambas cosas. Habría que determinar si el índice **gana** en algún régimen
concreto (proyectos enormes, navegación estructural, «saber qué existe» frente a «encontrar
lo relevante»).

**Diseño a evaluar (solo si el research sale a favor):** una capa de índices con resúmenes
por área generada y mantenida en `maintain` (no a mano), con trazabilidad (es inferencia, no
hecho; §5.5) y coste acotado. **Salida esperada:** un `research/context-index.md` con
conclusión razonada (construir / no construir / construir acotado) **antes de tocar código**.

## Estrategia de modelos LLM y chunking (dirección acordada, jul 2026)

Asignación de **modelo por rol** y arreglo del **chunking**. Contrastado con benchmarks
recientes (Artificial Analysis Intelligence Index v4.1, jul 2026) y datos reales de
`llm_usage`. **Estado:** Fase 0 (desacoplar proveedores, #29), Fase 1 (chunking v1, #30),
Fase 2 (modelo por rol + log servido, #31) y el proveedor genérico (ADR-0024)
**mergeadas**. Pendiente: activar el routing en el `.env` (solo config) y Contextual
Retrieval (Fase 4, condicionado al eval set).

- **✅ Proveedor genérico (sept 2026):** el vendor que estaba cableado en el código se
  generalizó a **`openai-compatible`** (ADR-0024), que vale igual para un cluster remoto o
  para Ollama/vLLM/LM Studio en local; `nan` queda como alias obsoleto hasta 0.2.0. Qué
  endpoint y qué modelos usa cada despliegue es decisión del operador y vive en su `.env`,
  no aquí (ADR-0031). Conservar el mismo modelo de embedding evita recalibrar los umbrales
  de dedup de ADR-0009; cambiarlo obliga a re-embeder.
- **Chunking de documentos — v1 hecho (#30):** antes un doc entraba como 1 entry / 1
  vector **truncado a 8k** (perdía casi todo en silencio). Ahora `chunkDocument` trocea
  por estructura (headings → párrafos → frases) en fragmentos de ~1000 tokens con solape,
  cada uno referido a su doc padre. **Pendiente:** Contextual Retrieval (prefijo LLM por
  chunk) + parent-document + set de mini-evals (recall@5/MRR).
- **🔬 Estrategias de chunking — INVESTIGADO (jul 2026):** deep-research con
  verificación adversarial (23 claims confirmados, 2 refutados), informe completo en
  [`research/chunking-strategies.md`](./research/chunking-strategies.md). Conclusiones:
  (1) el **chunker estructural v1 es el patrón que la evidencia respalda** (Docling/
  RAGFlow hacen lo mismo; NAACL 2025: el semantic chunking no justifica su coste;
  la intuición de que con híbrido+rerank el chunking importa menos, **acotadamente
  confirmada** — las capas se suman, no se compensan). (2) Descartados semantic chunking
  (English-only, sin ganancias consistentes) y late chunking (inviable vía API).
  (3) Contextual Retrieval con LLM **aplazado**: solo si el eval muestra fallos por
  pérdida de contexto (rebaja la Fase 4 de ADR-0023). **Siguiente paso: el eval set**
  (30–100 queries ES con evidencia anotada, incluir queries evidence-dense; plantilla:
  benchmark open-source de Chroma). Pendiente de leer: arXiv 2604.01733 (posible
  ablación chunking×rerank, sin verificar).
- **Config de modelo por rol:** `CORTEX_MODEL_<ROLE>` con fallback al default +
  `CORTEX_VISION_MODEL` separado (hoy `media.ts` hereda el modelo de chat y se rompe con
  modelos text-only) + loguear el modelo **servido** (detecta routing de OpenRouter).
- **Decisión registrada:** [ADR-0023](./decisions.md), revisada en la parte de proveedor
  por [ADR-0024](./decisions.md). Qué modelos usa cada despliegue, con qué endpoint y a qué
  coste, es decisión del operador (ADR-0031).

## Otros pendientes (ya en curso/acordados)
- **Tests** (heurísticas, loops, integración MCP) y **despliegue** reproducible
  (docker-compose). Deploy real a server, lo último (de momento no hay server).
- **Transporte HTTP del MCP** (hoy solo stdio) — para agentes remotos/hosted (Hermes
  remoto) y para el deploy.
- **Aislamiento de datos por cliente** (permisos) — necesario al ser producto interno
  con datos sensibles de varios clientes; aparcado hasta tras consolidar la base.
- Ampliar el harness: prompts y políticas corporativas en el registry externo.
