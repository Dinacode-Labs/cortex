# Decisiones técnicas (ADR ligero)

> Cada decisión aquí es una **hipótesis de trabajo para la demo**, no una elección
> definitiva. El documento de planteamiento
> (el plan interno de junio de 2026, hoy en el repo privado `ai-toolbelt`) insiste en
> cuestionar y validar todo.
> Este fichero registra qué hemos elegido *de momento*, por qué, y qué alternativas
> quedan pendientes de evaluar.

Formato: estado · contexto · decisión · alternativas · cuándo revisar.

---

## ADR-0001 · Monorepo con pnpm workspaces

- **Estado:** aceptada (demo).
- **Contexto:** §17 del plan propone monorepo para la demo. Varias piezas (shared,
  database, embeddings, agents, mcp-server, web) comparten tipos del dominio.
- **Decisión:** monorepo pnpm. Estructura `packages/*` (librerías) + `apps/*`
  (procesos ejecutables: mcp-server, api, web).
- **Alternativas:** repos separados (`cortex-api`, `cortex-mcp`, ...). Más overhead
  de versionado para una demo.
- **Revisar cuando:** la demo se convierta en producto multi-equipo.

## ADR-0002 · TypeScript en todo el stack

- **Estado:** aceptada (demo).
- **Contexto:** Mastra es TS-first (§9.1) y el MCP SDK oficial tiene buen soporte TS.
- **Decisión:** TS + ESM (`NodeNext`), ejecución con `tsx`, Node ≥ 20.
- **Revisar cuando:** aparezca una pieza con mejor encaje en otro runtime.

## ADR-0003 · Postgres + pgvector como base única (documental + vectorial)

- **Estado:** aceptada (demo).
- **Contexto:** §9.2/§9.4 recomiendan Postgres como centro y pgvector para
  simplicidad en la demo. Riesgo 1: no sobrediseñar.
- **Decisión:** una sola instancia Postgres 16 (imagen `pgvector/pgvector:pg16`) que
  almacena metadatos, entidades, relaciones, fuentes **y** embeddings (columna
  `vector`). Búsqueda por similitud con SQL (`<=>`, distancia coseno).
- **Alternativas:** Qdrant / Weaviate / Pinecone (vector DB dedicada). Aportan
  filtrado/escala pero añaden una pieza más a operar.
- **Revisar cuando:** el volumen o el rendimiento de búsqueda lo justifiquen.

## ADR-0004 · Grafo de conocimiento como modelo relacional (de momento)

- **Estado:** aceptada (demo).
- **Contexto:** §6/§9.3. El plan sugiere que para la demo no hace falta Neo4j.
- **Decisión:** representar el "grafo" con tablas `entities` + `relations` en
  Postgres. Las consultas relacionales (expansión por entidades) se hacen con SQL.
- **Alternativas:** Neo4j / Memgraph / ArangoDB. Útiles para travesías profundas.
- **Revisar cuando:** necesitemos consultas de grafo multi-salto frecuentes.

## ADR-0005 · Embeddings y LLM enchufables, con fallback local sin claves

- **Estado:** aceptada (demo).
- **Contexto:** el entorno de desarrollo puede no tener API keys. Queremos que la
  demo arranque sin configurar nada y que conectar un proveedor real sea trivial.
- **Decisión:** interfaz de proveedor de embeddings con tres implementaciones:
  `local` (determinista, por defecto, NO semántica — solo para probar el cableado),
  `openai` y `voyage`. El LLM (agentes Mastra) será igualmente configurable; sin
  clave se usan heurísticas locales donde sea posible.
- **Riesgo conocido:** los embeddings `local` no dan relevancia semántica real; la
  calidad de búsqueda solo se ve con un proveedor real. Documentado para la demo.
- **Revisar cuando:** fijemos proveedor oficial (coste/calidad multilingüe ES/EN).

## ADR-0006 · Mastra como runtime de agentes — validación parcial

- **Estado:** parcialmente validada. En uso para generación de texto; para salida
  estructurada usamos un cliente directo (ver ADR-0008).
- **Contexto:** decisión inicial del plan (§9.1). A validar: estructurado, MCP,
  workflows, observabilidad.
- **Decisión:** `@cortex/agents` usa el `Agent` de Mastra (`@mastra/core`) para el
  agente de **recuperación** (síntesis de respuesta en prosa), que funciona bien
  con DeepSeek vía OpenRouter.
- **Hallazgo:** la **salida estructurada** de Mastra (`structuredOutput`) se
  **colgaba** con DeepSeek V4 Pro vía OpenRouter (probablemente intenta modo
  `json_schema`, no soportado por el modelo). La generación de texto plano sí va.
- **Workflows:** `captureContextWorkflow` (§20.4) implementado con
  `createWorkflow`/`createStep` (classify → persist) y verificado. Demuestra el
  motor de workflows de Mastra con pasos observables. Ejecutable:
  `pnpm workflow:capture "<texto>" "<proyecto>"`.
- **Alternativas:** LangGraph, LlamaIndex Workflows, CrewAI, orquestación ad hoc.
- **Revisar cuando:** probemos otro modelo/proveedor o nuevas versiones de Mastra;
  ampliar a los demás workflows del §20.4 (context pack, dedup/contradicción batch).

## ADR-0007 · MCP como interfaz estándar hacia las herramientas de IA

- **Estado:** aceptada (demo).
- **Contexto:** §8. Claude Code primero, Codex/ChatGPT después, sin acoplar.
- **Decisión:** servidor MCP (TypeScript SDK oficial) que expone tools neutras:
  `save_project_context`, `search_project_context`, `get_project_context_pack`,
  `list_project_decisions`, `validate_context_entry`, `ask_project_context`.
- **Revisar cuando:** definamos auth/permisos por developer y proyecto.

## ADR-0008 · LLM vía OpenRouter (DeepSeek V4 Pro); estructurado por cliente directo

- **Estado:** aceptada (demo, de prueba).
- **Contexto:** necesitábamos un LLM para enriquecer captura y sintetizar
  respuestas. Disponible una key de OpenRouter.
- **Decisión:** `LLM_PROVIDER=openrouter` con `OPENROUTER_MODEL=deepseek/deepseek-v4-pro`.
  - **Clasificación/extracción (estructurada):** llamada directa a
    `chat/completions` con `response_format: json_object` + validación zod + 1
    reintento (DeepSeek es modelo de razonamiento: `max_tokens` amplio para que
    quede espacio al JSON tras el razonamiento).
  - **Síntesis de retrieval (texto):** `Agent` de Mastra.
- **Acoplamiento:** `@cortex/core` no depende de `@cortex/agents`; los entrypoints
  registran el clasificador con `setClassifier(...)` cuando hay LLM. Sin LLM, todo
  cae a heurísticas. Precedencia: input explícito > LLM > heurística.
- **Nota de versiones:** `@cortex/agents` usa zod v4 / AI SDK v6 (los exige Mastra),
  aislado del resto del repo que usa zod v3 (MCP SDK). No se cruzan schemas.
- **Revisar cuando:** fijemos proveedor/modelo definitivo (coste/calidad/latencia;
  DeepSeek razona y añade latencia).

## ADR-0009 · Búsqueda híbrida (vector + FTS + RRF) y rerank LLM

- **Estado:** aceptada (demo).
- **Contexto:** la búsqueda era solo vectorial densa. El léxico gana con IDs,
  nombres propios y jerga (frecuentes en consultoría). Mercado: híbrido + rerank
  es el estándar (Glean, Onyx, RAGFlow…). Ver competitive-landscape.md.
- **Decisión:** `searchContext` usa `hybridSearch` = candidatos vectoriales
  (pgvector) + léxicos (**FTS de Postgres**, columna `content_tsv` generada, config
  'spanish', índice GIN) fusionados con **Reciprocal Rank Fusion (RRF)**. Rerank de
  2ª etapa **opcional vía LLM** (qwen3.6), inyectado con `setReranker` desde los
  entrypoints; desactivable con `CORTEX_RERANK=off`.
- **Hallazgo:** el **reranker dedicado de nan** (`/v1/rerank`, Qwen3-Reranker-8B)
  dio resultados **poco fiables** (rankeó "receta de tortilla" por encima de docs
  de pagos). No se usa; rerank por LLM en su lugar.
