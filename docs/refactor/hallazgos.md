# Hallazgos de la revisión de arquitectura — julio 2026

> **Anexo** del [informe y plan de refactor](./README.md). Foto a **2026-07-03** sobre
> `main` (9b43a87). Generado con un workflow multiagente (8 lectores por
> subsistema/dimensión, 3 propuestas de arquitectura independientes y un crítico que
> verificó los hallazgos clave contra el código); la evidencia cita `fichero:línea`.
>
> Cómo leerlo: cada sección es un área; las dos últimas son **transversales** (duplicación
> y capas) y consolidan deliberadamente hallazgos que también aparecen en su área — se
> mantienen porque aportan la vista de conjunto. Severidad: 🔴 alta · 🟡 media · 🟢 baja.
> Al corregir un hallazgo, refléjalo en el [plan](./README.md); **el código manda sobre
> este documento**.

## Índice

1. [Área A · packages/core/src](#área-a) — 14 hallazgos (3 high · 8 medium · 3 low)
2. [Área B · packages/agents/src](#área-b) — 13 hallazgos (1 high · 5 medium · 7 low)
3. [Área C · packages/shared/src, packages/database/src + migrations, packages/embeddings/src](#área-c) — 11 hallazgos (1 high · 6 medium · 4 low)
4. [Área D · apps/web/src](#área-d) — 12 hallazgos (2 high · 5 medium · 5 low)
5. [Área E · apps/mcp-server/src y apps/server/src](#área-e) — 14 hallazgos (5 medium · 9 low)
6. [Área F · apps/cli, scripts/, tests/](#área-f) — 12 hallazgos (3 high · 4 medium · 5 low)
7. [Área G · Duplicación transversal](#área-g) — 19 hallazgos (3 high · 12 medium · 4 low)
8. [Área H · Capas y dependencias](#área-h) — 13 hallazgos (3 high · 6 medium · 4 low)

---

<a id="área-a"></a>

## Área A — packages/core/src (paquete @cortex/core, 34 ficheros, ~3.900 LOC)

**Diagnóstico:** @cortex/core es en realidad tres cosas en un solo paquete: (a) el dominio server-side (save/search/context-pack, dedup, lint, temporal, curación) con SQL crudo por todas partes, (b) un contexto de identidad completo (auth OTP + tokens + email Brevo + permisos) y (c) un lado cliente (api-client HTTP, conectores CLI, hooks) que habla con el servidor en la dirección opuesta de dependencia. La promesa de CLAUDE.md ("core es determinista, sin LLM") se cumple para clasificación/rerank/reconciliación (bien resuelto con hooks inyectables setClassifier/setReranker/setReconciler), pero se incumple frontalmente en extract.ts, que llama directamente a APIs de LLM (visión, OCR, whisper) leyendo API keys del entorno. Hay 11 entrypoints ejecutables (main + process.argv + process.exit) mezclados con código de librería dentro de src/, uno de los cuales (lint-act.ts) ejecuta su CLI incondicionalmente al ser importado. La duplicación es alta y sintomática de vibecoding: 6-7 implementaciones de "buscar projectId" con dos semánticas distintas (canonical_name vs name exacto, lo que deja la reconciliación/dedup silenciosamente inoperante según la capitalización), la fusión RRF copiada entre vectors.ts y code.ts, tres walkers de directorio, tres normalizadores de nombres y una interfaz declarada dos veces en el mismo fichero. La configuración se lee de process.env en 36 puntos de 14 ficheros, con el mismo env var con defaults distintos en dos sitios. El manejo de errores abusa de catch-all silenciosos (extractFileText convierte cualquier bug en "fichero no soportado") y de Error genérico con mensajes de usuario en español. La testabilidad es desigual: mitad de funciones reciben sql/provider por parámetro, mitad usan singletons internos, y hay side effects en import (sink global de usage, loadEnv entre imports). Nada de esto exige DDD ni capas nuevas: con extraer entrypoints a bin/, sacar auth+api-client del core, inyectar la visión/whisper como los demás hooks LLM, y consolidar los 4-5 helpers duplicados, el paquete queda razonable para un prototipo.

### A1 · [🔴 Alta] core viola su propia regla 'determinista, sin LLM': extract.ts llama directamente a APIs de visión y whisper

- **Ficheros:** `packages/core/src/extract.ts`, `packages/core/src/operations.ts`
- **Evidencia:** packages/core/src/extract.ts:44-54 visionConfig() lee LLM_PROVIDER/NAN_API_KEY/OPENROUTER_API_KEY y construye la config del proveedor; :63-84 visionCall() hace POST a {base}/chat/completions con reintentos; :153-174 postWhisper() hace POST a /audio/transcriptions; :179-233 transcribe() orquesta ffmpeg+whisper. CLAUDE.md afirma «@cortex/core es determinista (sin LLM)». El resto del paquete sí respeta la regla vía hooks inyectables: operations.ts:47-59 setClassifier/setReranker, dedup.ts:78-80 setReconciler.
- **Recomendación:** Aplicar el patrón que ya existe: definir en extract.ts hooks inyectables (setVisionCaptioner/setTranscriber o un único setMediaExtractor) y mover visionCall/postWhisper/visionConfig a @cortex/agents (que ya es la capa LLM y ya consume extractFileText desde connect-meeting.ts). extract.ts se queda con docx/pdf/xlsx/drawio, que sí son deterministas. Cero capas nuevas.

### A2 · [🔴 Alta] 6-7 implementaciones de lookup de proyecto con DOS semánticas distintas; la de dedup hace la reconciliación inoperante según capitalización

- **Ficheros:** `packages/core/src/dedup.ts`, `packages/core/src/capture.ts`, `packages/core/src/operations.ts`, `packages/core/src/queries.ts`, `packages/core/src/code.ts`, `packages/core/src/lint.ts`, `packages/core/src/projects.ts`
- **Evidencia:** Por canonical_name: operations.ts:380-386, queries.ts:182-188, code.ts:141-146, lint.ts:21-26. Por name EXACTO: dedup.ts:28-31 (`WHERE type='project' AND name = ${project}`) y capture.ts:31. projects.ts:34-37 añade findProjectByName (name exacto). Consecuencia concreta: saveContext resuelve el proyecto canonicalizado (crea 'Acme Portal' buscable como 'acme portal'), pero saveWithReconciliation→findNearest→findProjectId (dedup.ts:28) exige coincidencia exacta de name; si el caller pasa otra grafía, near=null y SIEMPRE devuelve action:'add' sin dedup, silenciosamente.
- **Recomendación:** Un único módulo repositorio de proyectos (projects.ts ya existe): añadir findProjectIdByAnyName(sql, name) con lookup canónico y borrar las 6 copias. Es el refactor con mejor ratio valor/esfuerzo del paquete.

### A3 · [🔴 Alta] 11 entrypoints ejecutables mezclados con la librería en src/; lint-act.ts ejecuta su CLI al ser importado

- **Ficheros:** `packages/core/package.json`, `packages/core/src/lint-act.ts`, `packages/core/src/resolve-entities.ts`, `apps/cli/src/index.ts`
- **Evidencia:** package.json de core declara 12 scripts tsx sobre src/: seed, ingest, resolve-entities, lint(-run), lint-act, index-code, temporal(-run), connect-github, connect-notion-export, connect-docs, hook:context, link. Todos con main()+process.argv+console.log; seed.ts:160, ingest.ts:91, link.ts:121, connect-*.ts:98/183/71 ejecutan main() incondicionalmente al cargar el módulo. lint-act.ts:15-47 EXPORTA planLintActions y :70-75 ejecuta main() sin guard → importar la función dispara el CLI (hoy no pasa solo porque nadie la importa). Único con guard: resolve-entities.ts:96. Además apps/cli/src/index.ts:22-29 despacha importando estos ficheros POR RUTA cruzando paquetes y reescribiendo process.argv (:55).
- **Recomendación:** Separar mecánicamente: la lógica queda como función exportada en src/ y el wrapper CLI (argv, console, exit) se mueve a packages/core/bin/ o directamente a apps/cli/src/commands/. Como mínimo inmediato: quitar los exports de lint-act.ts o ponerle el guard import.meta que ya usa resolve-entities.ts, y unificar ese patrón.

### A4 · [🟡 Media] auth.ts + email.ts + api-client.ts no pertenecen al dominio de memoria: core mezcla servidor (BD) y cliente (HTTP) del mismo sistema

- **Ficheros:** `packages/core/src/auth.ts`, `packages/core/src/email.ts`, `packages/core/src/api-client.ts`, `packages/core/src/projects.ts`
- **Evidencia:** auth.ts (166 LOC: OTP, tokens, tickets, admins) y email.ts (Brevo) son un bounded context de identidad; los consumen apps/server y apps/web, no el dominio de contexto. api-client.ts es el cliente HTTP del LADO CLI (lee ~/.cortex/credentials, api-client.ts:17-32) y lo usan los conectores (connect-github.ts:4, connect-docs.ts:5, connect-notion-export.ts:5) y hook-context.ts:1 — código que corre en la máquina del desarrollador contra el servidor. Resultado: un conector que solo habla HTTP arrastra @cortex/database y @cortex/embeddings como dependencias, y projects.ts:3 importa isAdmin de auth (dominio ← identidad).
- **Recomendación:** Sin crear una arquitectura nueva: mover auth.ts+email.ts a un packages/auth pequeño (o a apps/server/src/auth/), y api-client.ts+project-config.ts+hook-context+conectores a un packages/client (SDK + comandos). core queda solo con dominio+persistencia. Para el prototipo basta con 2 movimientos de fichero y ajustar imports.

### A5 · [🟡 Media] Duplicación estructural: fusión RRF, INSERT de embeddings, 3 walkers de directorio, 3 normalizadores, interfaz repetida

- **Ficheros:** `packages/core/src/vectors.ts`, `packages/core/src/code.ts`, `packages/core/src/extract.ts`, `packages/core/src/text.ts`, `packages/core/src/resolve-entities.ts`, `packages/core/src/project-config.ts`
- **Evidencia:** (1) RRF: vectors.ts:117-145 y code.ts:186-218 son el mismo algoritmo (K=60, Map acc, cosine override) copiado. (2) INSERT INTO embeddings idéntico en vectors.ts:16-22 y :41-47. (3) Walkers: code.ts:71-101 walkRepo, connect-notion-export.ts:39-48 walkMd, connect-docs.ts:22-32 walk. (4) Normalizadores: text.ts:10-17 canonicalize (regex con diacríticos combinantes literales), resolve-entities.ts:16-22 norm (misma regex ilegible), project-config.ts:34-44 slugify (forma ̀-ͯ escapada). (5) extract.ts declara `interface VisionCfg` dos veces (:56-60 y :146-150). (6) Mensaje '✗ Captura fallida (status)...' triplicado (connect-github.ts:90, connect-notion-export.ts:91, connect-docs.ts:62). (7) Parser de ~/.cortex/credentials duplicado (api-client.ts:17-25 creds vs link.ts:20-28 credsEmail).
- **Recomendación:** Consolidación quirúrgica: rrfFuse() en vectors.ts reutilizado por code.ts; storeEmbedding = storeEmbeddingsBatch con 1 elemento; un walkDir(root, filter) compartido; canonicalize como única normalización base (slugify la usa); borrar la segunda VisionCfg. Una tarde de trabajo, sin cambiar comportamiento.

### A6 · [🟡 Media] Configuración dispersa: 36 lecturas de process.env en 14 ficheros, con el mismo var y defaults distintos

- **Ficheros:** `packages/core/src/auth.ts`, `packages/core/src/dedup.ts`, `packages/core/src/extract.ts`, `packages/core/src/ingest.ts`, `packages/core/src/connect-notion-export.ts`
- **Evidencia:** 36 process.env.* repartidos (auth.ts×7, extract.ts×8, connect-notion-export.ts×4, dedup.ts×3, email.ts×3...). CORTEX_INGEST_CONCURRENCY default '8' en ingest.ts:31 y '4' en connect-notion-export.ts:19. Constantes evaluadas al cargar el módulo (dedup.ts:17-18 UPDATE_THRESHOLD/NOOP_THRESHOLD, extract.ts:36/114-115/144) son sensibles al orden de loadEnv; auth.ts:17-25 parchea el síntoma con getters lazy y lo documenta («Config leída LAZY... robusta ante el orden de loadEnv/imports»). Los conectores llaman loadEnv() ENTRE imports (connect-github.ts:2-4), lo que por hoisting ESM no garantiza el orden que aparenta.
- **Recomendación:** Un config.ts en core (o en @cortex/shared, que ya tiene loadEnv/getEnv) que lea y tipifique todas las CORTEX_* una vez, con defaults en un solo sitio. Los módulos importan config, no process.env. Elimina la clase entera de bugs de orden de carga.

### A7 · [🟡 Media] Side effects en import: sink global de usage y estado mutable de módulo (classifier/reranker/reconciler)

- **Ficheros:** `packages/core/src/usage.ts`, `packages/core/src/vectors.ts`, `packages/core/src/code.ts`
- **Evidencia:** vectors.ts:5 y code.ts:7 hacen `import "./usage.js"; // registra el sink` — usage.ts:168-177 ejecuta setEmbeddingUsageSink al cargarse, con lo que cualquier import de core cablea la escritura en llm_usage (y toca getSql). Los hooks LLM son variables de módulo mutables: operations.ts:40/54, dedup.ts:77. Combinado con el order-of-import de loadEnv, el paquete tiene comportamiento dependiente de qué se importa primero.
- **Recomendación:** Para el prototipo basta con hacer explícito el registro: exportar registerUsageSink() y llamarlo desde los entrypoints (mcp-server, server, web) junto a setClassifier, en vez del import fantasma. Los setters de hooks pueden quedarse (patrón aceptable y ya documentado), pero céntralos en un único wiring.ts.

### A8 · [🟡 Media] Manejo de errores: catch-all silenciosos que convierten bugs en 'no data' y errores de dominio sin tipo

- **Ficheros:** `packages/core/src/extract.ts`, `packages/core/src/dedup.ts`, `packages/core/src/api-client.ts`
- **Evidencia:** extract.ts:292-294 `catch {/* ignore */} return null` alrededor de TODA la extracción: un bug en el parser de xlsx se reporta como 'fichero vacío/no soportado' (connect-docs.ts:50 lo cuenta como skipped). dedup.ts:42-44 findNearest catch→null (un fallo de BD se interpreta como 'no hay duplicado' y se inserta igualmente). api-client.ts:40-43/63-65 traga red y HTTP. operations.ts:102 classifier `.catch(() => null)`. hook-context.ts:57-59 catch global mudo. Los errores de dominio son `throw new Error('mensaje de usuario en español')` (operations.ts:312, auth.ts:52-60, projects.ts:58) sin clases ni códigos → los endpoints no pueden mapear a 404/403/400 salvo por string-matching.
- **Recomendación:** Proporcionado a prototipo: (a) en cada catch-all, loguear con console.warn(contexto, err.message) antes de degradar; (b) 2-3 clases de error (NotFoundError, ForbiddenError, ValidationError) en shared que la capa HTTP mapee a status codes. No hace falta result-types ni framework.

### A9 · [🟡 Media] SQL crudo en 20+ ficheros de core (y hasta en un CLI): no existe capa de acceso a datos, packages/database solo aporta el cliente

- **Ficheros:** `packages/core/src/map.ts`, `packages/core/src/projects.ts`, `packages/core/src/operations.ts`, `packages/core/src/vectors.ts`, `packages/core/src/link.ts`
- **Evidencia:** Ejecutan SQL: operations, queries, vectors, code, dedup, lint, curate, temporal, auth, projects, usage, capture, entities, resolve-entities, seed, link (link.ts:115 SELECT en pleno CLI). Todas las queries castean `as unknown as Row[]` con Row=Record<string,any> (map.ts:4), descartando el tipado ~50 veces. Los agregados se consultan de formas ad-hoc: p.ej. context_entries se filtra por vigencia con la misma cláusula bi-temporal repetida en vectors.ts:88-92, :175-179 y operations.ts:408-410. N+1: saveContext inserta entidades y relaciones en bucle secuencial (operations.ts:144-159); listAccessibleProjects (projects.ts:105-112) ejecuta por CADA proyecto un CTE recursivo + una query de membresía por ancestro.
- **Recomendación:** No hace falta ORM ni repositorios DDD: agrupar el SQL por agregado en 4-5 módulos-repositorio (entries, entities+relations, projects+members, embeddings, auth) dentro de core, y extraer la cláusula de vigencia bi-temporal a un fragmento sql compartido. Los N+1 pueden esperar salvo listAccessibleProjects, que es O(proyectos×ancestros) en cada request de la web.

### A10 · [🟡 Media] Testabilidad desigual: mitad DI, mitad singletons; solo hay tests de integración con BD real

- **Ficheros:** `packages/core/src/dedup.ts`, `packages/core/src/queries.ts`, `tests/integration/core.test.ts`
- **Evidencia:** Con sql/provider por parámetro: entities.ts, vectors.ts, operations.ts helpers, code.ts parcial. Con singleton interno getSql()/getEmbeddingProvider(): queries.ts:10, dedup.ts:29/54, projects.ts:30, auth.ts:54, capture.ts:30, lint.ts:29, curate.ts:20, temporal.ts:19, usage.ts:53. Los tests existentes (tests/integration/core.test.ts, auth.test.ts, permissions.test.ts) requieren Postgres real; dedup/lint/curate/temporal/resolve-entities no tienen unit tests. Los 11 entrypoints (main+argv) son intesteables tal cual. text.ts y project-config.ts, puros, sí son testeables (y project-config tiene test).
- **Recomendación:** Elegir UN patrón y aplicarlo: dado el tamaño, mantener getSql() como default pero aceptar `sql` opcional como primer parámetro (como ya hacen entities/vectors) es el cambio mínimo. Prioridad de tests unitarios baratos: text.ts (clasificador/polaridad), chunkFile/walkRepo de code.ts, planLintActions con LintReport fake.

### A11 · [🟡 Media] God-files y funciones largas: operations.ts (420), extract.ts (301), code.ts (285); saveContext/hybridSearch/main() de notion superan 70-85 líneas

- **Ficheros:** `packages/core/src/operations.ts`, `packages/core/src/extract.ts`, `packages/core/src/code.ts`, `packages/core/src/connect-notion-export.ts`
- **Evidencia:** operations.ts concentra las 5 operaciones MCP + hooks LLM + detección de duplicados/contradicciones + 3 helpers (findProjectId, projectIdsWithAncestors, entriesByType) — saveContext ocupa operations.ts:92-166 con 7 pasos distintos. extract.ts mezcla 5 pipelines (ofimática, drawio, visión, OCR-PDF, audio/vídeo+ffmpeg). code.ts encadena walker+chunker+búsqueda+indexado+render. connect-notion-export.ts main():97-181 con worker anidado hace parseo+extracción+upload+relate. hybridSearch (vectors.ts:64-146) son 82 líneas.
- **Recomendación:** Cortes naturales sin sobre-diseño: operations.ts → save.ts / search.ts / context-pack.ts (la sección '--- helpers ---' ya marca la costura); extract.ts → extract/ con office.ts, drawio.ts, media.ts (media se va a agents según finding 1); en saveContext, extraer enrichEntry() (clasificar/título/resumen/entidades) de persistEntry(). No trocear más allá: los ficheros de <150 LOC del paquete están bien.

### A12 · [🟢 Baja] Código muerto y exports sin consumidor

- **Ficheros:** `packages/core/src/project-config.ts`, `packages/core/src/extract.ts`, `packages/core/src/lint-act.ts`, `packages/core/src/index.ts`, `packages/core/src/usage.ts`
- **Evidencia:** resolveProjectFromCwd (project-config.ts:58-76) exportado en index.ts:11 y sin ningún uso en repo+tests (sustituido por readCortexLink+slug; además duplica su walk-up). SUPPORTED_DOC_EXTS (extract.ts:32) sin consumidores. planLintActions (lint-act.ts:21) sin consumidores y fuera del barrel. isNearDuplicate solo lo usa un test. walkRepo/chunkFile exportados a nivel de módulo sin uso externo. PRICING (usage.ts:26-40) hard-codea precios de modelos que caducarán en silencio (coste estimado=0 para lo no listado).
- **Recomendación:** Borrar resolveProjectFromCwd y SUPPORTED_DOC_EXTS; decidir si planLintActions se cablea al CLI o se elimina el export; recortar el barrel index.ts a lo que consumen apps/agents (hoy re-exporta ~60 símbolos). PRICING: comentario con fecha o mover a config.

### A13 · [🟢 Baja] Smells de vibecoding: comentario desactualizado que contradice al código, datos de un cliente concreto en código genérico, tipado saltado con 'as never'

- **Ficheros:** `packages/core/src/hook-context.ts`, `packages/core/src/connect-notion-export.ts`, `packages/core/src/capture.ts`, `packages/core/src/link.ts`
- **Evidencia:** (1) hook-context.ts:8-9 dice «No usa el MCP... va directo a la BD» pero :41-43 usa la API autenticada (el comentario describe una versión anterior). (2) connect-notion-export.ts:50-51 PROP_KEYS hard-codea propiedades en español de un workspace concreto ('ORDEN RESOLUCIÓN', 'REPORTADO POR USUARIO', 'Revisado') dentro de un conector supuestamente genérico. (3) capture.ts:50-56 castea type/confidence/sourceType con `as never` y el input entero `as never` para esquivar los schemas zod de shared. (4) link.ts:12-17 define una función ENTRE dos bloques de import. (5) Nombres inconsistentes para lo mismo: findProjectId / projectId / findProjectBySlug / resolveLinkedProject / resolveProjectFromCwd.
- **Recomendación:** Corregir el comentario de hook-context (o mejor, borrarlo: el código es claro); mover PROP_KEYS a config/env del conector; en captureBatch validar BatchItem con el schema zod de SaveContextInput en vez de casts; pasada rápida de renombrado al consolidar el lookup de proyectos (finding 2).

### A14 · [🟢 Baja] Acoplamiento inter-paquete correcto en dirección, pero core conoce conceptos de agents y de fuentes concretas

- **Ficheros:** `packages/core/src/usage.ts`, `packages/core/src/curate.ts`, `packages/core/src/temporal.ts`, `apps/cli/src/index.ts`
- **Evidencia:** La dirección gruesa es sana: apps/{web,server,mcp-server} → core ← agents (agents importa 13 símbolos de core; core NUNCA importa agents — verificado). Pero hay fugas semánticas inversas: usage.ts:102-165 modela ai_traces/spans de Mastra (concepto de agents) dentro de core; curate.ts:23 hard-codea created_by='session-backfill' (literal que escribe agents/connect-sessions); temporal.ts:24 hard-codea el estado 'Histórico' de Plane. Además el CLI (apps/cli/src/index.ts:22-29) importa ficheros de core y agents por RUTA física, no por API de paquete.
- **Recomendación:** Aceptable en prototipo; al refactorizar: constantes compartidas en @cortex/shared para 'session-backfill'/'Histórico', y getRecentTraces puede vivir en agents (que es quien escribe ai_traces). El dispatcher del CLI debería invocar funciones exportadas, no rutas de fichero (cae solo al hacer el finding 3).

---

<a id="área-b"></a>

## Área B — packages/agents/src — capa LLM (Mastra + OpenRouter/nan)

**Diagnóstico:** El paquete tiene ~1.550 LOC en 19 ficheros y una arquitectura de fondo sana: core no importa agents; la inyección se hace desde los entrypoints (apps/mcp-server/src/server.ts:35 y apps/web/src/index.ts:47 llaman setClassifier(classifyEntry); apps/server/src/index.ts:25 usa wireReconciler), y la frontera zod v3/v4 se respeta (solo workflows.ts importa zod v4, ningún schema cruza paquetes; de shared solo se consumen los .options de los enums). Los problemas son de organización, no de diseño: connect-sessions.ts (293 LOC) es un god-file con ~7 responsabilidades que además contiene un pipeline entero muerto (ingestSessionFile + alreadyIngested, sin ningún consumidor) y un side-effect a nivel de módulo (wireReconciler() en import). Hay 5 ejecutables puros y 2 híbridos (guard import.meta.url) mezclados con la librería en src/, y apps/cli invoca los ficheros fuente de este paquete por ruta interna en vez de importar funciones. extractJson está copiado 3 veces (más una variante inline). Hay SQL crudo en 4 ficheros de la capa LLM (esquema de tablas filtrado hacia arriba) y lectura de process.env dispersa y congelada al import en 5 ficheros. El manejo de errores es tolerante pero inconsistente, y el fallback de reconcile() a "update" ante fallo del LLM puede reescribir conocimiento existente. Solo session-readers.ts (puro) tiene tests; el resto acopla runAgent/getSql por import directo. El refactor razonable es: partir connect-sessions, borrar el código muerto, mover los mains a un bin/ o al CLI, extraer un util llm-json, y bajar el SQL crudo a core/database — sin crear capas nuevas.

### B1 · [🔴 Alta] connect-sessions.ts es un god-file con un pipeline entero de código muerto

- **Ficheros:** `packages/agents/src/connect-sessions.ts`, `packages/agents/src/hook-capture.ts`
- **Evidencia:** packages/agents/src/connect-sessions.ts (293 LOC) mezcla: scrub de secretos (31-43), limpieza de tags (45-51), parseo del .jsonl de Claude (69-85), windowing (88-101), destilación LLM (110-128), pipeline vía API (147-182), pipeline directo a BD (ingestSessionFile, 194-228), check alreadyIngested (130-137) y main CLI (230-279). ingestSessionFile y alreadyIngested no tienen NINGÚN consumidor en el repo (grep: el hook usa captureSessionViaApi:185, el CLI usa captureCondensedViaApi:271); el comentario de la línea 281 ('no al importar ingestSessionFile desde el hook') está desfasado. Además el bucle distill+dedup está duplicado (150-158 vs 199-207).
- **Recomendación:** Borrar ingestSessionFile, alreadyIngested e IngestResult (~45 LOC muertas que además arrastran la dependencia directa a saveWithReconciliation y getSql). Partir el resto en 3 módulos pequeños: transcript-utils.ts (scrub/clean/condense/windows — puro, testeable), distill.ts (distill + dedup, LLM) y capture-pipeline.ts (captureCondensedViaApi/captureSessionViaApi), dejando en connect-sessions.ts solo el main CLI. Sin capas nuevas, solo separación por responsabilidad.

### B2 · [🟡 Media] Side-effect global a nivel de módulo: wireReconciler() se ejecuta al importar connect-sessions.ts

- **Ficheros:** `packages/agents/src/connect-sessions.ts`, `packages/agents/src/hook-capture.ts`, `packages/agents/src/connect-meeting.ts`
- **Evidencia:** packages/agents/src/connect-sessions.ts:139-140: '// Inyecta el reconciliador LLM en core... wireReconciler();' en el top-level del módulo. Cualquier import del fichero (hook-capture.ts:4, connect-meeting.ts:7) muta el estado global de core (setReconciler) sin que se vea en el código del importador. Contrasta con apps/server/src/index.ts:25, que lo llama explícitamente.
- **Recomendación:** Quitar la llamada top-level y llamar wireReconciler() explícitamente en el main de cada entrypoint (connect-sessions main, hook-capture main, connect-meeting main), igual que hace apps/server. Es un cambio de 4 líneas que elimina la dependencia de orden de imports.

### B3 · [🟡 Media] Ejecutables y librería mezclados en src/, y apps/cli acoplado a rutas de ficheros internos del paquete

- **Ficheros:** `packages/agents/src/connect-sessions.ts`, `packages/agents/src/maintain.ts`, `packages/agents/src/enrich-run.ts`, `packages/agents/src/connect-meeting.ts`, `packages/agents/src/demo-capture.ts`, `packages/agents/src/hook-capture.ts`, `packages/agents/src/maintain-worker.ts`, `apps/cli/src/index.ts`
- **Evidencia:** 5 ejecutables puros (enrich-run.ts, connect-meeting.ts, demo-capture.ts, hook-capture.ts, maintain-worker.ts: main() top-level + process.exit) y 2 híbridos con guard 'import.meta.url === file://argv[1]' (connect-sessions.ts:282, maintain.ts:89) conviven con 12 ficheros de librería. apps/cli/src/index.ts:24-29 lanza por ruta 'packages/agents/src/maintain.ts', 'packages/agents/src/connect-sessions.ts', etc. — un app depende de rutas internas de otro paquete y del guard frágil de argv[1] (el propio CLI lo comenta en su línea 7). package.json del paquete expone 6 scripts tsx sobre src/.
- **Recomendación:** Mover los mains a packages/agents/src/bin/ (o cli/) que solo parseen argv y llamen a funciones de librería exportadas por el barrel; el guard import.meta.url desaparece. apps/cli puede seguir spawneando tsx pero contra bin/, o mejor importar las funciones directamente. Proporcionado: es mover código, no rediseñar.

### B4 · [🟡 Media] extractJson duplicado (3 copias + 1 variante inline) y retries ad-hoc apilados sobre runAgent

- **Ficheros:** `packages/agents/src/classify.ts`, `packages/agents/src/enrich.ts`, `packages/agents/src/connect-sessions.ts`, `packages/agents/src/rerank.ts`, `packages/agents/src/mastra.ts`
- **Evidencia:** Cuatro copias de la extracción de JSON de la respuesta del LLM: classify.ts:39-45 y enrich.ts:52-58 (idénticas, con fences), connect-sessions.ts:104-108 y rerank.ts:27-29 (versión sin fences). Además classify.ts:56 y enrich.ts:63 hacen su propio retry x2 encima del maxRetries:6 por defecto de runAgent (mastra.ts:131) → hasta 12-14 requests HTTP ante un fallo persistente.
- **Recomendación:** Crear un único helper (p.ej. llm-json.ts con extractJson + runAgentJson(role, prompt, opts) que ejecute, extraiga y parsee) y usarlo en los 4 sitios. Decidir la política de retry en un solo nivel: o el retry aplicativo x2 o el maxRetries de Mastra, no ambos.

### B5 · [🟡 Media] Fallback de reconcile() a 'update' ante fallo del LLM puede reescribir conocimiento existente

- **Ficheros:** `packages/agents/src/reconcile.ts`
- **Evidencia:** packages/agents/src/reconcile.ts:21-23: 'catch { return "update"; // ante duda, fusionar }'. Un error de red/timeout en el rol reconciler devuelve 'update', lo que dispara mergeKnowledge (otra llamada LLM) y sobrescribe la entrada existente. Si el merge también degrada (modelo truncado), se corrompe la entrada original de forma silenciosa. Choca con el principio de trazabilidad del CLAUDE.md ('no conviertas inferencias en hechos').
- **Recomendación:** Ante fallo del reconciler, devolver 'noop' (conservador: se pierde una posible fusión, no se toca lo existente) o dejar que core caiga a su dedup determinista. Es un cambio de una línea con impacto directo en integridad de datos.

### B6 · [🟡 Media] SQL crudo y conocimiento del esquema de BD dentro de la capa LLM

- **Ficheros:** `packages/agents/src/enrich-project.ts`, `packages/agents/src/trace-exporter.ts`, `packages/agents/src/maintain.ts`, `packages/agents/src/connect-sessions.ts`
- **Evidencia:** Cuatro ficheros de agents ejecutan SQL directo con getSql(): connect-sessions.ts:132-135 (join context_entries/entities — además en código muerto), enrich-project.ts:31-35 (context_entry_entities), trace-exporter.ts:31-40 (INSERT en ai_traces con 14 columnas), maintain.ts:39-44 y 83 (pg_try_advisory_lock/unlock sobre conexión reservada). La capa que debería ser 'solo prompts y parsing' conoce nombres de tablas y detalles de locking de Postgres.
- **Recomendación:** Mover cada consulta a una función nombrada en core (o database): listEntriesWithoutGraphEnrichment(), insertTraceSpan() (core/usage.ts ya gestiona ai_traces para lectura), y withAdvisoryLock(key, fn) como utility genérica en database. agents queda importando funciones de dominio, no SQL.

### B7 · [🟢 Baja] Configuración por process.env dispersa y congelada en tiempo de import

- **Ficheros:** `packages/agents/src/connect-sessions.ts`, `packages/agents/src/enrich-project.ts`, `packages/agents/src/session-readers.ts`, `packages/agents/src/maintain-worker.ts`, `packages/agents/src/openrouter.ts`
- **Evidencia:** Constantes de módulo leídas al import: connect-sessions.ts:26-28 (CORTEX_SESSIONS_MAX_WINDOWS/WINDOW_CHARS/TURN_CHARS), enrich-project.ts:11 (CORTEX_ENRICH_CONCURRENCY), maintain-worker.ts:13 (CORTEX_MAINTAIN_CRON). Lecturas inline sin el helper getEnv de shared: session-readers.ts:57,85,128 (CORTEX_CODEX_DIR/CORTEX_OPENCODE_DIR/CORTEX_HERMES_DB), enrich-run.ts:18, connect-sessions.ts:245. Solo openrouter.ts usa getEnv/loadEnv de forma consistente. El valor queda fijado antes de que un test o el CLI pueda ajustar el env.
- **Recomendación:** Leer el env dentro de las funciones (o un pequeño config.ts del paquete con funciones, no constantes) y usar getEnv de shared en todos los casos. Barato y mejora la testabilidad sin infraestructura nueva.

### B8 · [🟢 Baja] runMaintenance es orquestación de dominio de core viviendo en agents

- **Ficheros:** `packages/agents/src/maintain.ts`, `packages/agents/src/connect-sessions.ts`, `packages/agents/src/session-readers.ts`
- **Evidencia:** packages/agents/src/maintain.ts:34-86: de los 6 pasos del pipeline, 5 son llamadas puras a core (resolveEntities, applyTemporalInvalidation, autoCurate, reconcileProject, lintProject) y solo enrichProject usa LLM. session-readers.ts (164 LOC) tampoco tiene nada de LLM: es parsing de formatos de ficheros. scrub() (connect-sessions.ts:31-43) es redacción de secretos genérica, relevante para seguridad y sin tests.
- **Recomendación:** Proporcionado a un prototipo: no crear paquetes nuevos. Mover runMaintenance a core aceptando el paso enrich como función inyectada (mismo patrón que setClassifier), extraer scrub a shared con tests unitarios (es código de seguridad), y dejar session-readers donde está pero documentado como 'adaptadores de entrada, no LLM'.

### B9 · [🟢 Baja] Frontera zod v3/v4 respetada pero frágil: cast 'as never' en el punto de cruce

- **Ficheros:** `packages/agents/src/workflows.ts`
- **Evidencia:** Solo workflows.ts:3 importa zod (v4, por Mastra); ningún schema cruza a core, y agents consume de shared únicamente los .options de los enums (classify.ts:19-20, enrich.ts:29-30, connect-sessions.ts:25). Pero en workflows.ts:68 el paso persist hace 'type: inputData.type as never' para colar un string del schema v4 en el ContextEntryType (zod v3) de saveContext, sin validar el enum — si el LLM devuelve un tipo raro que classifyEntry no filtró, entra sin chequeo. Ningún comentario en el fichero explica la frontera (solo está en CLAUDE.md).
- **Recomendación:** Validar inputData.type contra contextEntryType.options antes del cast (igual que hace classify.ts:68) y añadir un comentario de 2 líneas en workflows.ts explicando por qué este fichero usa zod v4 y que sus schemas no deben exportarse. Considerar si workflows.ts + demo-capture.ts merecen seguir existiendo (ver finding de código demo).

### B10 · [🟢 Baja] workflows.ts + demo-capture.ts: el workflow Mastra solo lo consume la demo

- **Ficheros:** `packages/agents/src/workflows.ts`, `packages/agents/src/demo-capture.ts`, `packages/agents/src/index.ts`
- **Evidencia:** El único consumidor real de captureContextWorkflow/runCaptureWorkflow es demo-capture.ts:17 (más la re-exportación en index.ts:8-13, que nadie de apps/ importa — grep confirma que mcp-server y web usan classifyEntry+saveContext directamente, no el workflow). Son ~140 LOC (workflows 106 + demo 34) que duplican el pipeline classify→persist que ya existe en saveContext con setClassifier.
- **Recomendación:** Decisión de producto: si el workflow observable de Mastra es la dirección futura (§20.4 del plan), conservarlo y anotar en docs/decisions.md que es un spike; si no, borrar ambos ficheros y sus exports. No mantener dos pipelines de captura equivalentes indefinidamente.

### B11 · [🟢 Baja] Doble contabilidad de tokens: recordUsage en runAgent + spans en ai_traces

- **Ficheros:** `packages/agents/src/mastra.ts`, `packages/agents/src/trace-exporter.ts`
- **Evidencia:** mastra.ts:140-149 llama recordUsage (tabla de uso, core/usage.ts) tras cada generate(), y a la vez CortexTraceExporter (trace-exporter.ts:31-40) persiste los mismos tokens/modelo/duración por span en ai_traces. Es ADR-0016 partes A y B deliberadas, pero son dos caminos solapados que hay que mantener sincronizados.
- **Recomendación:** Revisar si la parte A (recordUsage manual) sigue aportando algo que no dé la B (spans agregables por SQL); si no, eliminar la llamada de runAgent y derivar los resúmenes de uso de ai_traces. Anotar la decisión en docs/decisions.md.

### B12 · [🟢 Baja] Testabilidad concentrada en lo puro; el resto sin costuras

- **Ficheros:** `packages/agents/src/connect-sessions.ts`, `packages/agents/src/mastra.ts`, `tests/session-readers.test.ts`
- **Evidencia:** Solo session-readers.ts tiene tests (tests/session-readers.test.ts) — precisamente el único módulo sin LLM ni BD. classify/enrich/rerank/synthesize/reconcile importan runAgent directamente (sin parámetro inyectable); el singleton mastra (mastra.ts:74) se memoiza y no se puede resetear; enrichProject y trace-exporter llaman getSql() inline. Las funciones puras testeables (scrub, clean, windows, condenseSession, extractJson, validación de enums) están atrapadas como privadas dentro del god-file connect-sessions.ts.
- **Recomendación:** No introducir DI generalizada (sobreingeniería para un prototipo). Basta con: (a) extraer las funciones puras a módulos propios y testearlas (scrub y la validación de enums son las de más valor), y (b) exportar un reset del singleton de mastra o aceptar un runner opcional en los 2-3 sitios donde un test de integración lo necesite.

### B13 · [🟢 Baja] Smells menores de vibecoding: nombres inconsistentes, logs heterogéneos, loadEnv entre imports

- **Ficheros:** `packages/agents/src/enrich.ts`, `packages/agents/src/openrouter.ts`, `packages/agents/src/connect-meeting.ts`, `packages/agents/src/rerank.ts`
- **Evidencia:** (a) Familia 'enrich' confusa: enrich.ts extrae grafo, enrich-project.ts es el pase batch, enrich-run.ts el CLI. (b) Prefijos de log distintos por fichero: '[agents]' (classify.ts:87), '  ✗' (connect-sessions.ts:125), '[maintain]' (maintain.ts:42), '[worker]' (maintain-worker.ts:22), '[trace-exporter]' (trace-exporter.ts:42), '[cortex hook]' (hook-capture.ts:40). (c) connect-meeting.ts:3-5 ejecuta loadEnv() en medio del bloque de imports, único fichero que lo necesita explícito. (d) walk() de connect-meeting.ts:21-26 duplica el walkJsonl de session-readers.ts:45-54. (e) Sufijos inconsistentes: rerankLLM vs classifyEntry vs synthesizeContextAnswer.
- **Recomendación:** Barrido cosmético en el mismo PR del refactor: renombrar enrich.ts→extract-graph.ts y openrouter.ts→llm-config.ts, unificar prefijo de log (p.ej. '[cortex:agents]' o un helper log()), quitar el loadEnv inline moviéndolo al main, y unificar el walker recursivo. Nada de esto justifica un PR propio.

---

<a id="área-c"></a>

## Área C — packages/shared/src, packages/database/src + migrations, packages/embeddings/src

**Diagnóstico:** Es la zona más sana del repo: paquetes pequeños (909 LOC totales en ámbito), sin god-files (el mayor es domain.ts con 204 LOC cohesivas), con dirección de dependencias correcta (shared ← database, shared ← embeddings; embeddings es hoja y usa inversión de dependencia vía usage-sink para no acoplar a database). Los problemas reales son de consistencia, no de estructura: (1) los valores de enum del dominio están triplicados entre zod y los CHECK de SQL y ya han derivado una vez (parche 0007); (2) el "modelo de dominio" zod está desincronizado del esquema real (a entity le faltan slug/visibility/owner_email/parent_id) y sus schemas de fila nunca se ejecutan (.parse) — solo se usan como tipos, con mapeo manual snake_case→camelCase en core/map.ts; (3) la columna vector sin dimensión fija impide para siempre crear índices pgvector (búsqueda secuencial asumida para demo); (4) VoyageEmbeddingProvider duplica el cliente HTTP OpenAI-compatible pero sin reintentos; (5) estado global mutable no reseteable (singletons de provider, sink, flag de env) que penaliza testabilidad; (6) migrate.ts es un runner correcto (transaccional por migración, registro idempotente) pero es un script ejecutable dentro de src/ de una librería y no exporta nada testeable. El refactor proporcionado aquí es pequeño: unificar la política de enums, sincronizar o simplificar el modelo zod, fusionar los dos providers remotos y añadir funciones de reset — no hace falta DDD ni capas nuevas.

### C1 · [🔴 Alta] Enums de dominio triplicados (zod + CHECK SQL) con drift ya materializado

- **Ficheros:** `packages/shared/src/domain.ts`, `packages/database/migrations/0001_init.sql`, `packages/database/migrations/0007_sources_sourcetype.sql`
- **Evidencia:** Los mismos literales están en packages/shared/src/domain.ts (contextEntryType:16-31, contextEntryStatus:35-42, sourceType:88-101, entityType:57-69, relationType:73-84) y en CHECKs de packages/database/migrations/0001_init.sql (líneas 20-22, 37-39, 63-72, 110-114). El drift ya ocurrió: zod añadió 'agent_session' y 'document' (domain.ts:99-100) y hubo que parchear con 0007_sources_sourcetype.sql:5 ('ALTER TABLE sources DROP CONSTRAINT... El CHECK hardcodeado derivaba cada vez que añadíamos un tipo'). Pero los CHECKs gemelos de context_entries.type/status/confidence/validity y relations.relation_type siguen vivos con idéntico riesgo. Inconsistencia añadida: context_entries.source_type es text sin CHECK (0001:73) mientras sources.source_type sí lo tenía.
- **Recomendación:** Decidir UNA política y aplicarla uniforme: para un prototipo, validar solo en la app con zod y eliminar los CHECKs de enums que evolucionan (nueva migración que repita lo de 0007 para context_entries y relations), dejando CHECK solo en enums estables (status, confidence). Registrar la decisión en docs/decisions.md. No montar generación de SQL desde zod: sobreingeniería aquí.

### C2 · [🟡 Media] Modelo de dominio zod desincronizado del esquema real y nunca ejecutado como validador

- **Ficheros:** `packages/shared/src/domain.ts`, `packages/core/src/map.ts`, `packages/database/migrations/0008_project_slug.sql`, `packages/database/migrations/0010_project_visibility.sql`, `packages/database/migrations/0011_project_parent.sql`
- **Evidencia:** El schema entity (packages/shared/src/domain.ts:133-142) no refleja las columnas añadidas después: slug (0008_project_slug.sql:5), visibility/owner_email (0010_project_visibility.sql:4-5), parent_id (0011_project_parent.sql:5). No existen tipos de dominio para users/otp_codes/auth_tokens (0009), project_members (0010), ui_tickets (0012), code_chunks (0003), llm_usage (0005) ni ai_traces (0006). Además, los 4 schemas de fila (contextEntry, entity, relation, source) no se usan con .parse en ninguna parte: grep del repo muestra que solo saveContextInput y searchContextInput se parsean (packages/core/src/operations.ts:96,240); el mapeo fila→dominio es manual y sin validación en packages/core/src/map.ts:6-53 (Row = Record<string,any>).
- **Recomendación:** Dos opciones proporcionadas: (a) barata — degradar contextEntry/entity/relation/source a interfaces TS puras (borrar el peso zod runtime que nadie ejecuta) y sincronizar Entity con slug/visibility/parent_id; o (b) si se quiere garantía real, validar en el borde: rowToContextEntry(row) = contextEntry.parse({...}). En cualquier caso mantener los DTOs de entrada como zod (esos sí se usan). No crear schemas para tablas de infraestructura (auth, traces): tiparlas localmente donde se consumen.

### C3 · [🟡 Media] Columnas vector sin dimensión fija: imposible indexar con pgvector (búsqueda vectorial O(n) estructural)

- **Ficheros:** `packages/database/migrations/0001_init.sql`, `packages/database/migrations/0003_code.sql`
- **Evidencia:** embeddings.vector se declara 'vector NOT NULL' sin dimensión (0001_init.sql:132), decisión explícita en el comentario de las líneas 122-125 ('Dimensión variable según el proveedor... Para la demo hacemos búsqueda exacta (sin índice ivfflat/hnsw)'). Igual en code_chunks.embedding (0003_code.sql:18). pgvector exige dimensión declarada para crear índices ivfflat/hnsw, así que no es solo 'aún no hay índice': con este esquema no puede haberlo. La dim se guarda como columna aparte (0001:131) y el UNIQUE por (entry, model, version, chunk) está bien pensado para reindexado.
- **Recomendación:** Aceptable para la demo, pero es de las pocas decisiones de este ámbito que bloquea el escalado y encarece migrar después. Documentar el límite como ADR y, al fijar proveedor serio, migrar a vector(dim) con índice HNSW (vector_cosine_ops) — con dimensión por-modelo o tabla activa única. No hacerlo ya, pero no dejar que se acumulen datos reales sin decidirlo.

### C4 · [🟡 Media] VoyageEmbeddingProvider duplica el cliente OpenAI-compatible pero sin reintentos

- **Ficheros:** `packages/embeddings/src/remote.ts`, `packages/embeddings/src/index.ts`
- **Evidencia:** packages/embeddings/src/remote.ts: VoyageEmbeddingProvider.embed (líneas 80-98) repite estructura, headers, parseo de respuesta ({data[].embedding, usage}), sort por index y reportEmbeddingUsage de OpenAICompatibleEmbeddingProvider.embed (líneas 46-69), pero llama a fetch directo (línea 81) sin el postWithRetry con backoff en 429/5xx (líneas 5-18) que sí protege al otro provider. La API de Voyage (/v1/embeddings, mismo shape) es OpenAI-compatible en la práctica.
- **Recomendación:** Eliminar VoyageEmbeddingProvider y resolver 'voyage' en la fábrica como OpenAICompatibleEmbeddingProvider({baseURL:'https://api.voyageai.com/v1', model:'voyage-3', dim:1024}). Si se prefiere conservar la clase, que al menos use postWithRetry. Reduce remote.ts ~30 líneas y unifica el comportamiento ante rate-limit.

### C5 · [🟡 Media] migrate.ts: entrypoint ejecutable dentro de src/ de librería, sin API exportada ni lock de concurrencia

- **Ficheros:** `packages/database/src/migrate.ts`, `packages/database/src/index.ts`
- **Evidencia:** packages/database/src/migrate.ts se autoejecuta al importarse (migrate().catch(...).finally(closeSql), líneas 49-54), escribe a stdout (línea 33) y fija process.exitCode — es un script CLI conviviendo con client.ts en src/, aunque index.ts no lo exporta (bien). Lo esencial del runner es correcto: transaccional por migración (sql.begin envuelve DDL + INSERT en schema_migrations, líneas 34-37) e idempotente entre ejecuciones vía registro (líneas 21-31). Carece de pg_advisory_lock (dos procesos simultáneos compiten; el PK de schema_migrations aborta la segunda transacción, mitigación accidental no diseñada) y de checksums (editar un .sql ya aplicado pasa desapercibido).
- **Recomendación:** Refactor mínimo: exportar `async function migrate(sql, migrationsDir)` desde la librería (testeable) y dejar un entrypoint fino (bin/ o scripts/) con el I/O y el exitCode. Añadir `SELECT pg_advisory_lock(k)` al inicio (2-3 líneas). Los checksums son opcionales en prototipo. No adoptar node-pg-migrate/drizzle-kit todavía: el runner de 54 líneas es adecuado al tamaño del proyecto. Patrón aplicable al resto del repo, que tiene muchos pares fichero-lib/fichero-run (lint.ts/lint-run.ts, etc.).

### C6 · [🟡 Media] Estado global mutable sin reset e inyección inconsistente del provider de embeddings (testabilidad)

- **Ficheros:** `packages/embeddings/src/index.ts`, `packages/embeddings/src/usage-sink.ts`, `packages/shared/src/env.ts`, `packages/database/src/client.ts`
- **Evidencia:** Singletons de módulo: `cached` en packages/embeddings/src/index.ts:11 SIN función de reset (contraste: closeSql sí resetea `client` en packages/database/src/client.ts:23-28); `sink` en packages/embeddings/src/usage-sink.ts:14; flag `loaded` en packages/shared/src/env.ts:10. Consecuencia: un test no puede cambiar EMBEDDINGS_PROVIDER ni el .env tras la primera lectura. Además la inyección es inconsistente en los consumidores: packages/core/src/code.ts:4 y vectors.ts:2 aceptan EmbeddingProvider por parámetro, pero capture.ts:2, dedup.ts:2, ingest.ts:4 y operations.ts:2 llaman getEmbeddingProvider() directamente.
- **Recomendación:** Proporcionado al prototipo, sin contenedor DI: (1) exportar resetEmbeddingProvider() (3 líneas) junto a getEmbeddingProvider; (2) unificar el patrón en core: parámetro opcional `provider: EmbeddingProvider = getEmbeddingProvider()` en las funciones que embeben; (3) idem un resetEnv() para el flag de env.ts si los tests lo necesitan.

### C7 · [🟡 Media] shared mezcla dominio con carga de .env, y loadEnv es un efecto de filesystem escondido en cada lectura de config

- **Ficheros:** `packages/shared/src/env.ts`, `packages/shared/src/index.ts`, `packages/core/src/connect-docs.ts`, `packages/agents/src/connect-meeting.ts`
- **Evidencia:** packages/shared agrupa domain.ts (modelo puro) y env.ts (I/O de filesystem: existsSync + process.loadEnvFile, líneas 15-18) bajo el mismo barrel (index.ts:1-2). loadEnv resuelve la ruta '../../../.env' desde import.meta.dirname (env.ts:15), lo que rompe si el paquete se compila a dist/ o se reubica. Como requireEnv/getEnv llaman loadEnv() internamente (env.ts:23,33), cualquier lectura de config puede tocar disco. El docstring (líneas 6-8) dice que 'los entrypoints deben llamarla al arrancar', pero módulos de librería la ejecutan a nivel de módulo: packages/core/src/connect-docs.ts:4, connect-github.ts:3, connect-notion-export.ts:4, link.ts:5 y packages/agents/src/connect-meeting.ts:4 — import = efecto lateral.
- **Recomendación:** Mantener env.ts en shared (crear un paquete config sería sobreingeniería) pero: (a) quitar la llamada implícita a loadEnv de requireEnv/getEnv y llamarla explícitamente solo en entrypoints (apps/*, scripts, migrate); (b) eliminar los loadEnv() a nivel de módulo en ficheros de librería; (c) opcionalmente buscar el .env subiendo desde process.cwd() en vez de import.meta.dirname. Alinea el código con su propia documentación.

### C8 · [🟢 Baja] Fábrica de embeddings con config hardcodeada asimétrica y vendor interno 'nan' cableado

- **Ficheros:** `packages/embeddings/src/index.ts`, `packages/embeddings/src/remote.ts`, `packages/embeddings/src/provider.ts`
- **Evidencia:** packages/embeddings/src/index.ts:22-28: el caso 'openai' fija text-embedding-3-small/1536 sin override por env, mientras 'nan' (líneas 30-37) sí parametriza NAN_BASE_URL/NAN_EMBEDDING_MODEL/NAN_EMBEDDING_DIM. 'nan' es un vendor interno (nan.builders) cableado como case de un paquete genérico, con sus límites de rate citados en un comentario de remote.ts:4 ('nan: 60 rpm, 3 en paralelo'). CLAUDE.md y provider.ts:3 documentan 'local | openai | voyage' sin mencionar nan (doc desalineada).
- **Recomendación:** Parametrizar también openai (OPENAI_EMBEDDING_MODEL/_DIM con los defaults actuales) y considerar que 'nan' sea solo una configuración del caso openai-compatible (BASE_URL+KEY genéricos), eliminando el case y el nombre del vendor del código. Actualizar la lista de providers en CLAUDE.md/provider.ts.

### C9 · [🟢 Baja] Integridad laxa en relations y en el modelo de miembros/dueños

- **Ficheros:** `packages/database/migrations/0001_init.sql`, `packages/database/migrations/0010_project_visibility.sql`, `packages/database/migrations/0011_project_parent.sql`
- **Evidencia:** relations (0001_init.sql:104-117) es polimórfica sin FK en source_id/target_id (asumido en comentario, líneas 101-102) y sin UNIQUE → aristas duplicadas ilimitadas; sin índice por relation_type. entities.owner_email (0010:5) y project_members.email (0010:11) son texto libre sin FK a users(email) (users existe desde 0009). visibility es text sin CHECK (0010:4). entities.parent_id (0011:5) sin protección contra ciclos.
- **Recomendación:** Para prototipo basta con lo barato: UNIQUE (source_id, target_id, relation_type) en relations (evita duplicados en re-ingestas) y CHECK (visibility IN ('public','private')). Las FKs por email y la anti-ciclicidad pueden esperar a que auth se estabilice; dejar constancia en decisions.md.

### C10 · [🟢 Baja] FTS hardcodeado a 'spanish' para el contenido de contexto

- **Ficheros:** `packages/database/migrations/0002_fts.sql`, `packages/database/migrations/0003_code.sql`
- **Evidencia:** 0002_fts.sql:7 genera content_tsv con to_tsvector('spanish', title || content). Las entradas con contenido técnico/inglés (PRs, código, convenciones en inglés según CLAUDE.md 'código y nombres en inglés') se stemean con reglas españolas, degradando el recall léxico del híbrido. Contraste deliberado: code_chunks usa 'simple' (0003:15).
- **Recomendación:** Ninguna acción de código urgente; documentar la limitación. Si molesta en la práctica, migrar a 'simple' (sin stemming, más neutral) es un ALTER de una columna generada; la detección de idioma por fila sería sobreingeniería.

### C11 · [🟢 Baja] Smells menores de vibecoding: estilo de migraciones inconsistente, comentario desalineado en client.ts, wrapper vacío

- **Ficheros:** `packages/database/migrations/0008_project_slug.sql`, `packages/database/src/client.ts`, `packages/database/src/env.ts`
- **Evidencia:** (1) Migraciones 0001-0007 sin IF NOT EXISTS; 0008-0012 con IF NOT EXISTS/IF EXISTS defensivos (0008:5,13; 0009:4,12,24; 0010:4,8; 0011:5-6; 0012:4) que son redundantes con el registro schema_migrations — huella de ejecuciones manuales durante el vibecoding. (2) packages/database/src/client.ts:15: el comentario dice que el transform maneja pgvector pero solo configura undefined→null. (3) packages/database/src/env.ts es un wrapper de 1 línea sobre requireEnv. (4) domain.ts en cambio está limpio: comentarios útiles (referencias §14, advertencias de hipótesis), nombres consistentes.
- **Recomendación:** Homogeneizar el estilo de las migraciones futuras (sin IF NOT EXISTS, confiar en el registry), corregir el comentario de client.ts y fusionar database/src/env.ts dentro de client.ts. Cosmético; hacerlo de paso en el refactor, no como tarea propia.

---

<a id="área-d"></a>

## Área D — apps/web/src — UI de demo (Hono SSR, sin build de frontend)

**Diagnóstico:** La UI web es un único god-file (index.ts, 716 LOC, el mayor del repo) que concentra entrypoint, bootstrap del LLM, servidor HTTP, autenticación por cookie, autorización por proyecto, 16 rutas con acceso a datos y TODO el render HTML como template literals inline, más ~50 líneas de JavaScript de cliente embebido para el grafo (vis-network vía CDN unpkg). views.ts es un cajón de sastre pequeño pero coherente: escape HTML manual (esc), markdown-lite, logo SVG inline, mapas de color y un layout() que embebe ~105 líneas de CSS del design system en un string. No se usa JSX de Hono ni el tagged template `html` de hono/html: es concatenación de strings con escapado manual, y de hecho hay un XSS reflejado real en /graph (JSON.stringify interpolado dentro de un tag script, línea 664, con nombre de proyecto controlable por query). Hay duplicación notable: el guard de autorización se repite literalmente en 10 handlers, existe un helper local accessibleProjects() con N+1 secuencial que duplica al listAccessibleProjects() que core ya exporta (y que el mismo fichero usa en /projects), el select de proyectos se construye 4 veces, y el bootstrap setClassifier/setReranker está copiado de apps/mcp-server. El manejo de errores es débil: dos catch{} vacíos que convierten cualquier fallo de BD en "Proyecto no encontrado", sin app.onError global, y casts `as never` sobre inputs de formulario. Testabilidad casi nula: `app` no se exporta y serve() se ejecuta en import-time, así que no se puede usar app.request() en tests. El refactor proporcionado es intra-Hono: separar app.ts (exporta app) de index.ts (serve), rutas por recurso en routes/, middleware de auth/autorización, migrar a hono/html para autoescape, y extraer CSS/JS a estáticos con serveStatic. NO compensa aún un mini-framework front: la UI es formularios + navegación GET; htmx solo tendría sentido si se quiere refresco parcial (trazas de /usage, validación de entradas sin recarga), y Preact+Vite solo si la exploración del grafo evoluciona a app interactiva con estado de cliente real. Inventario de rutas HTTP: GET /auth/cli (L89), GET /logout (L102), middleware auth "*" (L108), GET /projects (L117), POST /projects/:slug/members (L158), POST /projects/:slug/members/remove (L166), GET / dashboard (L175), GET /search (L260), GET /entry/:id (L288), POST /entry/:id/validate (L347), POST /save (L361), GET /ask (L389), GET /pack (L433), GET /code (L476), GET /lint (L514), GET /usage (L555), GET /api/graph JSON (L618), GET /graph (L626).

### D1 · [🔴 Alta] XSS reflejado en GET /graph: JSON.stringify interpolado dentro de <script>

- **Ficheros:** `apps/web/src/index.ts`
- **Evidencia:** index.ts L664: `const project = ${JSON.stringify(project)};` dentro del <script> inline del grafo. `project` viene de c.req.query("project") (L628) y guardProject (L77-81) devuelve true cuando el proyecto NO existe (`return !p ? true : ...`), así que un valor arbitrario llega al render. JSON.stringify escapa comillas pero NO la secuencia `</script>`: una URL /graph?project=</script><script>...</script> cierra el script y ejecuta HTML/JS inyectado. Requiere sesión (gate L108-114), pero es la única interpolación sin esc() de todo el fichero y es explotable.
- **Recomendación:** Arreglo de una línea ya: `JSON.stringify(project).replaceAll("<", "\\u003c")` (patrón estándar de serialización segura en <script>), o pasar el valor por atributo data-project escapado con esc() y leerlo con dataset. Al refactorizar, mover ese JS a fichero estático que lea los parámetros de location.search (la variable `params` de L663 ya existe y está sin usar).

### D2 · [🔴 Alta] index.ts es un god-file con 6 responsabilidades: entrypoint, bootstrap, auth, autorización, 16 rutas+datos y render

- **Ficheros:** `apps/web/src/index.ts`
- **Evidencia:** 716 LOC en un fichero: bootstrap LLM L45-49, páginas login/denied L54-84, handshake CLI L89-101, middleware sesión L108-114, helpers autorización L69-81, 16 handlers (L117-703) cada uno mezclando llamada a @cortex/core + construcción de HTML en template literal + estilos inline, JS de cliente L651-701, y arranque servidor + señales + process.exit L705-716. Handlers de 58-83 líneas (GET / L175-257, GET /graph L626-703, GET /usage L555-615).
- **Recomendación:** Split proporcionado sin cambiar de stack: (1) app.ts que crea y EXPORTA la app Hono; (2) index.ts reducido a entrypoint (loadEnv, wireLlm, serve, señales); (3) middleware/auth.ts con el gate de sesión y un requireProjectAccess; (4) routes/ por recurso (projects.ts, entries.ts, search.ts, ask.ts, pack.ts, code.ts, lint.ts, usage.ts, graph.ts) montados con app.route(); (5) views/ con layout + componentes por página. Son ~10 ficheros de 40-90 líneas, cero abstracción nueva. No introducir controladores/servicios estilo MVC clásico: los handlers de Hono ya son el controlador y @cortex/core ya es la capa de dominio.

### D3 · [🟡 Media] Escapado HTML manual en ~90 interpolaciones: un olvido = XSS (ya ocurrió una vez)

- **Ficheros:** `apps/web/src/index.ts`, `apps/web/src/views.ts`
- **Evidencia:** Todo el render usa template literals crudos con esc() manual (views.ts L4-11; uso masivo en index.ts). No se usa hono/html (tagged template con autoescape) ni hono/jsx, que vienen incluidos en la dependencia hono ^4 ya presente (package.json L17). El finding del XSS en L664 demuestra el coste del enfoque: basta olvidar un esc().
- **Recomendación:** Migrar a `html` de hono/html (autoescape por defecto, `raw()` explícito para HTML confiable). Es mecánico, no añade dependencias ni build, y elimina esc() de casi todos los call-sites. Hacerlo a la vez que el split de rutas para no tocar dos veces cada handler. JSX de Hono sería la alternativa si se prefiere sintaxis de componentes, pero exige tocar tsconfig; hono/html es el cambio mínimo.

### D4 · [🟡 Media] Guard de autorización copiado 10 veces + doble mecanismo para 'proyectos accesibles'

- **Ficheros:** `apps/web/src/index.ts`
- **Evidencia:** El patrón `if (!(await guardProject(c.get("user")?.email ?? null, project))) return c.html(deniedPage(...), 403)` se repite en L181, L263, L292, L353, L392, L435, L480, L517, L620 y L629. Además, el helper local accessibleProjects (L69-74) hace listProjects + canAccessProject en bucle secuencial (N+1 de queries por proyecto) y devuelve un shape distinto al de listAccessibleProjects de @cortex/core, que el mismo fichero usa en L119 para lo mismo: dos mecanismos y dos shapes para 'proyectos visibles'. accessibleProjects se llama en 5 handlers (L182, L393, L478, L515, L627).
- **Recomendación:** Unificar en @cortex/core: que listAccessibleProjects devuelva el shape completo que la UI necesita (o exponer una única función con entryCount) y borrar el helper local con su N+1. El guard: o middleware parametrizado, o helper `const denied = await requireProject(c, project); if (denied) return denied;` — una línea por handler y un solo sitio donde vive la política. También unifica el `c.get("user")?.email ?? null` repetido ~10 veces.

### D5 · [🟡 Media] Bootstrap del LLM duplicado verbatim con apps/mcp-server

- **Ficheros:** `apps/web/src/index.ts`, `apps/mcp-server/src/server.ts`
- **Evidencia:** index.ts L45-49 (`loadEnv(); if (isLlmEnabled()) { setClassifier(classifyEntry); if (process.env.CORTEX_RERANK !== "off") setReranker(rerankLLM); }`) es idéntico a apps/mcp-server/src/server.ts L35-36. Cada entrypoint nuevo debe recordar el ritual completo (incluida la lectura dispersa de process.env.CORTEX_RERANK) o los consumidores divergen en comportamiento.
- **Recomendación:** Extraer un `wireLlm()` (o `installAgents()`) en @cortex/agents que encapsule isLlmEnabled + setClassifier + setReranker + la lectura de CORTEX_RERANK. Los entrypoints quedan en `loadEnv(); wireLlm();`. Coste mínimo, elimina la deriva entre consumidores.

### D6 · [🟡 Media] App no testeable: `app` no exportada y serve() en import-time

- **Ficheros:** `apps/web/src/index.ts`
- **Evidencia:** index.ts no exporta nada; `const app = new Hono(...)` (L50) es módulo-privado y `serve({ fetch: app.fetch, port })` se ejecuta al importar (L705-708), con process.exit(0) en shutdown (L713). Hono permite testear handlers sin red con `await app.request("/")`, pero aquí importar el módulo levanta el servidor y toca la BD. Cero tests posibles hoy sobre las 16 rutas (incluidos los guards de autorización, que son justo lo que se endureció en el último PR).
- **Recomendación:** Al hacer el split: app.ts con `export function createApp()` (o `export const app`) sin efectos, index.ts como único sitio con serve/señales/process.exit. Con eso un test de integración de los guards (403 en proyecto privado, 401 sin cookie) son ~15 líneas con app.request() contra la BD de test que ya existe en el repo.

### D7 · [🟡 Media] Manejo de errores: catch{} vacíos que enmascaran fallos de BD, sin onError global, inputs casteados con `as never`

- **Ficheros:** `apps/web/src/index.ts`
- **Evidencia:** L440-444 (/pack) y L524-537 (/lint): `try { ... } catch { return 'Proyecto no encontrado' }` — cualquier excepción (BD caída, bug en core) se presenta como 404 'Proyecto no encontrado'. No hay app.onError ni app.notFound: el resto de handlers (p.ej. POST /save L361-386, que llama a saveContext con datos de formulario) revientan al 500 por defecto de Hono. Los inputs de formulario/query se fuerzan con `(type as never)` en L185 y L367, saltándose el tipado hacia core.
- **Recomendación:** Proporcionado a prototipo: (1) app.onError que loguee y devuelva una página de error genérica con layout(); (2) que core distinga 'no encontrado' (retornar null o error tipado ProjectNotFound) de errores reales, y los catch de /pack y /lint capturen solo eso; (3) sustituir los `as never` por un parse con el enum zod contextEntryType que ya está importado (L7) — `contextEntryType.safeParse(typeRaw)`. 

### D8 · [🟢 Baja] CSS (~105 líneas), JS de cliente (~50 líneas) y logo SVG embebidos en strings; dependencias de CDN externas

- **Ficheros:** `apps/web/src/views.ts`, `apps/web/src/index.ts`
- **Evidencia:** views.ts L107-211: hoja de estilos completa del design system dentro del template literal de layout(), reenviada en cada respuesta y sin cachear. views.ts L105-106: Google Fonts por CDN. index.ts L650: `<script src="https://unpkg.com/vis-network@9.1.9/...">` + L651-701 script inline con la lógica del grafo. La demo no funciona sin internet y el JS embebido no tiene tipos, lint ni highlighting.
- **Recomendación:** Crear apps/web/public/ con styles.css y graph.js servidos con serveStatic de @hono/node-server (ya es dependencia); el layout referencia <link>/<script>. Vendorizar vis-network.min.js en public/ (o aceptar el CDN conscientemente y anotarlo) si la demo debe funcionar offline. El logo SVG puede quedarse como constante TS o pasar a public/ — indiferente. NO hace falta bundler: son estáticos planos.

### D9 · [🟢 Baja] Duplicaciones menores de render dentro de index.ts

- **Ficheros:** `apps/web/src/index.ts`
- **Evidencia:** El <select> de proyectos se construye 4 veces con variaciones triviales (L412-415 /ask, L481-483 /code, L518-520 /lint con entryCount, L631-633 /graph con entryCount). La página 'No encontrado/Entrada no encontrada' se repite 3 veces (L290, L352, L443). Estilos de tabla como strings th/td/tdr (L560-562). Cada handler inventa sus propios mini-helpers de render (sec L446, card L526, stat L563, table L575, spanRow L578) en vez de compartirlos.
- **Recomendación:** Al mover vistas a views/: componentes projectSelect(projects, selected, {withCount}), notFoundPage(), y clases CSS para las tablas de /usage. Es limpieza oportunista durante el split, no un refactor aparte.

### D10 · [🟢 Baja] Código legacy/muerto: compat ?token= en /auth/cli y variable sin usar en el JS del grafo

- **Ficheros:** `apps/web/src/index.ts`
- **Evidencia:** index.ts L88 ('Se mantiene ?token= como compat, pero ticket es lo preferido') y L91+L95-97: la rama legacyToken mete el token de CLI en la URL, justo el vector que el mecanismo de tickets (un solo uso) vino a eliminar según el propio comentario L86-87. index.ts L663: `const params = new URLSearchParams(location.search);` nunca se usa en el script del grafo.
- **Recomendación:** Eliminar la rama ?token= (el CLI del propio repo ya emite tickets; no hay clientes externos que romper en un prototipo) y borrar la variable muerta. Si se conserva la compat, dejar constancia en docs/decisions.md de por qué y con qué fecha de caducidad.

### D11 · [🟢 Baja] Cookie de sesión sin flag secure (nota para despliegue, no para la demo local)

- **Ficheros:** `apps/web/src/index.ts`
- **Evidencia:** index.ts L99: setCookie(c, "cortex_session", session, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: WEB_COOKIE_TTL }) — sin `secure: true`. Correcto para http://localhost, pero si esta UI se expone alguna vez por HTTP plano el token de sesión (que es el token de CLI, L94-96) viaja en claro.
- **Recomendación:** Añadir `secure: process.env.NODE_ENV === "production"` (o un flag WEB_HTTPS) cuando se piense en desplegar; hoy basta con dejarlo anotado. Relacionado: centralizar las 2 lecturas de process.env del fichero (CORTEX_RERANK L48, WEB_PORT L705) en el config/loadEnv de @cortex/shared cuando se toque esa capa.

### D12 · [🟢 Baja] ¿Cuándo compensaría un mini-framework front? Todavía no; umbral definido

- **Ficheros:** `apps/web/src/index.ts`
- **Evidencia:** Toda la interacción actual es formularios GET/POST con recarga completa (búsqueda L238-243, captura L211-226, validación L298-302) salvo una isla: el grafo (fetch a /api/graph + vis-network, L651-701). No hay estado de cliente, ni websockets, ni actualizaciones parciales. Hono SSR con estáticos cubre esto de sobra.
- **Recomendación:** Mantener SSR. Señales de que tocaría subir de nivel, en orden: (1) htmx (o fetch+innerHTML a pelo) cuando se quiera refresco parcial — p.ej. validar/rechazar entradas sin recarga, auto-refresh de trazas en /usage, búsqueda con resultados en vivo; ya existe /api/graph como precedente de endpoint JSON, bastaría añadir endpoints parciales. (2) Preact+Vite (o similar) SOLO si el grafo evoluciona a explorador interactivo con estado (filtros en vivo, panel de detalle, edición) o si la UI deja de ser demo y pasa a producto con varias vistas ricas. No adoptar nada de esto de forma preventiva: cada nivel añade build y despliegue que el prototipo no necesita.

---

<a id="área-e"></a>

## Área E — apps/mcp-server/src y apps/server/src (entrypoints MCP y API HTTP)

**Diagnóstico:** apps/mcp-server y apps/server NO son duplicados: el primero expone las 8 tools MCP para agentes IA (stdio local sin auth y HTTP Streamable con Bearer), el segundo es la API JSON REST que consumen apps/cli (login OTP), los hooks y los conectores vía packages/core/src/api-client.ts (endpoints /auth/*, /capture, /capture/batch, /context-pack, /relate, /projects, /install.sh). apps/web tampoco duplica rutas de apps/server (SSR con cookie vs API con Bearer); los tres procesos hablan con la misma BD a través de @cortex/core, sin proxy entre ellos. El diseño clave es correcto: stdio y HTTP del MCP comparten el registro de tools vía buildMcpServer(user?) en server.ts (cero duplicación de tools), y toda la lógica de auth real (OTP, tokens, tickets, hashes) vive solo en packages/core/src/auth.ts — apps/cli/src/auth.ts es un mero cliente HTTP de /auth/*. Las tools MCP delegan casi limpiamente en core (patrón guard→core→render), con una excepción: ask_project_context contiene orquestación propia duplicada literalmente en la ruta /ask de apps/web. Los problemas reales son de factura, no de arquitectura: apps/server/src/index.ts es un fichero monolítico (auth+contexto+installer+bootstrap) que no exporta la app Hono (intesteable in-process, y de hecho ningún test cubre las capas HTTP/MCP), la validación de input es inconsistente (el MCP usa zod compartido, la API castea body con `as never`), el guard de acceso a proyecto está implementado 3 veces con semánticas distintas, hay parsing de Bearer y boilerplate de arranque/shutdown copiado entre apps, side effects a nivel de módulo en server.ts (librería que ejecuta loadEnv/setClassifier al importarse), y config process.env leída inline en 6+ sitios. Todo es corregible con extracciones pequeñas y proporcionadas (factorías de app, middleware compartido, helper de guard en core), sin necesidad de capas nuevas.

### E1 · [🟡 Media] apps/server/src/index.ts es un monolito de entrypoint que no exporta la app Hono: intesteable y con 4 responsabilidades

- **Ficheros:** `apps/server/src/index.ts`, `apps/mcp-server/src/http.ts`
- **Evidencia:** apps/server/src/index.ts: 217 LOC con rutas de auth (líneas 54-102), rutas de contexto (107-204), installer (41-51) y bootstrap serve()+shutdown (206-217) en el mismo fichero; `const app = new Hono()` (línea 36) no se exporta y `serve()` corre en top-level (línea 207). Consecuencia verificada: tests/integration/{auth,permissions}.test.ts importan funciones de @cortex/core directamente y NINGÚN test ejercita las rutas HTTP (los guards de /capture, /relate o la comprobación de sesión-por-usuario del MCP HTTP no tienen cobertura). Lo mismo aplica a apps/mcp-server/src/http.ts (serve() en línea 66, nada exportado).
- **Recomendación:** Refactor mínimo sin capas nuevas: extraer `createApp(): Hono` (y en mcp-server `createMcpHttpApp()`) a un módulo app.ts que registre rutas, dejando index.ts como entrypoint de 15 líneas (loadEnv + wiring LLM + serve + señales). Opcionalmente partir rutas en auth-routes.ts y context-routes.ts (dos ficheros, no más). Esto habilita tests in-process con `app.request()` de Hono sin abrir puertos.

### E2 · [🟡 Media] Validación de entrada inconsistente: el MCP valida con zod compartido, la API HTTP parsea a mano y castea con `as never`

- **Ficheros:** `apps/server/src/index.ts`, `apps/mcp-server/src/server.ts`
- **Evidencia:** apps/mcp-server/src/server.ts:63 usa `inputSchema: saveContextInput.shape` (zod de @cortex/shared) para save; en cambio apps/server/src/index.ts:127-137 tipa el body con un tipo inline y checks manuales, y en 147-154 hace `type: (body.type as never)`, `confidence: (body.confidence as never)` y `} as never` sobre el argumento completo de saveWithReconciliation, anulando todo el tipado estático. En runtime un valor inválido NO llega a la BD (core lo valida: `saveContextInput.parse` en operations.ts:96 lanza ZodError), pero aflora como **500 genérico** con mensaje de zod en vez de un 400 con issues en el borde. El mismo patrón `c.req.json().catch(() => ({}))` + checks a mano se repite en /auth/request (55), /auth/verify (66), /capture/batch (166) y /relate (183).
- **Recomendación:** Reutilizar los schemas zod de @cortex/shared en los endpoints HTTP (safeParse del body y 400 con los issues). Elimina los `as never` y unifica el contrato del dominio en un solo sitio (mismo schema para MCP y API). No hace falta @hono/zod-validator; un helper parseBody(schema, c) de 5 líneas basta.

### E3 · [🟡 Media] Guard de acceso a proyecto implementado 3 veces con semánticas distintas

- **Ficheros:** `apps/mcp-server/src/server.ts`, `apps/server/src/index.ts`, `apps/web/src/index.ts`
- **Evidencia:** (1) apps/mcp-server/src/server.ts:47-52: `guard(project?)` por NOMBRE, devuelve string|null, y si el proyecto no existe DEJA PASAR (p==null → null). (2) apps/server/src/index.ts:110-113, 138-140, 167-170: bloque inline por SLUG repetido 3 veces, que 404ea si no existe. (3) apps/web/src/index.ts:77-81: `guardProject` por nombre devolviendo boolean, también deja pasar si no existe. Además el check por-entrada (getEntryProject + canAccessProject) se repite en mcp server.ts:158-161 y apps/server index.ts:186-189.
- **Recomendación:** Mover a @cortex/core (junto a canAccessProject, que ya vive allí) dos helpers únicos: `checkProjectAccess(email, {name?|slug?})` y `checkEntryAccess(email, entryId)` con un resultado discriminado (ok | not_found | forbidden), y que cada capa lo traduzca a su formato (errorText MCP, JSON 403/404, HTML). Unificar de paso la política 'proyecto inexistente': hoy el MCP y la web dejan pasar y la API 404ea.

### E4 · [🟡 Media] Orquestación de 'ask' duplicada literalmente entre la tool MCP y la ruta /ask de la web (lógica de aplicación fuera de core)

- **Ficheros:** `apps/mcp-server/src/server.ts`, `apps/web/src/index.ts`
- **Evidencia:** apps/mcp-server/src/server.ts:188-192 y apps/web/src/index.ts:397-401 contienen el mismo bloque: `searchContext({ query, project, limit: 6 })` + `synthesizeContextAnswer(question, hits.map((h) => ({ title: h.entry.title, summary: h.entry.summary ?? h.entry.content, type: h.entry.type })))`. Es la única tool MCP que no delega limpiamente: las otras 7 son guard→función-core→render.
- **Recomendación:** Extraer `askProjectContext(question, project?, limit?)` → `{ answer: string | null, hits }` a @cortex/agents (usa synthesizeContextAnswer, que vive ahí) o a core como operación que recibe el sintetizador inyectado (patrón setClassifier ya existente). MCP y web solo renderizan el resultado.

### E5 · [🟡 Media] server.ts del MCP es librería con side effects de entrypoint: loadEnv() y wiring LLM al importar el módulo

- **Ficheros:** `apps/mcp-server/src/server.ts`, `apps/web/src/index.ts`, `apps/server/src/index.ts`
- **Evidencia:** apps/mcp-server/src/server.ts:33-37 ejecuta en top-level `loadEnv(); if (isLlmEnabled()) { setClassifier(classifyEntry); if (process.env.CORTEX_RERANK !== 'off') setReranker(rerankLLM); }` pese a ser un módulo importado por dos entrypoints (index.ts:4, http.ts:8). Importar buildMcpServer en un test muta estado global de @cortex/core (setClassifier/setReranker) y lee .env. El mismo wiring se repite con variaciones en apps/web/src/index.ts:45-49 (idéntico) y apps/server/src/index.ts:33-34 (loadEnv + wireReconciler), tres copias del patrón de arranque.
- **Recomendación:** Exponer en @cortex/agents una función `wireLlm(options?)` que encapsule isLlmEnabled + setClassifier + setReranker + wireReconciler, y llamarla explícitamente desde cada entrypoint (index.ts, http.ts, web, server) tras loadEnv(). server.ts queda como factoría pura sin side effects, testeable.

### E6 · [🟢 Baja] Middleware de autenticación Bearer duplicado con nombres inconsistentes entre mcp-server/http.ts y apps/server

- **Ficheros:** `apps/mcp-server/src/http.ts`, `apps/server/src/index.ts`
- **Evidencia:** El mismo regex y flujo aparece dos veces: apps/mcp-server/src/http.ts:23-27 (`authUser`: match /^Bearer\s+(.+)$/i + validateToken) y apps/server/src/index.ts:76-84 (`bearer` + `currentUser`, mismo regex). apps/web usa un tercer mecanismo (cookie + middleware gate, web/index.ts:108-114), justificado por ser navegador, pero la respuesta 'No autenticado.' 401 también se repite en 7 endpoints de apps/server.
- **Recomendación:** Un único helper `bearerUser(c: Context): Promise<AuthUser | null>` (y en apps/server un middleware Hono `requireAuth` que setee c.var.user y corte con 401) compartido. Al ser solo 2 apps, puede vivir en @cortex/core junto a validateToken sin crear paquete nuevo.

### E7 · [🟢 Baja] Manejo de errores: mensajes internos al cliente, catch mudo y ausencia de logging en servidor

- **Ficheros:** `apps/server/src/index.ts`, `apps/mcp-server/src/server.ts`
- **Evidencia:** (a) apps/server/src/index.ts:117-119: `catch { return c.json({ project: project.name, text: '' }); }` — /context-pack traga cualquier error sin log ni distinción de causa. (b) Los endpoints /capture (158), /capture/batch (175) y /relate (194) devuelven 500 con `(e as Error).message` crudo (posible fuga de detalles de BD) y no loggean nada en servidor. (c) En las 8 tools MCP el patrón es igual: errorText(`Error…: ${(e as Error).message}`) sin log (server.ts:72, 92, 118, 139, 166, 195, 220, 241) — aceptable para tools MCP (el agente necesita el mensaje) pero el stack se pierde siempre.
- **Recomendación:** Proporcionado a un prototipo: añadir `console.error` con el error completo antes de responder (o app.onError de Hono como red global), eliminar el catch mudo de /context-pack (que devuelva 500 o al menos loggee), y en los 500 de la API devolver mensaje genérico dejando el detalle en el log. No hace falta librería de logging.

### E8 · [🟢 Baja] Configuración por process.env dispersa e inline en cada entrypoint, sin punto único

- **Ficheros:** `apps/mcp-server/src/http.ts`, `apps/server/src/index.ts`, `packages/core/src/auth.ts`
- **Evidencia:** Lecturas inline detectadas solo en este ámbito: CORTEX_MCP_AUTH (http.ts:15), CORTEX_MCP_PORT (http.ts:65), CORTEX_RERANK (server.ts:36), CORTEX_PUBLIC_URL (apps/server/index.ts:49), CORTEX_SERVER_PORT (apps/server/index.ts:206); más WEB_PORT (web:706) y el bloque de CORTEX_OTP_*/CORTEX_AUTH_DOMAIN/CORTEX_ADMIN_EMAIL/CORTEX_UI_TICKET_TTL_SEC en core/auth.ts:18-25,131 (donde además TICKET_TTL_SEC se lee al cargar el módulo, inconsistente con el resto que es lazy a propósito según el comentario de la línea 17).
- **Recomendación:** Un módulo config.ts pequeño por app (3-6 constantes con default y parse a número) leído en el entrypoint tras loadEnv(); no montar un sistema de config genérico. En core/auth.ts, hacer lazy también TICKET_TTL_SEC por coherencia. Documentar las variables en .env.example si faltan.

### E9 · [🟢 Baja] Modo CORTEX_MCP_AUTH=off crea un AuthUser sintético que activa los permisos con email vacío en vez de desactivarlos

- **Ficheros:** `apps/mcp-server/src/http.ts`, `apps/mcp-server/src/server.ts`
- **Evidencia:** apps/mcp-server/src/http.ts:26 devuelve `{ id: 'anon', email: '', admin: false } as AuthUser` cuando auth está off. Ese user se pasa a buildMcpServer (http.ts:57), y el guard de server.ts:47-52 solo desactiva permisos si `!user`: con el anon, `canAccessProject(p, '')` se evalúa igualmente, con lo que 'auth off' deniega proyectos privados en vez de comportarse como el stdio sin permisos (server.ts:31 documenta que sin user 'se comportan como antes'). El comentario de http.ts:22 ('usuario anónimo sin permisos finos') no describe lo que ocurre.
- **Recomendación:** Decidir la semántica y hacerla explícita: si auth off = confiar (paridad con stdio), pasar `undefined` a buildMcpServer y eliminar el usuario falso y su cast; si auth off debe seguir restringiendo privados, documentarlo y quitar el `as AuthUser`. Una línea de cambio en cualquiera de los dos casos.

### E10 · [🟢 Baja] Boilerplate de arranque y shutdown copiado en los 3 servidores HTTP y acoplamiento directo apps→@cortex/database solo para closeSql

- **Ficheros:** `apps/mcp-server/src/http.ts`, `apps/mcp-server/src/index.ts`, `apps/server/src/index.ts`, `apps/web/src/index.ts`
- **Evidencia:** El bloque puerto-env + serve() + shutdown(closeSql + process.exit) + process.on(SIGINT/SIGTERM) aparece casi idéntico en apps/mcp-server/src/http.ts:65-75, apps/server/src/index.ts:206-217, apps/web/src/index.ts:706-716 y (variante stdio) apps/mcp-server/src/index.ts:17-22. Los cuatro importan closeSql directamente de @cortex/database (única razón por la que las apps dependen del paquete database además de core). Detalle menor: apps/server/index.ts:214 llama closeSql() sin .catch() a diferencia de los otros (un fallo al cerrar dejaría el proceso colgado sin exit).
- **Recomendación:** Helper único `runServer(app, { name, portEnv, defaultPort })` (10-15 líneas, puede vivir en @cortex/shared) que encapsule serve + señales + closeSql().catch. Re-exportar closeSql desde @cortex/core (o un `shutdown()` en core) para que las apps no dependan de database. Beneficio proporcional: quita ~40 líneas repetidas y elimina la divergencia del .catch.

### E11 · [🟢 Baja] Map de sesiones MCP en memoria sin expiración ni límite

- **Ficheros:** `apps/mcp-server/src/http.ts`
- **Evidencia:** apps/mcp-server/src/http.ts:17 `const sessions = new Map<...>()`; solo se limpia en t.onclose (líneas 54-56). Un cliente que nunca envía DELETE/close acumula transports (cada uno con un McpServer completo, http.ts:57) indefinidamente; además ata el diseño a single-process (sticky sessions si algún día hay 2 réplicas).
- **Recomendación:** Para el prototipo basta: guardar lastSeen por sesión y un sweep perezoso (setInterval o en cada request) que cierre sesiones inactivas > N min, más un comentario explícito de la limitación single-process. No introducir Redis ni almacenamiento externo.

### E12 · [🟢 Baja] Repetición estructural x8 del envoltorio try/guard/render en las tools MCP

- **Ficheros:** `apps/mcp-server/src/server.ts`
- **Evidencia:** apps/mcp-server/src/server.ts: los 8 registerTool (líneas 54-244) repiten el mismo esqueleto `try { const denied = await guard(args.project); if (denied) return errorText(denied); return text(render(await coreFn(...))); } catch (e) { return errorText("Error …: " + (e as Error).message); }` con solo la función core y el mensaje variando; validate_context_entry es la única variación real (guard por entrada, líneas 156-161).
- **Recomendación:** Un helper local `registerGuardedTool(server, name, meta, handler, errorLabel)` que centralice guard + try/catch + text/errorText reduciría el fichero a ~130 líneas declarativas. Es refactor de bajo riesgo y alto ratio; no extraer las tools a 8 ficheros (sobreingeniería para 249 LOC).

### E13 · [🟢 Baja] Doc y scripts desincronizados con el código: CLAUDE.md dice '5 tools' y omite apps/server y apps/cli; no hay script raíz para arrancar la API

- **Ficheros:** `CLAUDE.md`, `package.json`, `apps/mcp-server/src/server.ts`
- **Evidencia:** CLAUDE.md (sección Estructura) lista solo `apps/mcp-server` ('las 5 tools corporativas') y `apps/web`, pero existen apps/server y apps/cli, y server.ts:28 documenta 'las 8 tools'. El package.json raíz (líneas 19-20) tiene scripts `mcp` y `web` pero ninguno para @cortex/server ni para el transporte HTTP del MCP (`start:http` solo existe en apps/mcp-server/package.json), pese a que la CLI asume la API en http://localhost:8787 por defecto (apps/cli/src/auth.ts:17). Riesgo real: el propio CLAUDE.md exige mantenerlo al día y el siguiente agente operará con un mapa falso del sistema.
- **Recomendación:** En el PR del refactor: actualizar la sección Estructura de CLAUDE.md (añadir apps/server 'API HTTP para CLI/hooks/conectores' y apps/cli, corregir el número de tools o dejar de contarlas) y añadir scripts raíz `server` y `mcp:http` para que los tres procesos se arranquen igual.

### E14 · [🟢 Baja] Ruta frágil al instalador servido: depende del layout del monorepo en runtime

- **Ficheros:** `apps/server/src/index.ts`
- **Evidencia:** apps/server/src/index.ts:41 `const INSTALL_SH = resolve(import.meta.dirname, "../../../scripts/install.sh")` — atraviesa 3 niveles hasta scripts/ del repo raíz. Funciona con tsx sobre el fuente, pero se rompe si se compila a dist/, se dockeriza la app suelta o se mueve el fichero; el fallback es un 500 con texto plano (líneas 44-48).
- **Recomendación:** Para el prototipo, aceptable; al refactorizar, copiar install.sh como asset del paquete (apps/server/assets/) o resolverlo vía una env CORTEX_INSTALL_SH con el path actual como default, y dejar comentada la limitación.

---

<a id="área-f"></a>

## Área F — apps/cli, scripts/, tests/ (unit + integration), configuración raíz (vitest, tsconfig, docker-compose, .env.example), config/ y .claude/

**Diagnóstico:** El CLI `cortex` no es una aplicación: es un dispatcher de 62 LOC que enruta subcomandos a ficheros ejecutables repartidos por TODO el monorepo (packages/core/src, packages/agents/src, apps/server, apps/mcp-server, scripts/) mediante import dinámico por ruta absoluta y mutación de process.argv. Eso significa que hay 7+ entrypoints ejecutables (main() incondicional + process.exit) viviendo dentro de paquetes de librería, acoplados por ruta de fichero y no por API. scripts/cortex-sync.ts (299 LOC) es un god-file instalador con 4 responsabilidades y ejecución a nivel de módulo, que vive fuera de apps/ por razón histórica ya obsoleta (el propio config/README.md:172 aún lo describe como "a futuro"). Los tests existen y el pipeline CI es sólido (typecheck + unit + integration con Postgres real), pero cubren una franja estrecha: 4 módulos utilitarios en unit y el happy path de core/auth/permisos en integración; 0 tests para las 4 apps (~1.750 LOC), embeddings, conectores/ingesta y cortex-sync. La higiene de tsconfig es buena (strict, base compartida, extends por paquete). La configuración por env vars está fuera de control: ~37 variables leídas en código que no aparecen en .env.example, dos mecanismos de lectura conviviendo (shared getEnv/requireEnv con carga lazy de .env vs ~50 lecturas directas de process.env), y el CLI ni siquiera carga el .env, con lo que CORTEX_SERVER_URL del .env no aplica a `cortex auth` aunque .env.example lo sugiera. Confirmada la deriva docs/código: CLAUDE.md no menciona apps/cli ni apps/server (0 ocurrencias) y habla de "5 tools" cuando config/README.md lista 8. Hay duplicación pequeña pero clara: lectura de ~/.cortex/credentials copiada en 3 sitios y el plugin/alias de vitest copiado idéntico en los dos configs.

### F1 · [🔴 Alta] El CLI enruta a entrypoints ejecutables incrustados en paquetes de librería, acoplados por ruta de fichero

- **Ficheros:** `apps/cli/src/index.ts`, `packages/core/src/link.ts`, `packages/core/src/connect-docs.ts`, `packages/core/src/connect-github.ts`, `packages/core/src/connect-notion-export.ts`, `packages/agents/src/maintain.ts`, `apps/cli/package.json`
- **Evidencia:** apps/cli/src/index.ts:17-30 mapea subcomandos a rutas como packages/core/src/link.ts, packages/core/src/connect-docs.ts, packages/agents/src/maintain.ts, apps/server/src/index.ts, scripts/cortex-sync.ts; línea 55 muta process.argv (`process.argv = [process.argv[0]!, script, ...rest]`) antes del import dinámico. En packages/core, link.ts:121, connect-docs.ts:71, connect-github.ts:98 y connect-notion-export.ts:183 llaman main() incondicionalmente a nivel de módulo con process.exit; solo packages/agents/src/maintain.ts:89 y connect-sessions.ts:282 tienen guard `import.meta.url === file://argv[1]`. El propio comentario de index.ts:3-9 documenta el hack. Además apps/cli/package.json:13-18 declara deps @cortex/* que ningún fichero del CLI importa.
- **Recomendación:** Invertir la dirección: los packages exportan funciones (runLink(opts), ingestDocs(opts)…) sin process.exit ni lectura de argv, y apps/cli tiene un fichero fino por subcomando (apps/cli/src/commands/*.ts) que parsea argv y las llama. Elimina la mutación de process.argv y los main() incondicionales dentro de packages/*. Es el refactor de más valor del ámbito y no requiere frameworks: la tabla COMMANDS pasa de rutas a imports estáticos, lo que además hace reales las deps del package.json.

### F2 · [🔴 Alta] Cobertura de tests estrecha: 0 tests para las 4 apps, embeddings, conectores/ingesta y cortex-sync

- **Ficheros:** `tests`, `tests/integration`, `scripts/cortex-sync.ts`
- **Evidencia:** Todo el conjunto de tests son 416 LOC: unit (tests/auth.test.ts, domain.test.ts, project-config.test.ts, session-readers.test.ts) cubre 4 módulos utilitarios; integración (tests/integration/{core,auth,permissions}.test.ts) cubre save/search/context-pack/captureBatch/reconciliación, flujo OTP y permisos. Sin tests: apps/web (947 LOC), apps/mcp-server (351), apps/cli (242), apps/server (217), packages/embeddings (253), y la mayor parte de packages/core (3.900 LOC: ingest, extract, lint, curate, temporal, dedup, code-index, render, queries) y packages/agents (1.552: maintain, enrich, rerank, synthesize). scripts/cortex-sync.ts (299 LOC que escribe en ~/.claude/settings.json, ~/.codex/config.toml, ~/.hermes/config.yaml) tampoco tiene ninguno y es intesteable tal cual (ejecuta en import).
- **Recomendación:** Proporcional a un prototipo: (1) smoke tests HTTP de apps/server con el test client de Hono (auth endpoints ya tienen la lógica testada en core, falta el wiring); (2) un test del dispatcher del CLI (comando desconocido, help, resolución de ruta); (3) tras extraer funciones puras de cortex-sync (ver finding específico), testearlas con HOME temporal (mkdtemp) — es el código con más riesgo real porque muta la máquina del dev. No perseguir cobertura de web/mcp-server todavía.

### F3 · [🔴 Alta] Configuración por env dispersa y sin documentar: ~37 variables usadas que no están en .env.example y dos mecanismos de lectura

- **Ficheros:** `.env.example`, `packages/shared/src/env.ts`
- **Evidencia:** .env.example documenta 25 variables; el código lee además CORTEX_RERANK, CORTEX_MAX_CHUNKS, CORTEX_DEDUP_THRESHOLD/NOOP/MAX_DIST, CORTEX_SESSIONS_{LIMIT,WINDOW_CHARS,TURN_CHARS,MAX_WINDOWS}, CORTEX_INGEST_{CONCURRENCY,LLM}, CORTEX_MCP_{PORT,AUTH}, CORTEX_MAINTAIN_{ON_START,CRON}, CORTEX_SEED_CONFIRM, CORTEX_PUBLIC_URL, CORTEX_UI_TICKET_TTL_SEC, CORTEX_OCR_*, CORTEX_HOOK_CTX_CHARS, CORTEX_DECAY_DAYS, CORTEX_EMBED_BATCH, CORTEX_AUDIO_SEGMENT_SEC, NAN_WHISPER_MODEL, CORTEX_TEST_DATABASE_URL, CORTEX_PG_CONTAINER… (inventario por grep de process.env + getEnv/requireEnv). Conviven dos mecanismos: packages/shared/src/env.ts (getEnv/requireEnv con loadEnv lazy del .env raíz, 12 usos) y ~50 lecturas directas de process.env que solo ven el .env si ANTES algún getEnv lo cargó (dependencia del orden de imports).
- **Recomendación:** No hace falta un framework de config: (a) añadir a .env.example las variables que de verdad son tuning soportado y borrar del código las que nadie usa; (b) regla única: toda lectura de env pasa por getEnv/requireEnv de @cortex/shared (garantiza loadEnv y da un punto de búsqueda); (c) opcionalmente un bloque `config` por paquete (un objeto con defaults) en lugar de leer process.env en el punto de uso.

### F4 · [🟡 Media] scripts/cortex-sync.ts es un god-file de 299 LOC con ejecución a nivel de módulo y ubicación histórica obsoleta

- **Ficheros:** `scripts/cortex-sync.ts`, `package.json`, `apps/cli/src/index.ts`
- **Evidencia:** Cuatro responsabilidades en un fichero: registro de MCP en 4 formatos de agente (mcpClaude:68, mcpCodex:81, mcpOpenCode:92, mcpHermes:108), hooks en 4 formatos (syncClaudeHooks:128, syncCodexHooks:156, syncHermesHooks:167, syncOpenCodeHooks:184 — este último genera un plugin JS como template string), shim del CLI (installCortexShim:212) y doctor (234). Efectos en import: línea 25 lee toolbelt.json, 42-46 parsea argv, y las líneas 249-299 son el main ejecutándose a nivel de módulo sin guard ni función. El dispatch agente→función son cadenas if/else (264-267, 290-292). Vive en scripts/ aunque es el subcomando `cortex sync` (apps/cli/src/index.ts:23) — config/README.md:172 aún dice 'A futuro: empaquetar cortex sync como bin cortex (hoy pnpm cortex:sync)', razón histórica ya cumplida. Su dependencia `yaml` está declarada en el package.json RAÍZ (líneas 35-37).
- **Recomendación:** Moverlo a apps/cli/src/commands/sync/ con: main() explícito, un tipo AgentAdapter { detect, addMcp, syncHooks, commandsDir } y un Record<string, AgentAdapter> que sustituya los if/else (un fichero por agente si se quiere, ~60 LOC cada uno). Mover la dep yaml a @cortex/cli. Mantener el alias pnpm cortex:sync apuntando al nuevo sitio. Es refactor mecánico, sin cambiar comportamiento.

### F5 · [🟡 Media] Lectura de ~/.cortex/credentials duplicada en 3 sitios con la misma interface Creds

- **Ficheros:** `apps/cli/src/auth.ts`, `apps/cli/src/ui.ts`, `packages/core/src/api-client.ts`
- **Evidencia:** apps/cli/src/auth.ts:15-38 (CREDS_DIR/CREDS_FILE, readCreds/writeCreds, interface Creds), apps/cli/src/ui.ts:11-26 (CREDS, creds(), interface Creds sin email) y packages/core/src/api-client.ts:11-25 (interface Creds, creds()). Tres implementaciones del mismo JSON.parse con try/catch → null sobre el mismo fichero.
- **Recomendación:** Un único módulo de credenciales (encaja en packages/core junto a api-client.ts, que ya lo necesita): exportar readCreds/writeCreds/clearCreds + tipo Creds, y que auth.ts/ui.ts lo importen. ~20 LOC netas menos y un solo punto si cambia el formato o la ruta.

### F6 · [🟡 Media] Deriva docs/código confirmada: CLAUDE.md no conoce apps/cli ni apps/server; config/README.md describe como futuro lo que ya existe

- **Ficheros:** `CLAUDE.md`, `config/README.md`, `config/mcp/cortex.json`
- **Evidencia:** grep 'apps/cli|apps/server' CLAUDE.md → 0 ocurrencias; el bloque de estructura de CLAUDE.md (sección Estructura) solo lista apps/mcp-server y apps/web, y dice 'las 5 tools corporativas' cuando config/README.md:144-151 lista 8 tools MCP. README.md sí está al día (línea 245 lista las 4 apps). config/README.md:5-7 presenta la instalación como manual y `cortex sync` como objetivo; :172 dice pendiente 'empaquetar cortex sync como bin cortex' — ambos ya existen (scripts/cortex-sync.ts + installCortexShim). config/mcp/cortex.json duplica la definición del MCP que ya está en config/toolbelt.json (que es lo que lee cortex-sync); solo la referencia el README. Los comandos de CLAUDE.md tampoco mencionan pnpm test / test:integration.
- **Recomendación:** En el PR del refactor: actualizar el bloque Estructura y Comandos de CLAUDE.md (añadir apps/cli y apps/server, corregir el número de tools, añadir test/test:integration), podar las secciones 'a futuro' cumplidas de config/README.md, y eliminar config/mcp/cortex.json o dejarlo explícitamente como ejemplo de instalación manual (una sola fuente: toolbelt.json).

### F7 · [🟡 Media] El CLI no carga el .env del repo: CORTEX_SERVER_URL/CORTEX_WEB_URL del .env no aplican a `cortex auth` ni `cortex ui`

- **Ficheros:** `apps/cli/src/auth.ts`, `apps/cli/src/ui.ts`, `packages/shared/src/env.ts`, `.env.example`
- **Evidencia:** apps/cli/src/auth.ts:17 (`const DEFAULT_SERVER = process.env.CORTEX_SERVER_URL || "http://localhost:8787"`) y ui.ts:12,34 leen process.env directamente; ninguno de los dos importa nada de @cortex/shared, así que loadEnv() (packages/shared/src/env.ts:11-19, que carga el .env raíz de forma lazy) nunca se ejecuta en esos procesos. Sin embargo .env.example:36-38 documenta 'Cliente: CORTEX_SERVER_URL (CLI auth)' dando a entender que basta con ponerlo en .env. El resto del repo sí lo ve porque algún getEnv/requireEnv (p.ej. DATABASE_URL) dispara loadEnv antes.
- **Recomendación:** Que auth.ts y ui.ts usen getEnv() de @cortex/shared (o llamen loadEnv() al inicio). Alternativa si se decide que el CLI instalado global NO debe leer el .env del repo: documentarlo en .env.example y en config/README.md para eliminar la ambigüedad.

### F8 · [🟢 Baja] Configs de vitest duplicadas (plugin nodenext-js-to-ts + alias copiados) y dos estilos de import en tests

- **Ficheros:** `vitest.config.ts`, `vitest.integration.config.ts`, `tests/auth.test.ts`
- **Evidencia:** vitest.config.ts:5-28 y vitest.integration.config.ts:5-31 contienen carácter a carácter la misma construcción de cortexAlias y el mismo plugin inline resolveId. Además los tests unit importan por ruta relativa ('../packages/core/src/auth' en tests/auth.test.ts:2) mientras los de integración usan los alias ('@cortex/core' en tests/integration/core.test.ts:3-13).
- **Recomendación:** Extraer plugin+alias a un vitest.shared.ts en la raíz e importarlo desde ambos configs; unificar los imports de tests al alias @cortex/* (los alias ya existen en el config unit). Cambio de 15 minutos.

### F9 · [🟢 Baja] apps/cli/package.json declara un bin inservible (src/index.ts sin shebang)

- **Ficheros:** `apps/cli/package.json`, `scripts/cortex-sync.ts`
- **Evidencia:** apps/cli/package.json:6-8: `"bin": {"cortex": "src/index.ts"}`. index.ts no tiene shebang y es TypeScript: ejecutado como bin fallaría. El mecanismo real de instalación es el shim sh que genera scripts/cortex-sync.ts:212-231 (`exec tsx .../apps/cli/src/index.ts`). Config muerta/engañosa.
- **Recomendación:** Eliminar el campo bin (el shim es el mecanismo real) o convertirlo en un wrapper .mjs con shebang que invoque tsx. Documentar en el package.json del CLI que la instalación va por `cortex sync`.

### F10 · [🟢 Baja] cortex-sync escribe TOML de Codex por concatenación de strings sin escaping y detecta presencia por substring

- **Ficheros:** `scripts/cortex-sync.ts`
- **Evidencia:** scripts/cortex-sync.ts:84-90 (mcpCodex): detecta con `readFileSync(toml).includes(`[mcp_servers.${name}]`)` y añade un bloque construido con template strings (`args = [${...map(a => `"${a}"`)}]`) — un arg con comillas o backslash produce TOML inválido; syncCodexHooks:158-163 igual (detección por substring 'hook:context' y append). Para YAML/JSON sí usa parsers (yaml, JSON.parse).
- **Recomendación:** Aceptable en prototipo (los args vienen del toolbelt propio). Si se refactoriza a adaptadores, usar smol-toml (o similar) para leer/escribir config.toml igual que ya se hace con YAML; como mínimo, dejar un comentario de la limitación.

### F11 · [🟢 Baja] El test de integración de auth extrae el OTP interceptando console.log

- **Ficheros:** `tests/integration/auth.test.ts`, `packages/core/src/email.ts`
- **Evidencia:** tests/integration/auth.test.ts:12-26 (otpFor): reemplaza console.log, llama requestOtp y regexea `(\d{6})` de lo capturado, porque en modo dev (sin BREVO_API_KEY) el código se loguea por stdout. El test queda acoplado al formato del log del modo dev de packages/core.
- **Recomendación:** Seam mínimo: que requestOtp devuelva el código cuando no hay proveedor de email (o aceptar un mailer inyectable con implementación 'console' por defecto). Elimina el monkey-patch y de paso desacopla email.ts.

### F12 · [🟢 Baja] config/ mezcla el producto con un cajón de sastre de skills internas en Python/shell

- **Ficheros:** `config/skills`, `config/README.md`
- **Evidencia:** config/skills/ contiene, además de cortex-capture (propia), plane-api (4 scripts Python), google-chat (2 scripts Python + requirements.txt), agent-teams (3 templates shell), bkt y expect — herramientas internas de Dinacode sin relación con el código del producto, dentro del monorepo TS. config/README.md:163-167 lo reconoce ('copias curadas para distribución interna').
- **Recomendación:** No tocar en este refactor (funciona y está documentado), pero declararlo explícitamente fuera del alcance del código del producto; a medio plazo, mover el toolbelt vendorizado a su propio repo y que toolbelt.json lo referencie, para que el monorepo de Cortex solo contenga Cortex.

---

<a id="área-g"></a>

## Área G — Duplicación transversal (todo el repo) + inventario de responsabilidades, entrypoints, acoplamiento, código muerto, config y testabilidad

**Diagnóstico:** El prototipo tiene una separación por capas razonable (shared→database/embeddings→core→agents→apps) y core no depende de agents (inyección vía setClassifier/setReranker/setReconciler), pero la duplicación transversal es alta y sistemática, típica de vibecoding: la resolución de proyecto está reimplementada 7 veces con DOS semánticas distintas (canonical_name vs name exacto), el control de acceso está reimplementado 4 veces con políticas inconsistentes (y la ruta POST /save de la web no tiene guard ninguno), y la lectura de ~/.cortex/credentials existe en 4 sitios con 3 interfaces Creds copiadas. Los paquetes core y agents mezclan librería con ~14 entrypoints CLI (main() + process.exit + loadEnv() intercalado entre imports), y apps/cli despacha por import() dinámico mutando process.argv, lo que hace imposible tratar packages/* como librerías puras. Hay familias enteras de helpers copy-paste: 3 extractJson (+1 variante inline), 3 retry-backoff HTTP, 5 walkers recursivos de directorios, 2 fusiones RRF casi idénticas, 2 lectores de stdin, 2 argOf y la config LLM (visionConfig vs getLlmConfig) duplicada entre core y agents porque core no puede importar agents. La configuración son ~60 variables CORTEX_* leídas con process.env crudo en 27 ficheros, con defaults duplicados y sin un módulo de config central pese a existir shared/env.ts. Hay código muerto claro (ingestSessionFile, resolveProjectFromCwd, isAuthenticated, SUPPORTED_DOC_EXTS) y código de demo cuestionable (workflows.ts de Mastra solo usado por demo-capture.ts). El manejo de errores es mayoritariamente catch-and-swallow y la testabilidad fuera de funciones puras exige Postgres real por los singletons getSql()/getEmbeddingProvider() resueltos dentro de cada función. Nada de esto exige un rediseño DDD: con ~6 extracciones de módulos compartidos y mover los CLIs a apps/cli se elimina el 80% de la duplicación sin sobreingeniería.

### G1 · [🔴 Alta] Lookup de proyecto reimplementado 7 veces con DOS semánticas incompatibles (canonical_name vs name exacto)

- **Ficheros:** `packages/core/src/operations.ts`, `packages/core/src/queries.ts`, `packages/core/src/code.ts`, `packages/core/src/lint.ts`, `packages/core/src/dedup.ts`, `packages/core/src/capture.ts`, `packages/agents/src/connect-sessions.ts`
- **Evidencia:** Por canonical_name (case/acentos-insensible): operations.ts:380-386, queries.ts:182-188 (copia idéntica), code.ts:141-146, lint.ts:21-26. Por name EXACTO: dedup.ts:28-31 (`WHERE type='project' AND name=${project}`), capture.ts:31 (inline), connect-sessions.ts:132-134 (`p.name = ${project}`), projects.ts:34-37 (findProjectByName). Consecuencia real: saveContext crea/encuentra el proyecto por forma canónica, pero saveWithReconciliation→findNearest (dedup.ts) lo busca por name exacto; con 'acme portal' vs 'Acme Portal' la reconciliación devuelve silenciosamente null y NUNCA deduplica, sin error.
- **Recomendación:** Un único módulo de acceso a proyectos (ampliar packages/core/src/projects.ts con findProjectId(nameOrSlug) canónico), borrar las 6 copias y decidir explícitamente una sola semántica de resolución (canónica). Es la unificación de mayor valor/coste del repo.

### G2 · [🔴 Alta] Control de acceso duplicado en 4 implementaciones inconsistentes; POST /save de la web sin guard

- **Ficheros:** `apps/web/src/index.ts`, `apps/server/src/index.ts`, `apps/mcp-server/src/server.ts`, `apps/mcp-server/src/http.ts`
- **Evidencia:** Cuatro guards distintos: apps/server bearer()+currentUser() repetido por ruta (index.ts:76-84 y 6 rutas), web guardProject (index.ts:77-81: `if (!p) return true` → permisivo), MCP guard (server.ts:47-52: `if (p && !acceso) deny` → también permisivo), y regex Bearer duplicada (server index.ts:77 y mcp http.ts:24). Hueco concreto: POST /save (web index.ts:361-386) guarda en CUALQUIER proyecto sin comprobar acceso y con createdBy:'web-ui' en vez del email del usuario logueado (rompe la atribución que el propio repo predica en CLAUDE.md §trazabilidad).
- **Recomendación:** Extraer a core un helper único (requireProjectAccess(user, projectRef) y parseBearer) y usarlo en las 3 apps; añadir guard + createdBy=user.email a /save. Decidir y documentar la política para proyecto inexistente (hoy 'permitir' en 2 sitios, implícito).

### G3 · [🔴 Alta] Lectura de ~/.cortex/credentials copiada en 4 ficheros con 3 interfaces Creds duplicadas

- **Ficheros:** `apps/cli/src/auth.ts`, `apps/cli/src/ui.ts`, `packages/core/src/api-client.ts`, `packages/core/src/link.ts`
- **Evidencia:** cli/auth.ts:19-38 (interface Creds + readCreds/writeCreds), cli/ui.ts:14-26 (interface Creds + creds()), core/api-client.ts:11-25 (interface Creds + creds()), core/link.ts:20-28 (credsEmail()). Cuatro parseos JSON del mismo fichero, tres definiciones del mismo tipo; solo cli/auth.ts conoce el formato de escritura (chmod 600), así que cualquier cambio de formato rompe 3 lectores silenciosamente (todos degradan a null).
- **Recomendación:** Un módulo credentials.ts en @cortex/core (readCredentials/writeCredentials/clearCredentials + tipo Creds exportado) consumido por CLI, api-client y link. Trivial y elimina una clase entera de bugs.

### G4 · [🟡 Media] Pipeline de destilación duplicado dentro de connect-sessions.ts; ingestSessionFile es código muerto

- **Ficheros:** `packages/agents/src/connect-sessions.ts`
- **Evidencia:** captureCondensedViaApi (147-182) e ingestSessionFile (194-228) repiten el mismo bucle windows→distill→dedup-por-clave→contadores saved/updated/superseded/noop; solo difiere el sink (apiPost /capture vs saveWithReconciliation directo). grep de importadores: ingestSessionFile no se usa en ningún sitio (el hook usa captureSessionViaApi).
- **Recomendación:** Borrar ingestSessionFile (y su IngestResult); si algún día hace falta la vía directa a BD, extraer distillTranscript(slug, condensed): Item[] y parametrizar solo el sink.

### G5 · [🟡 Media] Config del proveedor LLM duplicada entre paquetes (visionConfig ≡ getLlmConfig) e interfaz VisionCfg declarada dos veces en el mismo fichero

- **Ficheros:** `packages/core/src/extract.ts`, `packages/agents/src/openrouter.ts`
- **Evidencia:** extract.ts:46-54 reimplementa openrouter.ts:20-44: mismos env (LLM_PROVIDER, NAN_API_KEY, NAN_BASE_URL 'https://api.nan.builders/v1', OPENROUTER_API_KEY) y mismo default de modelo 'deepseek/deepseek-v4-pro'. Causa: core no puede depender de agents. Además `interface VisionCfg` está declarada DOS veces en extract.ts (líneas 56-60 y 146-150), copy-paste puro.
- **Recomendación:** Mover getLlmConfig a @cortex/shared (que ambos ya importan) y borrar visionConfig y el VisionCfg duplicado. Renombrar openrouter.ts → llm-config.ts de paso.

### G6 · [🟡 Media] extractJson copiado en agents (3 copias + 1 variante inline en rerank.ts)

- **Ficheros:** `packages/agents/src/classify.ts`, `packages/agents/src/enrich.ts`, `packages/agents/src/connect-sessions.ts`, `packages/agents/src/rerank.ts`
- **Evidencia:** classify.ts:39-45 y enrich.ts:52-58 (versión con fences, idénticas), connect-sessions.ts:104-108 (versión simple), rerank.ts:27-29 (inline). Los cuatro hacen 'primer { … último }'. classify.ts y enrich.ts además comparten el mismo esqueleto retry×2 + parse + validación de enums.
- **Recomendación:** Un helper en agents (p.ej. json-utils.ts con extractJson y un runJsonAgent(role, prompt, schema) que encapsule retry+parse). Reduce ~60 líneas y unifica el manejo de respuestas del modelo.

### G7 · [🟡 Media] Retry con backoff exponencial sobre fetch implementado 3 veces

- **Ficheros:** `packages/embeddings/src/remote.ts`, `packages/core/src/extract.ts`
- **Evidencia:** remote.ts postWithRetry:5-18 (6 intentos, 800*2^n cap 15s), extract.ts visionCall:70-83 (4 intentos, 800*2^n) y postWhisper:155-173 (5 intentos, 1000*2^n). Los tres reintentan en 429/5xx con la misma estructura; VoyageEmbeddingProvider (remote.ts:80-98) ni siquiera usa el helper de su propio fichero.
- **Recomendación:** Un fetchWithRetry(url, init, opts) en @cortex/shared usado por embeddings y extract (y Voyage). No hace falta librería externa.

### G8 · [🟡 Media] Fusión RRF de búsqueda híbrida duplicada entre vectors.ts y code.ts; INSERT de embeddings y filtro bi-temporal también repetidos

- **Ficheros:** `packages/core/src/vectors.ts`, `packages/core/src/code.ts`, `packages/core/src/operations.ts`
- **Evidencia:** vectors.ts hybridSearch:117-145 y code.ts searchProjectCode:186-218 son la misma fusión (K=60, acc Map rrf+cosine, sort, fetch por ids, score cosine??rrf) sobre tablas distintas. INSERT de embedding duplicado entre storeEmbedding (vectors.ts:16-22) y storeEmbeddingsBatch (41-47). Filtro temporal `asOf/valid_to IS NULL` repetido 3 veces: vectors.ts:88-92, vectors.ts:175-179, operations.ts entriesByType:408-410.
- **Recomendación:** Extraer rrfFuse(vecRows, ftsRows, limit) y un helper temporalFilter(sql, asOf, includeHistorical); hacer que storeEmbedding delegue en storeEmbeddingsBatch con 1 elemento. Mantener las dos búsquedas (entradas vs código) como funciones separadas está bien.

### G9 · [🟡 Media] 14 entrypoints CLI (main + process.exit + loadEnv entre imports) viven dentro de packages/* mezclados con la librería

- **Ficheros:** `packages/core/src/connect-docs.ts`, `packages/core/src/connect-github.ts`, `packages/core/src/connect-notion-export.ts`, `packages/core/src/link.ts`, `packages/core/src/seed.ts`, `packages/core/src/ingest.ts`, `packages/core/src/hook-context.ts`, `packages/agents/src/connect-sessions.ts`, `packages/agents/src/hook-capture.ts`, `packages/agents/src/maintain.ts`, `apps/cli/src/index.ts`
- **Evidencia:** grep main(): 14 scripts en packages (connect-*, link, seed, ingest, hook-*, lint-run/act, temporal-run, index-code, enrich-run, maintain, demo-capture, resolve-entities). Patrón `loadEnv(); import …` entre imports (connect-docs.ts:3-5, connect-github.ts:2-4, connect-notion-export.ts:3-5, connect-meeting.ts:3-5, link.ts:4-6) porque el orden de carga importa. connect-sessions.ts ejecuta wireReconciler() al IMPORTAR (línea 140), así que importar captureCondensedViaApi tiene efectos globales. apps/cli/src/index.ts:53-56 despacha mutando process.argv y confiando en guards `import.meta.url === argv[1]` (comentario en 4-8 admite la fragilidad).
- **Recomendación:** Mover los main() a apps/cli/src/commands/<cmd>.ts (finos: parseo de argv + llamada a la función de librería + salida), dejar en packages solo funciones exportadas sin side effects de import (wireReconciler debe llamarse desde el entrypoint), y hacer loadEnv() solo en entrypoints. Es la refactorización estructural principal y no añade capas nuevas.

### G10 · [🟡 Media] Esqueleto de conector copy-paste: mensaje de error, chunking y contadores repetidos en 4 conectores

- **Ficheros:** `packages/core/src/connect-docs.ts`, `packages/core/src/connect-github.ts`, `packages/core/src/connect-notion-export.ts`, `packages/agents/src/connect-meeting.ts`
- **Evidencia:** Literal '✗ Captura fallida (${r.status}): ${r.data.error ?? "¿cortex auth login / servidor en marcha?"}' en connect-docs.ts:62, connect-github.ts:90, connect-notion-export.ts:91. Bucle de subida por CHUNK con CORTEX_CAPTURE_CHUNK leído 2 veces (docs:19, notion:20), MAX_CONTENT=8000 duplicado (docs:18, notion:22), HEX32 en dos variantes (docs:20 `\s+[0-9a-f]{32}$`, notion:23 `\b[0-9a-f]{32}\b`), agregación added/existing repetida (docs:59-67, github:88-95, notion postBatch:88-95). Además 5 walkers recursivos de directorio: docs walk:22-32, notion walkMd:39-48, meeting walk:21-26, session-readers walkJsonl:45-54, code.ts walkRepo:71-101.
- **Recomendación:** Un connector-kit mínimo en core: walkFiles(dir, extFilter), uploadBatches(slug, items) (chunking + error estándar + contadores) y constantes compartidas. Cada conector queda en ~40 líneas de lógica propia.

### G11 · [🟡 Media] Configuración dispersa: ~60 variables de entorno leídas con process.env crudo en 27 ficheros, con defaults duplicados

- **Ficheros:** `packages/shared/src/env.ts`, `packages/core/src/auth.ts`, `packages/core/src/extract.ts`, `apps/cli/src/auth.ts`, `packages/core/src/api-client.ts`
- **Evidencia:** grep process.env: 27 ficheros, ~60 variables CORTEX_*/BREVO_*/NAN_* distintas, la mayoría sin pasar por getEnv/requireEnv de shared/env.ts. Defaults divergentes: CORTEX_SERVER_URL con fallback 'http://localhost:8787' en cli/auth.ts:17 pero SIN fallback en api-client.ts:28 (si no hay credentials ni env, los hooks no funcionan aunque el server esté en el puerto por defecto). auth.ts:17 documenta el patrón 'lazy por el orden de loadEnv' que el resto del repo no sigue (dedup.ts:17-18, extract.ts:36,114-115 leen a nivel de módulo).
- **Recomendación:** No hace falta un framework: un config.ts por paquete (o uno en shared) que centralice nombre+default+parseo de cada variable como funciones lazy, y prohibir process.env fuera de él. Documentar la lista en .env.example (verificar que esté completa).

### G12 · [🟡 Media] apps/web/src/index.ts es un god-file (716 líneas) que además duplica lógica de core

- **Ficheros:** `apps/web/src/index.ts`, `packages/core/src/projects.ts`
- **Evidencia:** 13 rutas + middleware + bootstrap + HTML con estilos inline (tablas de /usage con atributos style repetidos th/td/tdr:560-562) + un <script> de 50 líneas del grafo (651-701) en un solo fichero. accessibleProjects (69-74) duplica listAccessibleProjects (projects.ts:105-112) solo porque necesita otro shape ({entity, entryCount}); ambas hacen N+1 canAccessProject con SQL recursivo + isProjectMember por ancestro.
- **Recomendación:** Trocear por recurso (routes/auth.ts, routes/entries.ts, routes/projects.ts, routes/observability.ts…) reutilizando el mismo app Hono; eliminar accessibleProjects usando listAccessibleProjects + un join con entryCount en core. El JS del grafo a un fichero estático servido por Hono. No introducir framework de frontend.

### G13 · [🟡 Media] Código muerto y de demo exportado como API pública

- **Ficheros:** `packages/core/src/project-config.ts`, `packages/core/src/api-client.ts`, `packages/core/src/extract.ts`, `packages/agents/src/workflows.ts`, `packages/agents/src/demo-capture.ts`, `apps/web/src/index.ts`
- **Evidencia:** Sin ningún consumidor (grep en todo el repo): resolveProjectFromCwd (project-config.ts:58-76, además duplica el walk-up de readCortexLink:15-31), isAuthenticated (api-client.ts:30-32), SUPPORTED_DOC_EXTS (extract.ts:32), ingestSessionFile (connect-sessions.ts:194-228). Solo-demo: workflows.ts (captureContextWorkflow/runCaptureWorkflow, únicos usos en demo-capture.ts — la única pieza real de 'workflows Mastra' del repo), lint-act.ts (dry-run permanente). Compat legacy: rama ?token= en /auth/cli (web index.ts:91-97). isNearDuplicate (dedup.ts:47-50) solo se usa en tests.
- **Recomendación:** Borrar los 4 exports muertos y la rama legacy ?token=. Decidir la hipótesis Mastra-workflows (CLAUDE.md la declara 'a validar'): o el server/MCP usan runCaptureWorkflow de verdad, o eliminar workflows.ts+demo-capture.ts y dejar Mastra solo como runner de agentes. Registrar la decisión en docs/decisions.md.

### G14 · [🟡 Media] Lector de sesiones de Claude fuera de session-readers.ts y condensado duplicado

- **Ficheros:** `packages/agents/src/connect-sessions.ts`, `packages/agents/src/session-readers.ts`
- **Evidencia:** session-readers.ts implementa codex/opencode/hermes → RawSession[], pero el lector de claude (condenseSession + listado de ~/.claude/projects) vive en connect-sessions.ts:69-85 y duplicado en main():249-259; readSessions('claude',…) devuelve [] (session-readers.ts:159-164), lo que obliga al if especial en main(). Dos condensadores paralelos: condenseSession (turnos USUARIO/ASISTENTE, TURN_CHARS) vs condenseMessages ([role], MAX_MSG/MAX_TOTAL) con límites distintos para el mismo propósito.
- **Recomendación:** Mover readClaudeSessions a session-readers.ts (mismo contrato RawSession) y unificar en un solo condensador con límites configurables; main() queda con `sessions = await readSessions(platform, repo)` sin ramas.

### G15 · [🟡 Media] Tres vías de escritura paralelas con flags distintos (saveContext / saveWithReconciliation / captureBatch) sin un punto de entrada claro

- **Ficheros:** `packages/core/src/operations.ts`, `packages/core/src/dedup.ts`, `packages/core/src/capture.ts`
- **Evidencia:** saveContext(input, {useClassifier, detectImprovements, skipEmbedding}) es la base; saveWithReconciliation lo envuelve con dedup mem0 (dedup.ts:99-130); captureBatch lo llama con skipEmbedding:true y dedup incremental propio por sourceReference (capture.ts:37-61); el server elige una u otra por endpoint (/capture usa reconciliación, /capture/batch no), y la web /save llama saveContext pelado. Los flags se pasan con casts `as never` (capture.ts:56, server index.ts:153). Nadie puede saber qué combinación es la 'correcta' sin leer los 3 ficheros.
- **Recomendación:** Documentar (o encapsular) la matriz en un único módulo save.ts con dos funciones nombradas por intención: saveInteractive (clasifica+warnings) y saveIngested (batch, dedup por ref, embeddings por lotes, reconciliación opcional), y eliminar los casts tipando BatchItem con los enums de shared.

### G16 · [🟢 Baja] readStdin y argOf duplicados en hooks y CLI

- **Ficheros:** `packages/core/src/hook-context.ts`, `packages/agents/src/hook-capture.ts`, `apps/cli/src/auth.ts`
- **Evidencia:** readStdin idéntico en hook-context.ts:17-21 y hook-capture.ts:18-22 (paquetes distintos). argOf idéntico en hook-context.ts:23-26 y cli/auth.ts:40-43.
- **Recomendación:** Ambos a @cortex/shared (stdin.ts / argv.ts). Dos movimientos de 6 líneas.

### G17 · [🟢 Baja] Manejo de errores catch-and-swallow generalizado

- **Ficheros:** `packages/core/src/extract.ts`, `packages/core/src/api-client.ts`, `apps/web/src/index.ts`, `packages/core/src/dedup.ts`
- **Evidencia:** extract.ts:292-294 (extractFileText traga cualquier excepción y devuelve null), api-client apiGet:41-43 (null en cualquier fallo, sin distinguir 401 de red), web /pack:442-444 (catch{} → 404 genérico), dedup findNearest:42-44 (catch → null: un fallo de embeddings desactiva silenciosamente TODA la reconciliación). Coherente con la filosofía 'los hooks no rompen nada', pero indistinguible de un bug.
- **Recomendación:** Proporcional a prototipo: mantener la degradación pero loguear SIEMPRE una línea con contexto (`console.error('[x] …', e.message)`) como ya hacen usage.ts:60 y trace-exporter.ts:42, y en api-client distinguir al menos auth (401) de red para que los conectores den mensajes correctos.

### G18 · [🟢 Baja] Testabilidad limitada por singletons resueltos dentro de las funciones

- **Ficheros:** `packages/core/src/operations.ts`, `packages/core/src/projects.ts`, `packages/core/src/entities.ts`, `tests/integration/global-setup.ts`
- **Evidencia:** Solo hay unit tests de funciones puras (auth whitelist, slugify/readCortexLink, session-readers, schemas zod); todo lo demás exige el Postgres de tests/integration (global-setup levanta BD real). entities.ts y vectors.ts ya reciben `sql: Sql` como parámetro, pero operations/projects/dedup/queries llaman getSql() y getEmbeddingProvider() internamente, impidiendo pasar una transacción o un fake.
- **Recomendación:** Sin frameworks de DI: extender el patrón ya existente (primer parámetro sql, provider opcional) a operations/projects/dedup/queries manteniendo wrappers que resuelvan los singletons para los callers actuales. Suficiente para testear con una transacción rollback sobre la BD de integración.

### G19 · [🟢 Baja] Comentarios y docs desactualizados respecto al código

- **Ficheros:** `packages/core/src/hook-context.ts`, `CLAUDE.md`, `apps/mcp-server/src/server.ts`
- **Evidencia:** hook-context.ts:8-9: 'No usa el MCP…: va directo a la BD' pero la implementación usa apiGet('/context-pack…') (línea 42). CLAUDE.md §Estructura solo lista apps/mcp-server y apps/web (faltan apps/cli y apps/server) y dice 'las 5 tools corporativas' cuando buildMcpServer registra 8 (server.ts:54-244). curate.ts:23 filtra created_by='session-backfill' pero la vía principal de captura (hook→API) guarda created_by=email, con lo que la doc del fichero ('sobre el conocimiento AUTO-capturado') ya no describe lo que pasa.
- **Recomendación:** En el PR del refactor, actualizar CLAUDE.md (estructura real, nº de tools) y los docstrings citados; cambiar el criterio de autoCurate a sourceType='agent_session' (que sí identifica lo auto-capturado independientemente del autor).

---

<a id="área-h"></a>

## Área H — Capas y dependencias (transversal): grafo de imports, reglas declaradas en CLAUDE.md, inicialización de recursos, ciclos y testabilidad

**Diagnóstico:** El grafo de paquetes es acíclico y en general sano: shared (zod v3, sin deps) ← database ← embeddings ← core ← agents ← apps. GRAFO RESUMIDO: database→shared; embeddings→shared; core→{database,embeddings,shared, mammoth/xlsx/unpdf}; agents→{core,database,shared, @mastra/*, @ai-sdk/openai-compatible, zod v4, node-cron}; apps/mcp-server→{core,agents,shared,database(closeSql), @modelcontextprotocol/sdk, hono, zod v3}; apps/server→{core,agents,shared,database(closeSql), hono}; apps/web→{core,agents,shared,database(closeSql), hono}; apps/cli→solo import() dinámico de scripts de packages/*/src; scripts/cortex-sync→yaml+builtins. Se cumplen: core no importa agents/apps (la capa LLM se inyecta con setClassifier/setReranker/setReconciler desde los entrypoints), ninguna app hace SQL propio (solo usan closeSql para shutdown), y los schemas zod v3 (shared) y v4 (agents) no se cruzan (agents solo lee .options de los enums). Se violan o degradan: (1) core NO es determinista — packages/core/src/extract.ts hace llamadas LLM de visión, OCR y whisper vía fetch; (2) core y agents contienen ~15 entrypoints CLI mezclados con código de librería, la mayoría ejecutan main() incondicionalmente al importar; (3) core/api-client.ts + conectores crean un ciclo conceptual core→(HTTP)→apps/server→core y meten concerns de cliente CLI (leer ~/.cortex/credentials) en el paquete de dominio. Los recursos se crean como singletons módulo-globales elegidos por env (getSql, getEmbeddingProvider) y se consumen por import directo dentro de core, no por inyección, lo que junto con los side-effects de import (usage.ts registra el sink al importarse; connect-sessions ejecuta wireReconciler(); mcp-server/server.ts y web hacen setClassifier al cargar el módulo) es lo que de verdad impide testear core aislado sin Postgres. La configuración está dispersa en ~50 lecturas de process.env repartidas en 25+ ficheros con defaults duplicados. No hay ciclos de import estáticos.

### H1 · [🔴 Alta] ~15 entrypoints CLI mezclados con código de librería; la mayoría ejecutan main() incondicionalmente al importar el módulo

- **Ficheros:** `packages/core/src/lint-act.ts`, `packages/core/src/seed.ts`, `packages/core/src/link.ts`, `packages/core/src/ingest.ts`, `packages/core/src/connect-docs.ts`, `packages/core/src/connect-github.ts`, `packages/core/src/connect-notion-export.ts`, `packages/core/src/hook-context.ts`, `packages/agents/src/enrich-run.ts`, `packages/agents/src/hook-capture.ts`, `packages/agents/src/connect-meeting.ts`, `packages/agents/src/demo-capture.ts`, `apps/cli/src/index.ts`
- **Evidencia:** En packages/core/src: seed.ts:160 (¡TRUNCATE de todas las tablas si CORTEX_SEED_CONFIRM=1!), ingest.ts:91, link.ts:121-129 (con process.exit en finally), lint-run.ts:15, lint-act.ts:70, temporal-run.ts:12, index-code.ts:31, connect-github.ts:98, connect-docs.ts:71, connect-notion-export.ts:183, hook-context.ts:56-62 (process.exit(0)). En packages/agents/src: enrich-run.ts:32-41, demo-capture.ts:29, hook-capture.ts:43-51, connect-meeting.ts:64-73, maintain-worker.ts (top-level cron.schedule). Solo 3 usan el guard correcto `import.meta.url === file://argv[1]`: resolve-entities.ts:96, connect-sessions.ts:282, maintain.ts:89. Caso especialmente peligroso: lint-act.ts EXPORTA planLintActions (línea 21) y a la vez ejecuta main() top-level (línea 70) — importar la función dispara el CLI. apps/cli/src/index.ts:53-56 institucionaliza el patrón: hace `await import(script)` contando con que el script se ejecute al importar.
- **Recomendación:** Separar entrypoints de librería: o bien mover los CLIs a apps/cli/src/commands/*.ts (cada uno un fichero fino que importa la función de librería y llama main()), o bien como mínimo aplicar el guard import.meta.url a TODOS los que exportan algo (lint-act, y por seguridad seed/link). Los conectores (connect-*) son clientes de la API, no dominio: encajan mejor en apps/cli que en packages/core. Es un cambio mecánico y barato, proporcional a un prototipo.

### H2 · [🔴 Alta] core viola su regla declarada de determinismo sin LLM: extract.ts contiene llamadas de visión, OCR y whisper

- **Ficheros:** `packages/core/src/extract.ts`, `packages/agents/src/openrouter.ts`, `CLAUDE.md`
- **Evidencia:** CLAUDE.md declara '@cortex/core es determinista (sin LLM)'. packages/core/src/extract.ts:44-54 lee LLM_PROVIDER/NAN_API_KEY/OPENROUTER_API_KEY (visionConfig), :63-84 hace POST a chat/completions con modelo de visión (visionCall), :95-112 caption/OCR de imágenes, :118-140 OCR de PDFs escaneados, :153-233 transcripción whisper con troceado ffmpeg. No importa mastra/ai (usa fetch crudo), pero funcionalmente es capa LLM dentro de core, con su propia resolución de credenciales duplicada de agents/openrouter.ts (mismos defaults 'qwen3.6'/'deepseek/deepseek-v4-pro' en extract.ts:48,51 y openrouter.ts:29,39).
- **Recomendación:** Aplicar el mismo patrón de inyección que ya existe (setClassifier/setReconciler): que extract.ts acepte hooks opcionales (captionImage/ocr/transcribe) inyectados desde agents o desde los entrypoints, dejando en core solo la extracción determinista (docx/pdf-texto/xlsx/drawio). Alternativa más barata: mover extract.ts a agents y actualizar CLAUDE.md; lo insostenible es la regla escrita contradiciendo el código.

### H3 · [🔴 Alta] Side-effects al importar módulos: sinks, reconciliadores y clasificadores se cablean como efecto de import, no en el arranque

- **Ficheros:** `packages/core/src/usage.ts`, `packages/core/src/vectors.ts`, `packages/core/src/code.ts`, `packages/agents/src/connect-sessions.ts`, `apps/mcp-server/src/server.ts`, `apps/web/src/index.ts`
- **Evidencia:** packages/core/src/usage.ts:168-177 llama setEmbeddingUsageSink en top-level; vectors.ts:5 y code.ts:7 hacen `import "./usage.js"` SOLO por ese side-effect. packages/agents/src/connect-sessions.ts:140 ejecuta wireReconciler() en top-level (importar captureSessionViaApi desde hook-capture cablea el reconciler global). apps/mcp-server/src/server.ts:33-37 y apps/web/src/index.ts:45-49 hacen loadEnv()+setClassifier+setReranker en top-level del módulo. Consecuencia: el comportamiento de saveContext/searchContext depende de QUÉ módulos se hayan importado antes, y los tests no pueden importar core sin activar el sink que escribe en BD.
- **Recomendación:** Concentrar el cableado en una función explícita por entrypoint (p.ej. `wireLlm()` / `initCortex()`) llamada dentro de main(), y eliminar los `import './usage.js'` mágicos (exportar una función registerUsageSink() y llamarla en el arranque). Cero coste estructural, gran ganancia de previsibilidad y testabilidad.

### H4 · [🟡 Media] Resolución de proyecto duplicada 6 veces con DOS semánticas distintas (canonical_name vs name exacto)

- **Ficheros:** `packages/core/src/operations.ts`, `packages/core/src/queries.ts`, `packages/core/src/lint.ts`, `packages/core/src/code.ts`, `packages/core/src/dedup.ts`, `packages/core/src/capture.ts`, `packages/agents/src/connect-sessions.ts`
- **Evidencia:** findProjectId por canonical_name (canonicalize): operations.ts:380-386, queries.ts:182-188, lint.ts:21-26, code.ts:141-146. Por `name` EXACTO sin canonicalizar: dedup.ts:28-31, capture.ts:31, y connect-sessions.ts:132-135 (alreadyIngested, JOIN por p.name). Además projects.ts resuelve por slug/name con otra tabla de columnas. Un proyecto llamado 'Acme Portal' se encuentra con 'acme portal' en búsqueda/lint pero NO en dedup/captureBatch — la reconciliación puede no encontrar el proyecto y degradar silenciosamente a ADD (saveWithReconciliation: dedup.ts:103-106 con near=null).
- **Recomendación:** Extraer UNA función findProjectId(sql, ref) en projects.ts (aceptando slug|nombre, con canonicalize) y usarla en los 6 sitios. Es la duplicación con más riesgo funcional del repo.

### H5 · [🟡 Media] core/api-client.ts + conectores: concerns de cliente CLI dentro del paquete de dominio y ciclo conceptual core→server→core

- **Ficheros:** `packages/core/src/api-client.ts`, `packages/core/src/link.ts`, `apps/cli/src/auth.ts`, `apps/cli/src/ui.ts`
- **Evidencia:** packages/core/src/api-client.ts:17-29 lee ~/.cortex/credentials (artefacto de `cortex auth login`, un concern de la CLI) y hace fetch contra apps/server — que a su vez importa core. Los conectores de core (connect-docs.ts:5, connect-github.ts:4, connect-notion-export.ts:5) y hook-context.ts:1 son clientes de esa API. La misma lectura de credenciales está copiada 4 veces: api-client.ts:17-25, link.ts:20-28, apps/cli/src/auth.ts:25-32, apps/cli/src/ui.ts:19-26.
- **Recomendación:** Mover api-client.ts (y la lectura de credenciales, una sola vez) a un paquete/carpeta de cliente (p.ej. apps/cli/src/lib o packages/client) junto con los conectores. core quedaría solo con dominio server-side; la frontera 'quién habla por HTTP con quién' sería visible en el grafo de paquetes.

### H6 · [🟡 Media] Recursos como singletons módulo-globales por env, consumidos por import directo — core no es testeable sin Postgres real

- **Ficheros:** `packages/database/src/client.ts`, `packages/embeddings/src/index.ts`, `packages/core/src/operations.ts`, `packages/core/src/dedup.ts`, `packages/core/src/queries.ts`, `packages/core/src/projects.ts`
- **Evidencia:** getSql: singleton en database/client.ts:6-20, llamado directamente dentro de operations.ts:97, queries.ts:10, dedup.ts:29, projects.ts (todas), auth.ts:54… getEmbeddingProvider: singleton por env en embeddings/index.ts:11-51, llamado dentro de operations.ts:98, dedup.ts:38, capture.ts:62. Estado global mutable adicional: classifier/reranker (operations.ts:40,54), reconciler (dedup.ts:77), sink (usage-sink.ts:14), mastra (mastra.ts:74). Inconsistencia: vectors.ts y entities.ts SÍ reciben (sql, provider) por parámetro, pero sus llamadores los obtienen del singleton. Resultado observable: no hay ni un unit test de operations/dedup/queries; tests/integration/* requieren un Postgres real (global-setup.ts) y los unit tests solo cubren funciones puras (auth-env, domain, project-config, session-readers).
- **Recomendación:** Sin sobreingeniería (nada de contenedores DI): seguir el patrón que ya existe en vectors.ts/entities.ts y pasar `sql` (y provider donde aplique) como primer parámetro en operations/queries/dedup/projects/auth, resolviendo el singleton SOLO en los entrypoints. Con eso un fake de Sql/EmbeddingProvider basta para testear core en memoria.

### H7 · [🟡 Media] Configuración dispersa: ~50 lecturas de process.env en 25+ ficheros, con defaults duplicados y momentos de lectura inconsistentes

- **Ficheros:** `packages/shared/src/env.ts`, `packages/core/src/extract.ts`, `packages/core/src/auth.ts`, `packages/core/src/dedup.ts`, `packages/agents/src/openrouter.ts`
- **Evidencia:** Grep de process.env: 50+ hits repartidos por core (extract.ts ×5, auth.ts ×7, dedup.ts ×3, ingest.ts ×3, connect-*.ts ×6…), agents (connect-sessions ×4, session-readers ×3, openrouter ×2…) y apps. Mezcla de estilos: lectura lazy correcta (auth.ts:18-25, comentario explícito línea 17), constantes de módulo evaluadas al cargar (dedup.ts:17-18, ingest.ts:30-32, connect-docs.ts:17-19 — sensibles al orden de loadEnv), y helpers getEnv/requireEnv de shared. Defaults duplicados: NAN_BASE_URL 'https://api.nan.builders/v1' en embeddings/index.ts:34, extract.ts:48 y openrouter.ts:30; modelo 'deepseek/deepseek-v4-pro' en extract.ts:51 y openrouter.ts:39. loadEnv (shared/env.ts:15) resuelve el .env relativo al fuente del paquete: se rompe si se compila o se mueve shared.
- **Recomendación:** Un módulo config.ts por paquete (o uno en shared) con TODAS las claves tipadas y sus defaults en un solo sitio, leído de forma lazy. No hace falta zod ni validación exhaustiva para un prototipo; sí una única fuente de defaults.

### H8 · [🟡 Media] apps/web/src/index.ts es un god-file de 716 líneas (rutas + HTML inline + JS embebido + arranque)

- **Ficheros:** `apps/web/src/index.ts`, `apps/web/src/views.ts`
- **Evidencia:** apps/web/src/index.ts: middleware de sesión (108-114), 15+ rutas con plantillas HTML inline de 30-80 líneas cada una (dashboard 175-257, /usage 555-615, /graph con ~50 líneas de JavaScript de vis-network embebido en un template string 650-701), helper accessibleProjects que duplica listAccessibleProjects de core con un cast parcial `{ id: p.entity.id } as ProjectRef` (línea 72), y arranque del servidor (705-716). views.ts solo contiene una fracción de las vistas.
- **Recomendación:** Proporcional a una demo: trocear por rutas (routes/dashboard.ts, routes/usage.ts, routes/graph.ts…) moviendo el HTML de cada ruta a views/, y sustituir accessibleProjects por listAccessibleProjects de core (mapeando al shape que necesita la vista). No hace falta framework de frontend.

### H9 · [🟡 Media] Duplicación de algoritmos y utilidades entre ficheros (RRF, extractJson, retry, walk de directorios, walk-up de .cortex.json)

- **Ficheros:** `packages/core/src/vectors.ts`, `packages/core/src/code.ts`, `packages/agents/src/classify.ts`, `packages/agents/src/enrich.ts`, `packages/agents/src/connect-sessions.ts`, `packages/core/src/extract.ts`, `packages/core/src/project-config.ts`
- **Evidencia:** (1) Fusión RRF copiada: vectors.ts:117-145 (hybridSearch) y code.ts:186-218 (searchProjectCode), mismas constantes K=60 y estructura acc/ranked. (2) extractJson copiada 3×: classify.ts:39-45, enrich.ts:52-58, connect-sessions.ts:104-108 (+ variante inline en rerank.ts:27-29). (3) Retry exponencial 3×: embeddings/remote.ts:5-18 (postWithRetry), extract.ts:70-83 (visionCall), extract.ts:155-173 (postWhisper). (4) Recorrido recursivo de directorios 5×: code.ts:71-101 (walkRepo), connect-docs.ts:22-32, connect-notion-export.ts:39-48, connect-meeting.ts:21-26, session-readers.ts:45-54. (5) project-config.ts: readCortexLink (15-31) y resolveProjectFromCwd (58-76) son el mismo bucle walk-up con distinto retorno. (6) interface VisionCfg declarada dos veces en extract.ts (56-60 y 146-150). (7) Worker-pool ad-hoc (cursor++/Promise.all) 3×: ingest.ts:52-79, connect-notion-export.ts:123-159, enrich-project.ts:48-87.
- **Recomendación:** Consolidar solo lo que reduce riesgo: RRF a una función fuseRRF(vecRows, ftsRows, limit) en vectors.ts reutilizada por code.ts; extractJson a agents (un util); resolveProjectFromCwd eliminarla (muerta) y borrar la VisionCfg duplicada. El resto (walks, retries, pools) puede quedarse: unificar helpers triviales en un prototipo es opcional.

### H10 · [🟢 Baja] Código muerto y de demo: exports sin consumidores, workflow Mastra solo usado por la demo, comentarios obsoletos

- **Ficheros:** `packages/core/src/index.ts`, `packages/core/src/project-config.ts`, `packages/core/src/api-client.ts`, `packages/agents/src/workflows.ts`, `packages/agents/src/demo-capture.ts`, `packages/core/src/hook-context.ts`
- **Evidencia:** Exports del barrel de core sin ningún uso externo: resolveProjectFromCwd (project-config.ts:58, ni un import), apiBase/isAuthenticated (api-client.ts:27,30), sendOtpEmail (solo uso interno en auth.ts). isNearDuplicate solo se usa en tests/integration/core.test.ts. workflows.ts (captureContextWorkflow, 106 líneas, zod v4) solo lo consume demo-capture.ts — el pipeline real usa saveContext/saveWithReconciliation directamente, así que la hipótesis 'Mastra workflows' vive solo en la demo. CortexLink.project marcado 'legacy / back-compat' (project-config.ts:9). Docstring obsoleto en hook-context.ts:8-9: dice 'No usa el MCP… va directo a la BD' pero el código usa apiGet (línea 42) — el comentario contradice la implementación. seed.ts es data de demo (Acme) dentro de core/src.
- **Recomendación:** Podar el barrel (quitar los 4 exports muertos), decidir explícitamente si Mastra workflows se adopta o se elimina (registrar en docs/decisions.md — la CLAUDE.md lo llama 'hipótesis a validar'), y corregir el docstring de hook-context.ts. Mover seed.ts junto al resto de tooling si se hace la reorganización de entrypoints.

### H11 · [🟢 Baja] Manejo de errores estilo best-effort generalizado: catch-vacíos que tragan fallos también en rutas de ingesta

- **Ficheros:** `packages/core/src/extract.ts`, `packages/core/src/dedup.ts`, `packages/core/src/api-client.ts`, `packages/core/src/connect-docs.ts`
- **Evidencia:** extract.ts:292-294 (extractFileText envuelve TODO en try/catch{} → cualquier bug de parsing devuelve null indistinguible de 'no soportado'), extract.ts:78-80 y 168-170 (catch{} de red), dedup.ts:42-44 (findNearest catch → null: un fallo de embeddings convierte silenciosamente UPDATE/NOOP en ADD duplicado), api-client.ts:40-43 y 63-65 (null / ok:false sin causa), operations.ts:102 (classifier .catch(()=>null)), usage.ts:59-61 y trace-exporter.ts:41-43 (aceptable: observabilidad). Para hooks es una decisión correcta y documentada; en conectores/ingesta esconde pérdida de datos (connect-docs cuenta un fichero fallido como 'vacío/no soportado', línea 50).
- **Recomendación:** No hace falta jerarquía de errores: basta distinguir dos casos en extract/dedup ('no aplicable' vs 'falló') devolviendo p.ej. null vs throw, y loguear con console.error en los catch de conectores. Mantener el silencio absoluto solo en los hooks (hook-context/hook-capture), donde está justificado.

### H12 · [🟢 Baja] Frontera zod v3/v4 se respeta pero es frágil y no está protegida

- **Ficheros:** `packages/agents/package.json`, `packages/shared/package.json`, `apps/mcp-server/package.json`, `apps/mcp-server/src/server.ts`, `packages/agents/src/workflows.ts`
- **Evidencia:** agents usa zod ^4.4.3 (packages/agents/package.json) solo en workflows.ts:3; shared usa ^3.24.1; mcp-server añade su propio zod ^3.25.76 (lockfile resuelve 3.25.76 y 4.4.3). agents importa los schemas zod v3 de shared (classify.ts:1, enrich.ts:1, connect-sessions.ts:8) pero solo lee `.options` — no cruza schemas. mcp-server pasa `saveContextInput.shape` (instancia zod de shared) al SDK MCP (server.ts:63) — mismo major, funciona, pero son dos instancias de zod distintas y nada impide que un futuro cambio pase un schema de shared a Mastra (v4) o viceversa; la regla vive solo en un párrafo de CLAUDE.md.
- **Recomendación:** Barato y suficiente: alinear la versión de zod v3 de mcp-server con la de shared (una sola resolución v3), y un comentario en agents/workflows.ts recordando la frontera. Si el proyecto crece, un lint-rule de import (no-restricted-imports de 'zod' en agents salvo workflows) lo blindaría.

### H13 · [🟢 Baja] Grafo de dependencias detallado (informativo, sin defecto): direcciones reales de import y puntos de inyección

- **Ficheros:** `packages/agents/src/mastra.ts`, `packages/core/src/operations.ts`, `packages/core/src/dedup.ts`, `apps/mcp-server/src/server.ts`, `apps/server/src/index.ts`, `apps/web/src/index.ts`, `apps/cli/src/index.ts`
- **Evidencia:** ESTÁTICO (todas las aristas): shared→(zod v3); database→shared; embeddings→shared; core→{database, embeddings, shared, mammoth, xlsx, unpdf}; agents→{core (mastra.ts:5 recordUsage; workflows.ts:2 saveContext; enrich-project.ts:2; maintain.ts:2; connect-sessions.ts:5 apiPost+saveWithReconciliation; reconcile.ts:1 setReconciler; rerank.ts:1 type SearchHit; hook-capture.ts:3 readCortexLink; connect-meeting.ts:6 extractFileText), database, shared, @mastra/core, @mastra/observability, @ai-sdk/openai-compatible, zod v4, node-cron}; apps/mcp-server→{shared, core, agents, database(closeSql), @modelcontextprotocol/sdk, hono, zod v3}; apps/server→{shared, core, agents(isLlmEnabled, wireReconciler), database(closeSql), hono}; apps/web→{shared, core, agents, database(closeSql), hono}; apps/cli→import() dinámico de packages/{core,agents}/src y scripts/ (apps/cli/src/index.ts:17-30), sin imports estáticos de @cortex pese a declararlos en package.json. RUNTIME (inversiones controladas): core define seams y agents/apps las rellenan — setClassifier(classifyEntry) y setReranker(rerankLLM) en mcp-server/server.ts:34-37 y web/index.ts:46-49; setReconciler vía wireReconciler en server/index.ts:34 y connect-sessions.ts:140; setEmbeddingUsageSink lo rellena core/usage.ts:168 hacia embeddings. HTTP: core/api-client.ts y los connect-* llaman a apps/server (ciclo conceptual, no de import). Sin ciclos de import estáticos; pnpm ls confirma agents es el único con core como dependencia declarada.
- **Recomendación:** Mantener la dirección core←agents←apps y el patrón de seams; formalizar los tres 'wire' en una única función de bootstrap por app para que el grafo runtime sea tan legible como el estático.

---

