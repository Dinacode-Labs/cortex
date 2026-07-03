# Decisiones técnicas (ADR ligero)

> Cada decisión aquí es una **hipótesis de trabajo para la demo**, no una elección
> definitiva. El documento de planteamiento
> (`dinacode-cortex-contexto-y-plan-demo.md`) insiste en cuestionar y validar todo.
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
- **Resultado (LevelUp):** 266 vigentes / 147 históricos; point-in-time real
  (a 2026-05-28: 182 hechos; a 06-12: 239; ahora: 266).
- **Limitación:** las contradicciones entre entidades no se auto-invalidan (no hay
  "ganador" claro) — el lint las reporta para revisión humana.
- **Revisar cuando:** queramos decay adaptativo (por velocity/volatility) o
  invalidación por recencia en contradicciones.

## ADR-0013 · UI con el sistema de diseño de Dinacode

- **Estado:** aceptada (demo).
- **Contexto:** la UI usaba una paleta genérica (morado/oscuro). Dinacode tiene un
  design system en Open Design (`Dinacode Design System`, vinculado a
  `dinacode-web`).
- **Decisión:** aplicar los tokens del DS a la UI web (`apps/web/src/views.ts`):
  azul eléctrico `#0099ff`, tinta de marca `#01001c`, tipografías Inter +
  JetBrains Mono, rampa de radios/espaciado/sombras y componentes (cards, botones,
  chips, inputs) del DS. Cabecera con el logo Dinacode + tag "Cortex". Tema claro;
  lienzo del grafo en tinta de marca. Capturas del README regeneradas.
- **Fuente:** Open Design (`colors_and_type.css`, `DESIGN.md`, `assets/logo.svg`),
  extraído de `dinacode-web/src/app/globals.css`.
- **Revisar cuando:** queramos modo oscuro conmutable o extraer los tokens a un
  paquete compartido (`@cortex/ui`).

## ADR-0014 · Harness de IA distribuible (config/) y multi-agente

- **Estado:** aceptada (estructura); instalador pendiente.
- **Contexto:** §13. El valor está en que cualquier developer conecte SUS agentes a
  Cortex desde cualquier proyecto. El MCP ya es global (scope user); faltaba un
  bundle versionado y un plan de distribución multi-agente.
- **Decisión:** `config/` es la **fuente única versionada** del harness, separando
  lo compartido (`mcp/cortex.json`, `skills/`, `commands/`) de las instrucciones
  por agente (en `config/README.md`). Las capacidades viven como **tools MCP**
  (`mcp__cortex__*`), portables a cualquier agente con MCP; solo cambia el registro
  del MCP y el formato de skill/comando. Instalación **manual documentada** para
  **Claude Code, Codex y OpenCode**. Skills/comandos se activan por symlink desde
  `config/` a `~/.claude/` (global) o `.claude/` (proyecto).
- **Registry PR-able:** `config/toolbelt.json` es la fuente única del toolbelt de
  Dinacode (MCPs + skills + comandos). Se amplía/mejora **por PR** y se reparte con
  `cortex sync`. Cortex reparte **configuración, nunca credenciales** (cada entrada
  documenta su `auth`). Skills propias **vendorizadas** en `config/skills/`
  (excluyendo secretos); MCPs **declarados** por comando/URL (uvx/npx/http, sin copiar).
- **Instalador:** `cortex sync` (`scripts/cortex-sync.ts`, `pnpm cortex:sync`) —
  data-driven desde el manifiesto, idempotente, dry-run por defecto, `--apply`,
  `--doctor` (estado de auth por tool), `--agents`. **Preserva** lo ya configurado
  (no machaca auth existente) y **omite** MCPs sin su env. Detecta Claude/Codex/OpenCode/Hermes (Hermes: escribe mcp_servers en
  ~/.hermes/config.yaml en YAML, preservando lo existente).
  Skills por symlink → `git pull` actualiza; re-`--apply` re-registra. OpenCode best-effort.
- **Revisar cuando:** añadamos prompts/políticas corporativas, un `--remove`, o
  separemos el harness a un repo propio (`dinacode-ai-config`).

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
  un cliente "Boluda" con subproyectos `boluda-api`, `boluda-web`. Cada subproyecto es un
  **proyecto real** (slug, vínculo `.cortex.json`, permisos y recuperación propios →
  precisión), y el padre **agrupa y guarda el contexto compartido**.
- **Herencia de contexto:** `getContextPack(sub)` incluye las entradas del subproyecto
  **+ las de sus ancestros** (CTE recursiva sobre `parent_id`). Así "lo común de Boluda"
  llega a cada subproyecto sin mezclar el contexto de los subproyectos entre sí (evita el
  context-rot del modelo "todo en un proyecto").
- **Cascada de permisos:** `canAccessProject` recorre la cadena de ancestros: si el
  proyecto O algún ancestro es privado → restringido; concede acceso ser admin o
  dueño/miembro del proyecto o de **cualquier ancestro** (ser miembro de "Boluda" abre
  sus subproyectos).
- **Por qué no "Boluda = 1 proyecto con subcarpetas":** perdería precisión de
  recuperación (una sesión de `boluda-api` traería contexto de `boluda-web`), vínculo por
  repo y permisos finos. Por qué no plano: lo común se silaría/duplicaría.
- **Uso:** `cortex link --create "Boluda API" --parent boluda`.
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