- **Revisar cuando:** dispongamos de un reranker fiable (Cohere/Voyage) o mejore el
  de nan; evaluar `pg_search`/ParadeDB (BM25 real) frente a `ts_rank`.

## ADR-0010 · Lint del conocimiento (curado, patrón "LLM Wiki")

- **Estado:** aceptada (demo).
- **Contexto:** los loops del §12 estaban dispersos. El patrón "LLM Wiki" de
  Karpathy formaliza un paso **lint** (salud del conocimiento) que casi nadie
  implementa — diferenciador. Ver competitive-landscape.md.
- **Decisión:** `lintProject(project)` reporta por proyecto: contradicciones (del
  grafo), posibles duplicados (similitud vectorial), entidades huérfanas, baja
  confianza, histórico/obsoleto y **huecos** (áreas con incidencias pero sin
  decisiones documentadas). CLI (`pnpm --filter @cortex/core lint`), página web
  `/lint`.
- **Revisar cuando:** queramos que el lint **actúe** (no solo reporte): proponer
  fusiones, abrir tareas para los huecos, marcar obsoletos.

## ADR-0011 · Indexación de código por proyecto/cliente

- **Estado:** aceptada (demo).
- **Contexto:** el mayor hueco vertical (competitive-landscape.md): todos los
  líderes de código indexan el repo; nosotros solo teníamos contexto de proyecto.
  Para una consultora, el código de cada cliente debe vivir junto a su contexto.
- **Decisión:** tabla `code_chunks` (separada de context_entries) con chunks por
  ventanas de líneas (60/solape 10), embedding (pgvector) + FTS ('simple'),
  scoped por `project_id`. Walker que respeta ignores (node_modules, dist, .next,
  *.d.ts, lockfiles…) y cap de fichero/total. Búsqueda híbrida (vector+FTS+RRF)
  `searchProjectCode`. Reindexado idempotente por (proyecto, repo).
- **Consumo:** tool MCP `search_project_code`, página web `/code`, CLI
  `index-code`.
- **Limitaciones:** chunking por líneas (no sintáctico/Tree-sitter); los ficheros
  generados (p.ej. `api-schema*.ts`) dominan algo el ranking. A futuro: excluir
  generados, chunking sintáctico, code-graph/LSP (Serena), sync incremental
  (Merkle), y permitir indexar repos remotos (clonado).
- **Revisar cuando:** abordemos code-graph/símbolos o sync incremental.

## ADR-0012 · Grafo bi-temporal (validez en el tiempo, invalidar ≠ borrar)

- **Estado:** aceptada (demo). Patrón Zep/Graphiti (competitive-landscape.md).
- **Contexto:** en consultoría las decisiones cambian; servir conocimiento
  obsoleto es un riesgo. Faltaba modelar la validez temporal de los hechos.
- **Decisión:** columnas `valid_from`, `valid_to`, `observed_at` en
  `context_entries` y `relations` (`created_at` = recorded_at). `valid_to NULL` =
  vigente. **Invalidar = cerrar la ventana, nunca borrar** (`applyTemporalInvalidation`):
  estado `Histórico` de Plane (legacy) y supersesiones entrada→entrada cierran la
  ventana. Retrieval/context-pack devuelven **solo vigentes por defecto**; soportan
  consultas **point-in-time** (`asOf`) en web (`/pack`), MCP (`get_project_context_pack`)
  y core. Backfill de fechas reales desde Plane (creación/archivado) y chat.
- **Resultado (proyecto piloto):** 266 vigentes / 147 históricos; point-in-time real
  (a 2026-05-28: 182 hechos; a 06-12: 239; ahora: 266).
- **Limitación:** las contradicciones entre entidades no se auto-invalidan (no hay
  "ganador" claro) — el lint las reporta para revisión humana.
- **Revisar cuando:** queramos decay adaptativo (por velocity/volatility) o
  invalidación por recencia en contradicciones.

## ADR-0013 · UI: tokens de diseño neutros y marca configurable (revisado 2026-09)

- **Estado:** **revisada** (2026-09-09). Antes: «UI con el sistema de diseño de Dinacode».
- **Contexto:** la UI se construyó con los tokens del design system de Dinacode (azul
  eléctrico `#0099ff`, tinta `#01001c`, Inter + JetBrains Mono) y con el **wordmark SVG de
  Dinacode incrustado** en `layout.ts`, más el nombre «Dinacode Cortex» en el `<title>`, el
  login, el asunto del email de OTP y el contexto que se inyecta a los agentes. Al separar
  producto de empresa (ADR-0026) eso no puede seguir cableado: quien despliegue Cortex no
  debería heredar la marca de quien lo escribió.
- **Decisión:** los **tokens** de `styles.css` se quedan como paleta por defecto — no son
  propietarios (dos colores y dos tipografías libres) y rehacer el diseño no aportaría nada.
  La **marca sí es configuración**: `CORTEX_BRAND_NAME` (def. «Cortex») en el `<title>`, la
  cabecera, el login, el email de OTP, el contexto inyectado y la ayuda del CLI; logo
  opcional por `CORTEX_BRAND_LOGO_SVG` (inline) o `CORTEX_BRAND_LOGO_FILE` (ruta), y sin
  logo se pinta un wordmark de texto. El SVG de Dinacode sale del repo y pasa al repo
  privado; el despliegue de Dinacode lo monta como fichero. En la misma línea,
  `CORTEX_AUTH_DOMAIN` y `BREVO_SENDER` pierden su default con dominio de Dinacode.
- **Nota de seguridad:** el logo se inserta con `raw()`, así que se valida que parezca un
  SVG y no traiga `<script>`. Es configuración del operador (quien puede escribir la env ya
  controla el proceso), no entrada de usuario: la comprobación es una red contra el error
  tonto, no un sanitizador.
- **Alternativas:** un paquete `@cortex/ui` con temas (sobreingeniería para una sola UI
  SSR); tokens de color por env (ruido sin demanda real).
- **Revisar cuando:** un segundo operador pida colores propios (entonces sí,
  `CORTEX_BRAND_PRIMARY` y compañía), o la UI cambie de stack.

## ADR-0014 · El producto reparte SU harness; el toolbelt de la organización es un registry externo (revisado 2026-09)

- **Estado:** **revisada** (2026-09-10). Antes: «Harness de IA distribuible (config/) y
  multi-agente», donde `config/toolbelt.json` era «la fuente única del toolbelt de Dinacode».
- **Contexto:** `config/` mezclaba dos cosas de naturaleza distinta. Por un lado el harness
  **del producto**: el MCP de Cortex, la skill `cortex-capture` y el comando `/cortex-save`.
  Por otro, las herramientas **de Dinacode**: Plane, Atlassian, Notion, Bitbucket, MS Teams,
  Google Chat y sus skills vendorizadas con scripts propios. Lo segundo no puede vivir en un
  repo que va a abrirse, y tampoco tiene por qué: no es producto, es la configuración de una
  empresa concreta.
- **Decisión:** el repo de Cortex reparte **solo lo suyo** (`config/toolbelt.json` queda
  mínimo: MCP de Cortex, `cortex-capture`, `/cortex-save`). El toolbelt de una organización
  se declara en un **registry propio** con el mismo esquema y se instala con
  `cortex toolbelt sync <registry.json|url>`; el de Dinacode vive en
  `Dinacode-Labs/ai-toolbelt` (privado, ADR-0026). El esquema del registry se documenta en
  [`toolbelt-registry.md`](./toolbelt-registry.md) como parte del producto.
- **Lo que NO cambia:** `cortex sync` sigue siendo data-driven desde el manifiesto,
  idempotente, dry-run por defecto con `--apply`, con `--doctor` y `--agents`; preserva lo
  ya configurado (no machaca auth existente) y omite las entradas sin su env. Detecta Claude
  Code, Codex, OpenCode y Hermes. Sigue repartiendo **configuración, nunca credenciales**.
- **Alternativas:** dejar el toolbelt corporativo en el repo y filtrarlo al publicar
  (frágil: basta un despiste para filtrar rutas y nombres internos); eliminar la feature de
  toolbelt (perdería lo que ya funciona y es útil para cualquier equipo, no solo Dinacode).
- **Revisar cuando:** el plugin de Claude Code absorba el reparto de skills y comandos
  (entonces `config/` podría desaparecer del todo), o se quiera registry por proyecto.

## ADR-0015 · Capa de agentes con Mastra (Agents reales)

- **Estado:** aceptada.
- **Contexto:** §7 preveía varios agentes Mastra, pero la implementación usaba
  funciones LLM directas (`chat()`) porque el `structuredOutput` de Mastra se
  colgaba con DeepSeek vía OpenRouter (ADR-0006). Mastra quedaba infrautilizado
  (solo el workflow de captura).
- **Decisión:** re-arquitecturada la capa `agents` a **Agents de Mastra reales**
  (`mastra.ts`), uno por rol: `classifier`, `graph`, `reranker`, `retriever`. El
  LLM se accede vía `@ai-sdk/openai-compatible` (nan/OpenRouter, provider-agnóstico).
  Los roles que devuelven JSON usan un `fetch` que **fuerza `response_format:
  json_object`** (qwen3.6 NO respeta el `structuredOutput` de Mastra de forma fiable
  —inventa claves—, pero con json_object es rápido ~0.5s y válido). El `retriever`
  usa texto libre. Eliminado el cliente `chat()` directo; `openrouter.ts` queda solo
  como resolución de config.
- **Consecuencias:** honra §7; disponibles instructions/observabilidad/evals de
  Mastra por agente; misma fiabilidad y velocidad que antes. El workflow de captura
  (`workflows.ts`) ahora orquesta un Agent real.
- **Revisar cuando:** el modelo mejore la adherencia a `structuredOutput` (podríamos
  quitar el `fetch` y usar esquemas zod), o queramos `memory`/`tools` por agente.

## ADR-0016 · Observabilidad de coste/uso de IA

- **Estado:** aceptada. Dos capas (A propia + B Mastra).
- **Contexto:** no medíamos tokens ni coste de las llamadas a IA (LLM + embeddings).
  Con nan el coste es 0, pero hay que **medir consumo y poder estimar coste** si se
  cambia a OpenAI/Anthropic/Voyage (principio de trazabilidad §5.5).
- **Decisión (A — tracking propio):** tabla `llm_usage` (migración 0005) +
  `recordUsage()`/`getUsageSummary()` en `@cortex/core`. Cada Agent de Mastra
  registra tokens (`runAgent` captura `usage`); los embeddings emiten tokens por un
  **sink** (`@cortex/embeddings` es hoja, no acopla a core). Tabla de precios por
  modelo para **estimar** coste (nan = 0). Panel en la UI (`/usage`): totales,
  por operación/agente, por modelo y últimas llamadas.
- **Decisión (B — Mastra AI tracing):** los Agents se sirven desde una instancia
  `Mastra` con `Observability` (`@mastra/observability`) y un **exporter propio**
  (`CortexTraceExporter`) que persiste cada span (`agent_run → model_generation →
  model_inference…`) en la tabla `ai_traces` (migración 0006) de nuestra Postgres.
  Se descartó el storage propio de Mastra (`@mastra/pg`/`libsql`) por fricción
  (init `id`, spans no persistían); el exporter propio inserta inmediato (fiable en
  CLI). Los CLI llaman `shutdownObservability()` antes de `process.exit` para flushar.
  La UI `/usage` muestra coste (A) + **árbol de trazas** (B). model_chunk/step se
  filtran como ruido.
- **Revisar cuando:** queramos coste por proyecto (propagar `project`),
  presupuestos/alertas, una página de traza individual, o un bridge OTel/Langfuse
  (la config lo soporta). Pendiente menor: silenciar el warning de in-memory store de
  Mastra (no usamos su storage).

## ADR-0017 · Workflows de Mastra: evaluados y NO adoptados para la captura

- **Estado:** aceptada. Sustituye el «Workflows» de ADR-0006 y el matiz de ADR-0015.
- **Contexto:** el spike `captureContextWorkflow` (§20.4, `packages/agents/src/workflows.ts`
  + comando `demo-capture`) demostraba el motor de *workflows* de Mastra
  (`createWorkflow`/`createStep`) orquestando la captura como pasos observables
  (classify → persist). Era un ~140 LOC de demostración: el pipeline **real** de
  captura nunca lo usó (lo consumía solo `demo-capture`).
- **Decisión:** **no adoptar** los workflows de Mastra para la captura y **borrar** el
  spike (`workflows.ts` + `demo-capture.ts` + el script `workflow:capture`). La captura
  usa la vía **determinista de `core`** (`saveWithReconciliation`: dedup/reconciliación
  con el reconciler LLM **inyectado** vía `setReconciler`), más simple y sin acoplar la
  captura al runtime de workflows de Mastra.
- **Qué se mantiene:** Mastra **sí** se usa para los **agentes individuales**
  (`classify`/`enrich`/`rerank`/`synthesize`/`distill`) vía `runAgent` (`mastra.ts`).
  Esto no cambia. Lo descartado es solo el runtime de *workflows*, no los *Agents*.
- **Por qué:** el paso classify → persist ya vive en `core` (clasificador inyectado con
  `setClassifier`, reconciliación con `setReconciler`); el workflow lo duplicaba con la
  API de Mastra (zod v4) sin aportar valor operativo. Menos código, menos acoplamiento.
- **Revisar cuando:** aparezca un caso de **orquestación multi-paso real** (varios pasos
  con estado/reintentos/observabilidad por paso, p.ej. context-pack o dedup/contradicción
  en batch) que justifique reintroducir el runtime de workflows.

## Vinculación de proyectos: slug + gate server-side (vincular ≠ crear)

- **Decisión:** un repo se vincula a un proyecto de Cortex con un `.cortex.json`
  **`{ "slug": "..." }`**. El **slug** es la clave de vínculo: único por proyecto,
  estable, **independiente de git**, asignado por Cortex al crear el proyecto.
- **Por qué slug y no git:** git no es fiable como identidad — un repo puede ser
  **monorepo** (un remote, varios proyectos lógicos), una **carpeta con varios git**
  dentro (varios remotes), o estar **sin clonar / con solo uno abierto** (no hay remote
  local). El slug es explícito y resuelve los tres casos (un `.cortex.json` por carpeta
  vinculada).
- **Gate inverso (vincular ≠ crear):** los hooks resuelven el slug → proyecto vía
  `resolveLinkedProject` que **NO crea**. Si el slug no existe en Cortex (o hay opt-out
  `{ "ignore": true }`, o no hay `.cortex.json`), **no fluye nada**. Hay que crear+vincular
  deliberadamente. Comando `cortex link` (`packages/core/src/link.ts`): `--create` crea
  el proyecto en Cortex y escribe el `.cortex.json`; `<slug>` vincula a uno existente;
  `--ignore` opt-out. Usa `INIT_CWD` (pnpm cambia el cwd al paquete).
- **Migración 0008:** `entities.slug` (único parcial donde `type='project'`) + backfill
  de los existentes (slugify del nombre).
- **Permisos/compartición:** el proyecto pasa a ser entidad gestionada (slug + dueño +
  miembros). El gate (resolver slug → ¿existe? ¿permiso?) es el punto natural para RBAC,
  pero **auth/membership es un diseño aparte** (necesita modelo de usuarios). Base lista.
- **Revisar cuando:** lleguen los permisos (gate por usuario), o queramos que el
  **save del MCP y los conectores** también exijan slug+permiso (hoy el gate cubre los
  hooks, que es el camino ambiente/automático y de mayor riesgo; el save por MCP/
  conector sigue siendo deliberado y aún puede auto-crear por nombre).

## Jerarquía de proyectos: padre/cliente con herencia y cascada

- **Decisión:** un proyecto puede tener un **padre** (`entities.parent_id`). Caso típico:
  un cliente "Acme" con subproyectos `acme-api`, `acme-web`. Cada subproyecto es un
  **proyecto real** (slug, vínculo `.cortex.json`, permisos y recuperación propios →
  precisión), y el padre **agrupa y guarda el contexto compartido**.
- **Herencia de contexto:** `getContextPack(sub)` incluye las entradas del subproyecto
  **+ las de sus ancestros** (CTE recursiva sobre `parent_id`). Así "lo común de Acme"
  llega a cada subproyecto sin mezclar el contexto de los subproyectos entre sí (evita el
  context-rot del modelo "todo en un proyecto").
- **Cascada de permisos:** `canAccessProject` recorre la cadena de ancestros: si el
  proyecto O algún ancestro es privado → restringido; concede acceso ser admin o
  dueño/miembro del proyecto o de **cualquier ancestro** (ser miembro de "Acme" abre
  sus subproyectos).
- **Por qué no "el cliente = 1 proyecto con subcarpetas":** perdería precisión de
  recuperación (una sesión de `acme-api` traería contexto de `acme-web`), vínculo por
  repo y permisos finos. Por qué no plano: lo común se silaría/duplicaría.
- **Uso:** `cortex link --create "Acme API" --parent acme`.
- **Revisar cuando:** queramos herencia también en `search`/`ask` (hoy solo en el pack),
  límites de profundidad, o mover contexto compartido a un tipo "client" del grafo.

## Handshake `cortex ui`: ticket de un solo uso (no el token en la URL)

- **Decisión:** `cortex ui` no abre el navegador con el token de larga vida en la URL
  (quedaría en historial/logs/referer). En su lugar pide al servidor un **ticket de un
  solo uso** corto (`POST /auth/ui-ticket`, autenticado con el token de CLI) y abre
  `/auth/cli?ticket=…`. La web **canjea** el ticket (`redeemUiTicket`, UPDATE atómico
  `used_at` → un solo uso) por una **sesión web NUEVA** (cookie httpOnly) distinta del
  token de CLI. Así el token de CLI nunca llega al navegador.
- **Migración 0012:** tabla `ui_tickets` (hash, user, expires_at, used_at). TTL corto
  (`CORTEX_UI_TICKET_TTL_SEC`, def 90 s).
- **Compat:** `/auth/cli?token=` se mantiene (legacy) pero `ticket` es lo preferido.
- **Verificado:** cookie ≠ token CLI; reuso del ticket → 401; canje atómico (un solo uso).

## Transporte HTTP del MCP (Streamable HTTP, autenticado)

- **Decisión:** el MCP de Cortex deja de ser solo **stdio** (local). Se añade transporte
  **HTTP** (Streamable HTTP, variante Web-standard del SDK: `WebStandardStreamableHTTPServerTransport`,
  `handleRequest(Request)→Response`, integra directo con Hono). `apps/mcp-server`:
  `index.ts` (stdio) y `http.ts` (HTTP) comparten `buildMcpServer()` (las 8 tools).
- **Auth:** el endpoint `/mcp` exige el **mismo token Bearer** que la API
  (`validateToken`); sin token → 401. Sesiones en memoria (un `McpServer` por sesión,
  `mcp-session-id`); `initialize` crea la sesión. `CORTEX_MCP_AUTH=off` para desarrollo.
- **Por qué Web-standard y no Node req/res:** encaja con Hono (`c.req.raw`) sin puentes;
  y mantiene el MCP en `apps/mcp-server` (zod v3 aislado), sin mezclarlo con apps/server.
- **Verificado:** sin token → 401; initialize → session-id + serverInfo; tools/list → 8 tools.
- **Identidad del Bearer en las tools — hecho:** el HTTP construye el server con el
  usuario (`buildMcpServer(user)`); las tools atribuyen (`created_by`=email) y aplican
  permisos (acceso al proyecto), igual que hooks/conectores. La sesión queda ligada al
  usuario (otro token no reutiliza su session-id). Verificado: privado ajeno→denegado, save→created_by=email.
- **Revisar cuando:** persistencia de sesiones multi-nodo
  (eventStore), o montarlo tras el mismo dominio que la API.

## Despliegue: docker-compose (imagen única, un comando por servicio)

- **Decisión:** stack desplegable en `deploy/docker-compose.yml`: Postgres (pgvector) +
  `migrate` (aplica el esquema y sale; los demás esperan a `service_completed_successfully`)
  + `server` (API/auth, 8787) + `web` (UI, 8080) + `mcp` (MCP HTTP, 8788) + `worker`
  (mantenimiento programado). **Una sola imagen** (`Dockerfile`, node:22 + pnpm + tsx, sin
  build) reutilizada por todos; el comando lo fija cada servicio.
- **Config:** `deploy/.env` (no commiteado) — `DATABASE_URL` al servicio interno
  `postgres`, `CORTEX_PUBLIC_URL`/dominio (el servidor inyecta esa URL en `/install.sh`),
  auth (admin/dominio/Brevo) y proveedores.
- **Verificado:** la imagen construye; BD limpia → migrate aplica 0001–0012; server
  conecta y responde `/health`; `/install.sh` sirve con la URL pública.
- **Revisar cuando:** se ponga tras proxy/HTTPS real (Traefik/Caddy/Coolify), se quiera
  compilar en vez de tsx, o separar la imagen por servicio.

## Refactor de arquitectura por fases (revisión 2026-07)

- **Decisión:** tras la revisión de arquitectura de julio 2026 (informe y ~70 hallazgos
  en [`refactor/`](./refactor/README.md)), se ejecuta un refactor **incremental por
  fases** (A: parches de riesgo y unificaciones; B: entrypoints fuera de `packages/*` y
  `core` sin LLM; C: apps testeables y split de la web; D: splits internos, config y
  poda). **No** se rediseña: el grafo de paquetes es sano y la inversión de dependencia
  LLM (`setClassifier`/`setReranker`/`setReconciler`) ya es el patrón correcto — se
  completa y se protege con las **reglas de dependencia** formalizadas en `CLAUDE.md`.
- **Qué se descarta deliberadamente** (anti-sobreingeniería, razonado en el informe):
  DDD táctico (entities/aggregates/repositories formales), ORM/query-builder, contenedor
  de DI, capa de "services" entre handlers y core, framework de frontend, microservicios,
  node-pg-migrate/drizzle, índices HNSW/dimensión fija ya. Máximo un paquete nuevo
  (`auth`, al final de la fase D).
- **Disciplina:** un PR por paso con `typecheck` + `test` + `test:integration` en verde;
  no se mergea sin CI; la vara de cada paso es "elimina un bug o una clase de bugs".
- **Por qué:** el prototipo se construyó en días con vibecoding y los problemas reales
  son locales (entrypoints mezclados, duplicación con bugs funcionales, side effects de
  import, god-files), no de esqueleto. Cada abstracción extra debe justificar su coste
  en un producto que sigue siendo hipótesis.
- **Revisar cuando:** el producto pivote (las fases C-D son posponibles; A-B eliminan el
  riesgo real), o al cerrar cada fase (marcar los pasos en el plan).

## UI: seguir en Hono SSR estructurado (sin SPA ni htmx, con umbrales)

- **Decisión:** la UI web se queda en **Hono SSR** y se estructura (fase C del refactor):
  `createApp()` + `routes/` por recurso + vistas con `html` de `hono/html` (autoescape
  por defecto; elimina el escapado manual con `esc()` y la clase de bug del XSS de
  `/graph`) + estáticos en `public/` con `serveStatic`. **No** se adopta SPA
  (Vite+Preact/React) ni meta-framework ni htmx todavía.
- **`apps/web` y `apps/server` NO se fusionan** y la web **no** consume la API JSON:
  sirven a clientes distintos (navegador/cookie vs CLI-hooks/Bearer) y ambos son
  consumidores finos de `@cortex/core`; su duplicación real se elimina extrayendo
  helpers compartidos (guard de acceso, wiring LLM, boilerplate de servidor), no
  acoplando deploys.
- **Por qué:** toda la interacción actual son formularios GET/POST con recarga completa
  y una única isla de JS (el grafo). Una SPA obligaría a duplicar ~15 operaciones de
  core como API JSON, auth de navegador, build y segundo deploy — coste permanente sin
  beneficio presente.
- **vis-network por CDN (unpkg), no vendorizado**: para una demo interna, anotar la
  dependencia de red externa aquí es más barato y reversible que meter ~500KB al repo;
  si la demo debe funcionar offline, vendorizarlo es un movimiento de un fichero.
- **Umbrales para subir de nivel** (para que la decisión no se re-litigue por impulso):
  1. **htmx / parciales** cuando haga falta el primer refresco parcial real (validar
     entradas sin recarga, auto-refresh de `/usage`, búsqueda en vivo). `GET /api/graph`
     ya es el precedente de endpoint JSON parcial.
  2. **Preact+Vite (isla o SPA)** solo si el grafo evoluciona a explorador interactivo
     con estado de cliente, o la UI pasa de demo interna a producto.
- **Revisar cuando:** se cruce cualquiera de los dos umbrales, o la UI gane un segundo
  consumidor (móvil, embebida) que exija API JSON de todas formas.

## Resolución de proyecto por nombre: semántica canónica única

- **Decisión:** la resolución de un proyecto por nombre en operaciones de datos usa UNA
  única función (`findProjectIdByName`, en `packages/core/src/projects.ts`) con semántica
  **canónica** (`canonical_name`: minúsculas, sin acentos). Se eliminan las 6 copias que
  convivían en core, dos de ellas con semántica de `name` **exacto** (dedup y
  captureBatch), que dejaban la reconciliación/dedup silenciosamente inoperante si el
  caller usaba otra capitalización ("Acme Portal" vs "acme portal" → siempre ADD).
  Test de integración que lo demuestra: `tests/integration/core.test.ts`
  ("resolución de proyecto canónica").
- **Cambio de comportamiento (intencionado):** capturas que antes fallaban el dedup por
  grafía ahora reconcilian (más UPDATE/SUPERSEDE/NOOP sobre datos existentes), y
  `captureBatch` acepta el nombre con cualquier capitalización.
- **Fuera de alcance:** `findProjectByName` (devuelve `ProjectRef`, por `name` exacto)
  se mantiene — la usan la web y `resolveLinkedProject`; se revisará con el guard de
  acceso único de la fase C-1 (`checkProjectAccess`).
- **Revisar cuando:** llegue C-1, o si aparece la necesidad de resolver por slug y nombre
  en una sola función.

## Credenciales y api-client únicos en `shared` (excepción de I/O consciente)

- **Decisión:** la lectura/escritura de `~/.cortex/credentials` y el cliente HTTP de la
  API (`apiGet`/`apiPost`) viven en `@cortex/shared` (`credentials.ts`, `api-client.ts`)
  como ÚNICA copia. Antes: 4 parsers de credenciales con 3 interfaces `Creds` distintas
  (cli/auth, cli/ui, core/api-client, core/link) y el cliente HTTP DENTRO de core
  (dirección de dependencia opuesta al resto del paquete). El default de
  `CORTEX_SERVER_URL` queda unificado (`DEFAULT_SERVER_URL`), y `cortex auth`/`cortex ui`
  leen env vía `getEnv` (antes ignoraban el `.env` del repo). Se elimina
  `isAuthenticated` (muerto, sin consumidores).
- **Por qué en shared y no en un paquete `client`:** shared es el único paquete visible
  a la vez desde core (conectores), agents (connect-sessions) y apps/cli; un paquete
  nuevo para 2 ficheros sería sobreingeniería (regla "máximo un paquete nuevo" del plan,
  reservada para `auth`). Es una excepción CONSCIENTE a "shared sin I/O": si crece
  (más módulos cliente), extraer `packages/client` es mover 2 ficheros.
- **Revisar cuando:** los conectores se muden a `apps/cli` (fase B-1) — quizá entonces
  el único consumidor fuera del CLI sea agents y convenga reubicar.

## Extracción multimodal vía hook `setMediaExtractor` (core sin LLM de verdad)

- **Decisión:** `core/extract.ts` queda solo con la extracción **determinista**
  (docx/pdf-con-capa-de-texto/xlsx/drawio, filtros); el caption de imágenes, el OCR de
  PDF escaneado y la transcripción whisper viven en `agents/media.ts` y se inyectan con
  `setMediaExtractor` (mismo patrón que classifier/reranker/reconciler), cableado por
  `wireLlm()`. La config LLM (`getLlmConfig`/`isLlmEnabled`) se unifica en
  `shared/llm-config.ts` (antes duplicada entre `agents/openrouter.ts` y el
  `visionConfig` de extract) y `SUPPORTED_EXTS` no cambia: sin hook, los formatos de
  media devuelven `null` igual que antes sin API keys.
- **Por qué:** era la última violación de la regla «core determinista, sin LLM»
  declarada en CLAUDE.md; el patrón de hook ya existía y no añade capas nuevas.
- **Matiz de comportamiento:** la config de visión/whisper se resuelve UNA vez en
  `wireLlm()` (tras `loadEnv`), no en cada llamada como hacía `visionConfig()`;
  equivalente en todos los flujos reales (los entrypoints cablean tras cargar el env).
- **Revisar cuando:** se añada otro proveedor de visión/ASR con config distinta a la
  del LLM de chat, o un formato nuevo cuya extracción necesite modelo.

## Política única de acceso: `checkProjectAccess` / `checkEntryAccess` (inexistente → not_found)

- **Decisión:** el control de acceso vive en UN sitio (`packages/core/src/projects.ts`)
  con retorno discriminado `ok | not_found | forbidden`, y cada capa lo traduce (MCP →
  `errorText`; API → JSON 404/403; web → página 404 / `deniedPage`). La política para
  proyecto/entrada **inexistente es `not_found` (denegar)** — antes convivían tres
  semánticas: la web era *fail-open* (auditoría, backlog #4), el MCP dejaba pasar y la
  API devolvía 404.
- **Excepción deliberada (escritura por nombre):** `save_project_context` (MCP) y
  `POST /save` (web) tratan `not_found` como «el proyecto se creará» — el save por
  nombre auto-crea proyecto (comportamiento de producto ya documentado en el ADR de
  vinculación; `forbidden` sí deniega). Revisar junto a ese ADR si el save pasa a exigir
  slug+permiso.
- **Cambios observables:** consultas web/MCP sobre proyectos con typo pasan de listar
  «como si nada» a 404; `/relate` con entryId inexistente → 404. Además se corrige
  `CORTEX_MCP_AUTH=off`: el usuario sintético con email `""` denegaba TODOS los privados;
  ahora auth off ⇒ `buildMcpServer(undefined)` (sin guards ni atribución, como stdio).
- **Apps testeables:** `createApp()` puro en web/server/mcp-http (entrypoints finos con
  `loadEnv → wireLlm → serve`), smoke tests de guards con `app.request()` en
  `tests/integration/apps.test.ts`, y sweep de sesiones MCP (`lastSeen` + intervalo
  `unref` + tope `CORTEX_MCP_MAX_SESSIONS`, TTL `CORTEX_MCP_SESSION_TTL_SEC`).
- **Revisar cuando:** la web pase a resolver por slug (hoy por nombre), o el save
  MCP/web exija slug+permiso.

## Búsqueda/ask sin proyecto: scoping a proyectos accesibles (fix P0)

- **Decisión:** `searchContext` (y `askProjectContext`) aceptan un `opts.restrictToAccessibleOf`
  (email o null). Sin proyecto concreto y con ese opts presente, la búsqueda se restringe a
  los ids de `listAccessibleProjects(email)` (default-deny); email null → solo públicos.
  Con proyecto concreto el guard de acceso ya controla. Sin opts (llamada confiable, p.ej.
  stdio MCP local) no hay restricción. Cierra el backlog #1 (P0): antes, buscar sin proyecto
  desde MCP HTTP o la web devolvía entradas de proyectos privados ajenos.
- **Implementación:** el scoping vive en core (`vectors.ts` filtra `project_id = ANY(ids)`;
  array vacío → cero filas, fail-closed). Las entradas con `project_id NULL` quedan excluidas
  de la búsqueda restringida (fail-closed): son globales y solo visibles por la ruta confiable.
- **Distinción clave:** `"restrictToAccessibleOf" in opts` separa "no restringir" (opts ausente)
  de "restringir a públicos" (valor null) — un truthy check no bastaría.
- **Revisar cuando:** aparezcan entradas globales legítimas que deban buscarse por usuarios
  (hoy toda escritura de las apps va asociada a un proyecto), o se quiera scoping también en
  las tools que hoy exigen proyecto.

## ADR-0018 · Identidad (auth+email) permanece en `@cortex/core` (packages/auth NO extraído)

- **Decisión:** el contexto de identidad (`auth.ts`: OTP, tokens, tickets, `isAdmin`;
  `email.ts`: Brevo) se **queda en core**, NO se extrae a un `packages/auth` propio.
  Evaluado en el refactor (paso D-4) y descartado.
- **Por qué:** el beneficio es **puramente topológico** (que core no "contenga" identidad);
  las apps ya consumen auth vía el barrel de core sin fricción, y no hay bug ni cambio de
  comportamiento en juego. El coste sí es real: paquete nuevo + `tsconfig` + dos configs de
  vitest + grafo pnpm + romper el `core→isAdmin` de `projects.ts`. Para un prototipo
  pre-validación y un equipo pequeño, la churn no compensa la pureza. Alineado con el
  principio del encargo: patrones que aportan valor, sin sobreingeniería.
- **Revisar cuando:** el repo crezca a varios equipos/servicios y la identidad gane peso
  propio (rotación de tokens, SSO, multi-tenant), o si se decide blindar las reglas de
  dependencia con `no-restricted-imports` y core→identidad estorbe. Entonces la extracción
  es mecánica (mover 2 ficheros + `isAdmin`/`isAllowedEmail` puros a `shared`).

## ADR-0019 · Tres vías de escritura de contexto (matriz documentada, no unificada)

- **Decisión:** conviven tres funciones de escritura en core, cada una para una intención
  distinta; se **documenta la matriz** en vez de forzar una unificación prematura.
  - `saveContext(input, opts)` — escritura **directa**: clasifica (LLM opcional), resume,
    extrae entidades, embebe y corre los loops de mejora. La usa la UI web (`/save`) y es la
    base de las otras dos.
  - `saveWithReconciliation(input, opts)` — escritura **reconciliada** (estilo mem0:
    ADD/UPDATE/SUPERSEDE/NOOP contra lo existente del mismo `sourceType`). La usan la API
    `/capture` y el backfill de sesiones (conocimiento auto-capturado que puede refinar o
    superar lo previo). Nunca reescribe fuente/curado.
  - `captureBatch(project, items, createdBy)` — ingesta **por lotes** de conectores:
    persiste sin embedding e indexa por lotes al final; incremental por `sourceReference`;
    sin clasificador LLM.
- **Por qué no unificar (todavía):** las tres cubren intenciones legítimamente distintas
  (fricción baja vs anti-duplicado vs rendimiento de lotes). Colapsarlas en
  `saveInteractive`/`saveIngested` es un rediseño de API con riesgo; para un prototipo,
  documentar cuál usar aporta el 90% del valor.
- **Revisar cuando:** un cuarto caso de escritura aparezca, o la divergencia entre las tres
  cause bugs (hoy comparten `saveContext` como base, así que el drift es bajo).

## ADR-0020 · FTS en español (`plainto_tsquery('spanish')`) — limitación conocida

- **Decisión:** la rama léxica de la búsqueda híbrida usa la config FTS `'spanish'` de
  Postgres (stemming en español), pese a que el contenido real es **mixto ES/EN** (código,
  jerga técnica, PRs en inglés). Se documenta como límite consciente, no se cambia ahora.
- **Por qué:** el producto es de una consultora hispanohablante y el grueso del conocimiento
  de negocio es español; el stemming inglés sobre términos técnicos aporta poco. Un FTS
  multi-idioma real (detección por entrada, columnas `tsvector` por idioma, o `simple` +
  n-gramas) es trabajo no justificado a esta escala. La rama vectorial (semántica) cubre en
  parte el idioma cruzado.
- **Revisar cuando:** se mida recall pobre en consultas/contenido en inglés, o el corpus
  vire a mayoría inglés. Alternativa: `tsvector` por idioma o `simple` + trigram.

## ADR-0021 · Tabla de precios de LLM hardcodeada en `usage.ts` — coste 0 silencioso

- **Decisión:** la estimación de coste (`recordUsage`/`getUsageSummary`) usa una tabla
  `PRICING` fija en `packages/core/src/usage.ts`; un modelo **no listado** cae a
  `{ in: 0, out: 0 }` → coste estimado **0** sin aviso. Se documenta; no se mueve a config
  ni se alarma ahora.
- **Por qué:** con el proveedor por defecto (nan, gratis) el coste real es 0, así que la
  estimación solo importa al conectar OpenAI/Anthropic/OpenRouter de pago. La observabilidad
  de tokens (lo que de verdad se mide) es correcta; el coste es orientativo. Mantener los
  precios como código es aceptable mientras la lista sea corta.
- **Revisar cuando:** se use un proveedor de pago en serio: entonces mover `PRICING` a config
  (o a la BD, versionada por fecha) y **loguear un aviso** cuando un modelo no tenga precio,
  para no reportar $0 engañoso. Anotar la fecha de los precios.

## ADR-0022 · Schemas zod de fila usados solo como tipos (mapeo manual)

- **Decisión:** los schemas zod de `@cortex/shared/domain.ts` que describen filas
  (contextEntry, entity, relation, source) se usan **solo como tipos TypeScript**; el mapeo
  `snake_case → camelCase` desde Postgres se hace a mano en `packages/core/src/map.ts`, sin
  `.parse()` en el borde. Se mantiene así (no se degradan a interfaces ni se fuerza la
  validación en runtime).
- **Por qué:** las filas vienen de nuestra propia BD con esquema controlado por migraciones,
  no de entrada externa; validar cada fila con zod en el camino caliente de lectura añade
  coste sin proteger de nada real (el borde no confiable —API/formularios— sí valida con zod,
  ver `apps/server` C-3). Los schemas como tipos dan el chequeo estático sin el coste runtime.
- **Consecuencia asumida:** `entity` en el schema puede quedar desincronizado del esquema real
  (le faltan slug/visibility/parent_id, añadidos por migraciones posteriores); no rompe nada
  porque nadie lo `.parse()`a, pero conviene sincronizar el tipo si se usa para construir
  filas. **Revisar cuando:** un schema de fila se use para VALIDAR datos que entren (no salgan)
  de la BD, o el drift tipo↔esquema cause un bug.

## ADR-0023 · Estrategia de modelos LLM (por rol) y chunking; salida de NaN

- **Estado:** **parcialmente sustituida por [ADR-0024](#adr-0024--nan-se-queda-proveedor-openai-compatible-genérico-y-routing-por-rol-sobre-nan)**
  (2026-09): la salida de NaN no ocurrió, así que los puntos 1 y 3 (proveedor: todo-OpenRouter
  + OpenAI para embeddings/STT) quedan superados. **Siguen vigentes** el routing por rol (2),
  el chunking (4) y la disciplina de evals (5). Documento completo con costes, benchmarks y
  métodos: [`research/llm-model-strategy.md`](./research/llm-model-strategy.md).
- **Contexto:** (1) los 7 agentes Mastra comparten **un único modelo** (`getLlmConfig()`
  no distingue rol), desaprovechando que cada rol tiene criticidad distinta (un fallo del
  reconciler/merger/distiller destruye conocimiento; uno del rerank solo molesta).
  (2) **Perdemos el acceso a NaN próximamente**, que servía 4 patas: chat, embeddings
  (`qwen3-embedding`), visión y whisper — incluso para desarrollo. (3) El chunking de
  documentos está roto (§5 del doc): un doc entra como 1 entry / 1 vector **truncado a
  8.000 chars** (`connect-docs.ts`), así que ingerir documentación larga no sirve.
  (4) Objetivo: calidad media-alta sin dispararnos de coste, y **aprender a hacerlo por
  nuestra cuenta** sobre pgvector propio (no un RAG gestionado).
- **Decisión:**
  1. **Salir de NaN → OpenRouter (chat/visión) + OpenAI (embeddings/STT).** Un mismo
     proveedor (OpenAI) cubre embeddings y whisper. El proveedor `local` (feature-hash
     léxico, no semántico) queda solo para tests/CI, no para relevancia real.
  2. **Routing por rol** vía `CORTEX_MODEL_<ROLE>` (fallback al default) + `CORTEX_VISION_MODEL`
     separado: `deepseek-v4-flash` (classifier/graph/rerank, mecánico), `deepseek-v4-pro`
     (reconciler/merger/distiller, juicio), `grok-4.5` (retriever, superficie visible).
  3. **Embeddings: `text-embedding-3-large`** (multilingüe, corpus en español). Voyage
     `voyage-3.5` como *upgrade* solo si un eval lo justifica.
  4. **Chunking:** estructural (800–1.200 tokens, respetando headings/páginas) + Contextual
     Retrieval (Anthropic) + parent-document; arreglar el truncado a 8k.
  5. **Medir, no opinar:** set de mini-evals de retrieval (recall@5/MRR) antes/después de
     cada cambio (ver ADR-0009 y §7 del doc).
- **Alternativas descartadas:** **todo-NaN** e **híbrida NaN+OpenRouter** (dependían de NaN,
  que se retira; la resiliencia se cubre con `models:[...]` de OpenRouter). **Embeddings
  locales/MiniLM**: MiniLM es inglés-céntrico y gama media sobre corpus ES y arrastra al
  dedup; cualquier local bueno (bge-m3/e5) añade runtime nativo en Node — se deja como
  contingencia on-prem, no como plan. **Vertex/RAG gestionado**: costes de suelo, lock-in y
  es justo lo que queremos aprender a hacer nosotros.
- **Coste:** ~$20/mes (10 devs) recurrente; ingerir el backlog existente son **decenas de $
  una vez** (embeddings puros ~$0.13/M tokens; el pipeline de enriquecimiento es el grueso
  pero opcional/gradual). Detalle en §3 y §3.1 del doc.
- **Consecuencias asumidas:** (a) **dependencia dura de API keys** — sin NaN ni local
  semántico, Cortex necesita OpenRouter+OpenAI también en desarrollo (gestionar keys y
  topes de gasto). (b) Los umbrales de dedup (0.82/0.95, ADR-0009) se calibraron para
  qwen3-embedding (4096-dim); con 3-large (3072-dim) hay que **recalibrar una vez** —
  sin migración de datos, porque hoy solo hay embeddings de prueba. (c) Activa el
  **"revisar cuando" de [ADR-0021]**: al usar proveedor de pago en serio, mover `PRICING`
  a config y avisar del $0 engañoso de modelos sin precio. (d) El soporte de `nan` en
  `llm-config`/`embeddings` se puede **podar** al confirmar la baja.
- **Revisar cuando:** los precios/benchmarks cambien (revisar catálogo al fijar modelos —
  cambian rápido); aparezca un sustituto claro de DeepSeek v4 (la config por rol hace el
  cambio trivial — esa es la apuesta arquitectónica real); un cliente exija on-prem/no-API
  (entonces bge-m3/e5 local) o SLA de hyperscaler (reconsiderar Vertex).

---

## ADR-0024 · NaN se queda: proveedor `openai-compatible` genérico y routing por rol sobre NaN

- **Estado:** aceptada (2026-09-09). Sustituye la parte de **proveedor** de ADR-0023 (puntos 1
  y 3); mantiene su routing por rol (2), chunking (4) y evals (5).
- **Contexto:** ADR-0023 se escribió asumiendo que perderíamos el acceso a NaN, y de ahí salió
  el plan de migrar todo a OpenRouter + OpenAI. **No ha ocurrido**: NaN (api.nan.builders,
  cluster OpenAI-compatible con suscripción) sigue disponible, con cuotas amplias a
  septiembre de 2026 — `deepseek-v4-flash` 3B tokens/mes con 1M de contexto, visión y tool
  calling; `glm5.3-flash` 2B; `mimo-v2.5` 1B; `qwen3.8-flash` 500M; `qwen3-embedding` de 4096
  dimensiones; `whisper`; `kokoro`; endpoint de rerank — y límites por clave de 60 rpm y
  **5 peticiones concurrentes**. Además, `nan` estaba cableado como un `case` dentro de
  `llm-config.ts` y `embeddings/index.ts`: un vendor concreto incrustado en paquetes
  genéricos, lo que impedía apuntar a Ollama, vLLM o LM Studio (el requisito on-prem que
  ADR-0023 dejaba como contingencia).
- **Decisión:**
  1. **Proveedor genérico `openai-compatible`** para chat (`LLM_PROVIDER`, `LLM_BASE_URL`,
     `LLM_API_KEY`, `LLM_MODEL`) y embeddings (`EMBEDDINGS_*`, con `EMBEDDINGS_DIM`
     obligatorio porque la dimensión define el esquema vectorial). NaN pasa a ser un
     **ejemplo de configuración**, no un caso del código. `nan` queda como **alias de
     compatibilidad** durante una versión: traduce las `NAN_*` con un aviso y se retira en
     0.2.0. Endpoints locales sin auth requieren `LLM_ALLOW_NO_KEY` explícito, para que una
     clave olvidada no se confunda con "es local".
  2. **Routing por rol sobre NaN:** `deepseek-v4-flash` para classifier, graph, reranker y
     visión (`CORTEX_VISION_MODEL`), y también para reconciler, merger y distiller
     (alternativa de más juicio: `glm5.3-flash`); `qwen3-embedding` para embeddings, lo que
     **evita recalibrar los umbrales de dedup** de ADR-0009 (seguimos en 4096 dimensiones);
     `whisper` vía `CORTEX_STT_*`. `CORTEX_MODEL_<ROL>` admite ahora `proveedor:modelo`, así
     que el **retriever** —el único rol cuya salida ve el usuario— puede ir a OpenRouter
     (`openrouter:x-ai/grok-4.5`) mientras el resto se queda en NaN. Por defecto, todo NaN.
  3. **Semáforo de concurrencia** `CORTEX_LLM_CONCURRENCY` (def. 4) en `@cortex/shared`,
     compartido por chat, visión, STT y embeddings, porque el límite del proveedor es por
     clave y no por tipo de endpoint. Sin él, `enrich`/`maintain` con concurrencia 8 dispara
     429 en ráfaga y el backoff cuesta más de lo que ahorra el paralelismo.
  4. **Precios:** la tabla sigue en código (ADR-0021) con los modelos de NaN a 0 (la
     suscripción hace que el coste marginal por token sea cero), más un
     `CORTEX_PRICING_JSON` opcional para corregir o dar de alta precios sin desplegar. Cierra
     el «revisar cuando» de ADR-0021.
- **Alternativas descartadas:** *podar `nan` y ejecutar ADR-0023 tal cual* — coste recurrente
  y dependencia de claves de pago hasta para desarrollar, sin ninguna ganancia de calidad
  medida; *mantener `nan` como caso propio* — impide el uso on-prem y deja el vendor dentro
  de paquetes que deberían ser genéricos.
- **Consecuencias:** sin migración de datos (mismo modelo de embedding, misma dimensión). El
  coste recurrente vuelve a ser 0 para Dinacode y la observabilidad de tokens sigue midiendo
  volumen. El proveedor `local` queda solo para tests y para arrancar sin claves.
- **La clave del servidor es una membresía personal (decidido 2026-09-10).** La cuota de NaN
  es *por miembro*, y el servidor de Cortex la consumirá para todo el equipo. Se asume a
  sabiendas, con dos argumentos: el volumen real medido hasta ahora es pequeño frente a los
  3B tokens/mes de `deepseek-v4-flash`, y Cortex se va a publicar como open source, lo que
  encaja con el espíritu del cluster. **Riesgos que quedan abiertos**, y conviene tenerlos
  presentes en vez de darlos por resueltos: (a) es una interpretación nuestra de lo que
  NaN considerará aceptable, no algo que hayan confirmado; (b) si NaN lo objeta o cambia sus
  condiciones, hay que poder migrar rápido — por eso importa que el proveedor sea genérico y
  que el routing por rol se cambie solo con `.env`; (c) el consumo va contra la cuota de una
  persona concreta, así que conviene mirar `llm_usage` de vez en cuando y no dar por hecho
  que el margen es infinito.
- **Revisar cuando:** NaN cambie cuotas o catálogo (verificar antes de fijar modelos en el
  `.env`); se quiera *streaming* para `glm5.3-flash` (su guardrail global de 800K tpm lo
  recomienda y `runAgent` hoy no lo usa); aparezca un cliente con requisito on-prem (probar
  Ollama/vLLM con este mismo proveedor); o toque retirar el alias `nan` (0.2.0).

---

## ADR-0026 · Separación producto/empresa: el material corporativo a un repo privado, sin reescribir la historia

- **Estado:** aceptada (2026-09-10).
- **Contexto:** el repo contenía cosas que no son producto: el plan fundacional (marcado
  como confidencial, con estrategia de negocio), un workshop interno con sus assets, el
  wordmark de Dinacode, las skills de las herramientas internas (Plane, Bitbucket, MS
  Teams, Google Chat) y, repartidas por la documentación, referencias a clientes reales por
  su nombre y a compañeros del equipo como responsables de tareas. Cortex va a abrirse como
  open source y a operarlo gente de fuera.
- **Decisión:**
  1. Todo lo corporativo se mueve a **`Dinacode-Labs/ai-toolbelt`** (privado): registry
     completo, skills internas, `docs/internal/` (plan fundacional, workshop, assets,
     branding y el roadmap con responsables) y los valores de despliegue de Dinacode.
  2. En Cortex se **neutralizan** las referencias a clientes y personas: «un cliente real»,
     «el proyecto piloto», «Acme». Se conserva el dato técnico (las cifras de bi-temporal
     siguen siendo las medidas de verdad) y se pierde solo quién era el cliente. Las dos
     migraciones ya aplicadas que citan nombres en un comentario **no se tocan**: editar una
     migración aplicada es peor práctica que el comentario que arregla.
  3. **No se reescribe el historial** (`git filter-repo`). El repo sigue siendo privado, así
     que el material solo es visible para quien ya tiene acceso; reescribir invalidaría todos
     los clones y rompería las referencias a PRs que hay en `docs/refactor` y en los propios
     ADR. La apertura se hará desde una **instantánea limpia** —repo público nuevo con un
     commit inicial— y no publicando este historial. Si algún día hiciera falta limpiarlo:
     `git filter-repo --invert-paths --path <fichero>` en un clon fresco, force-push, todos
     re-clonan y se pide a GitHub que purgue los objetos cacheados.
  4. `.gitignore` bloquea las rutas del material interno para que no vuelva por descuido.
- **Alternativas:** filtrar al publicar en vez de separar ahora (frágil: basta un despiste);
  una carpeta `private/` dentro del monorepo (se acaba filtrando y no resuelve el problema
  de que el instalador clona el repo entero en la máquina de cada dev).
- **Consecuencias:** quien trabaje en Cortex y necesite el plan fundacional lo busca en el
  repo privado. El despliegue de Dinacode monta su logo con `CORTEX_BRAND_LOGO_FILE`
  (ADR-0013 revisado) en vez de tenerlo incrustado en el código.
- **Revisar cuando:** se fije la fecha de apertura (el procedimiento de instantánea limpia
  debe quedar escrito en `CONTRIBUTING.md` antes), o se detecte otro dato sensible.

---

## ADR-0028 · Email transaccional enchufable (`log | brevo | smtp`)

- **Estado:** aceptada (2026-09-09).
- **Contexto:** el OTP —única puerta de entrada al producto— solo sabía salir por Brevo:
  `email.ts` tenía el endpoint cableado, el remitente por defecto era de Dinacode y no
  había forma de usar otro emisor. Un operador sin cuenta de Brevo no podía autenticar a
  nadie. Además el fallo se descubría tarde: sin `BREVO_API_KEY` el sistema se limitaba a
  imprimir el código por consola, lo que en producción es un fallo silencioso de seguridad
  (los códigos acaban en el log) disfrazado de "modo dev".
- **Decisión:** interfaz `EmailSender` en `@cortex/core` con tres implementaciones: `log`
  (imprime, no envía; default sin configurar), `brevo` (API) y `smtp` (nodemailer, con
  import perezoso para que solo lo cargue quien lo use). Selección por
  `CORTEX_EMAIL_PROVIDER`, remitente en `CORTEX_EMAIL_FROM` (obligatorio con brevo/smtp;
  `BREVO_SENDER` sigue valiendo como alias), y `setEmailSender()` para tests u overrides.
  `validateEmailConfig()` corre **al arrancar el servidor**: lanza si el proveedor elegido
  no puede funcionar y avisa si en producción los OTP solo se loguean.
- **Por qué la selección vive en core y no en los entrypoints**, a diferencia del
  classifier/reranker/reconciler: el único consumidor es `requestOtp`, en este mismo
  paquete, y la elección es configuración pura sin dependencias externas. Pasarla por los
  cuatro entrypoints sería ritual sin ganancia; el punto de inyección que sí hace falta
  (tests) lo cubre `setEmailSender`.
- **Alternativas:** inyectarlo desde los entrypoints como el resto de hooks (descartado,
  arriba); añadir ya Resend o SES (se añaden como implementaciones el día que hagan falta,
  el contrato es de tres líneas).
- **Consecuencias:** `packages/core` gana una dependencia (`nodemailer`), pero solo se
  carga en el camino SMTP. El contrato de la línea que imprime el modo `log` (contiene el
  código de 6 dígitos) queda fijado por tests: los de integración del flujo de auth lo
  capturan de ahí.
- **Revisar cuando:** haya más correos que el OTP (entonces plantillas e i18n), o se pida
  cola/reintentos de envío.

---

## ADR-0029 · Licencia Apache-2.0 y gobernanza mínima antes de abrir el código

- **Estado:** aceptada (2026-09-10).
- **Contexto:** el repo no tenía licencia, ni política de seguridad, ni plantillas
  (backlog #79). Sin licencia, «público» equivale a «todos los derechos reservados»: nadie
  puede usarlo legalmente, así que es lo primero que hay que resolver antes de abrirlo.
- **Decisión: Apache-2.0.** Comprobadas una a una las licencias de las dependencias
  directas: Apache-2.0 (Mastra, AI SDK, OpenRouter provider, TypeScript, xlsx), MIT (Hono,
  SDK de MCP, unpdf, zod, nodemailer con MIT-0, tsx, vitest), BSD-2 (mammoth), ISC (node-cron,
  yaml) y Unlicense (postgres). Ninguna copyleft, así que Apache-2.0 es compatible con todas.
  Frente a MIT aporta dos cosas que aquí interesan: **concesión expresa de patentes** (con
  cláusula de retirada si alguien demanda) y una **cláusula de marca** que evita que un
  tercero use el nombre para respaldar un fork. Se añaden `LICENSE`, `NOTICE` y `license`
  en los diez `package.json`.
- **Gobernanza:** `SECURITY.md` (dónde reportar, plazo de 5 días laborables, alcance
  explícito y qué queda fuera por ser configuración de despliegue), Contributor Covenant
  2.1, plantillas de issue y PR con el checklist de `CONTRIBUTING.md`, y Dependabot semanal
  agrupando minor/patch. `CHANGELOG.md` con formato Keep a Changelog.
- **`pnpm audit` en CI: informativo, NO bloqueante.** Hoy hay 18 vulnerabilidades altas y
  todas son **transitivas** de `mammoth` (8), `@modelcontextprotocol/sdk` (7) y
  `@mastra/core` (3): ninguna es de código nuestro y no podemos arreglarlas hasta que esos
  proyectos publiquen. Un gate rojo desde el primer día se acaba desactivando o ignorando,
  y entonces no protege de nada. Se deja visible en cada build y Dependabot abre los PRs.
- **`xlsx` desde el CDN de SheetJS** (`cdn.sheetjs.com`, 0.20.3, Apache-2.0) en vez de npm:
  la versión de npm (0.18.5) está abandonada y arrastra CVE-2023-30533 (prototype pollution)
  y CVE-2024-22363 (ReDoS) sin corregir. Misma API, cero cambios de código, y los tests de
  `extract` siguen pasando. **Contrapartida asumida:** Dependabot no sigue tarballs por URL,
  así que toca revisarlo a mano cada trimestre (anotado en `SECURITY.md` y en el propio
  `dependabot.yml`).
- **Alternativas:** MIT (igualmente compatible, pero sin patentes ni protección de marca);
  sustituir `xlsx` por `exceljs` (el uso es solo `sheet_to_csv`, sería un porte de diez
  líneas, pero añade una dependencia más pesada sin necesidad hoy); AGPL o BSL (frenarían la
  adopción, y no hay un modelo de negocio que las justifique).
- **Revisar cuando:** se fije un modelo comercial (SaaS, OEM) que pida otra licencia; un
  contribuidor externo pida un CLA; o `mammoth`/MCP SDK/Mastra publiquen y el audit pueda
  pasar a bloqueante de verdad.
