# Revisión de arquitectura y plan de refactor — julio 2026

> **Encargo:** revisar la arquitectura del prototipo (construido en días, con vibecoding,
> sin pruebas reales) y refactorizar hacia **código limpio y modular, sin sobreingeniería**.
> Este documento es el informe y el plan; los ~70 hallazgos con evidencia `fichero:línea`
> están en el anexo [`hallazgos.md`](./hallazgos.md).
>
> **Metodología:** workflow multiagente — 8 lectores en paralelo (6 por subsistema + 2
> transversales: duplicación y capas), 3 propuestas de refactor independientes (incremental,
> hexagonal ligero, frontend) y un crítico anti-sobreingeniería que verificó los hallazgos
> clave contra el código. Foto a 2026-07-03 sobre `main` (9b43a87).
>
> **Relación con [`docs/audit/`](../audit/README.md)** (auditoría integral de junio): son
> complementarias. Aquélla audita el *producto* (seguridad, datos, memoria vs SOTA, ops);
> ésta audita la *estructura del código* de cara al refactor. Donde coinciden hallazgos se
> indica el número del [backlog](../audit/99-backlog-priorizado.md) (p.ej. `backlog #5`).

## Veredicto

La arquitectura de fondo del monorepo es **más sana de lo que aparenta**: el grafo de
paquetes es acíclico y correcto (`shared → database/embeddings → core → agents → apps`),
la inversión de dependencia LLM ya existe (`setClassifier`/`setReranker`/`setReconciler`),
las tres apps HTTP no se duplican entre sí, y stdio/HTTP del MCP comparten el registro de
tools. **No hace falta rediseñar; hace falta terminar la arquitectura que ya está medio
hecha** y limpiar lo que el vibecoding dejó dentro de cada paquete.

Los problemas estructurales reales son cinco:

1. **~15 entrypoints ejecutables** (`main()` + `process.argv` + `process.exit`) viven
   dentro de `packages/core` y `packages/agents`; el CLI los despacha por **ruta de
   fichero** mutando `process.argv`. Los packages no son librerías puras. (Hallazgos A3,
   B3, F1, G-H.)
2. **`@cortex/core` es tres cosas**: el dominio de memoria (✔ debe quedarse), un contexto
   de identidad completo (auth OTP + tokens + email Brevo) y un lado *cliente* (api-client
   HTTP + credentials) que apunta en la dirección de dependencia opuesta. Además incumple
   su regla declarada «determinista, sin LLM»: `extract.ts` llama a visión/OCR/whisper
   directamente. (A1, A4.)
3. **Duplicación con consecuencias funcionales**: 7 lookups de proyecto con **dos
   semánticas** (`canonical_name` vs `name` exacto) que dejan la reconciliación/dedup
   silenciosamente inoperante según la capitalización; 4 implementaciones del control de
   acceso con políticas inconsistentes (y `POST /save` de la web sin guard, `backlog #3`);
   4 lectores de credentials; 3 copias de `extractJson` (+1 variante inline); 2 fusiones
   RRF; ~60 env vars leídas en ~27 ficheros con defaults divergentes. (A2, G1-G3, F5.)
4. **Side effects al importar**: el sink de usage se registra con `import "./usage.js"`,
   `wireReconciler()` corre a nivel de módulo, y el ritual `loadEnv()+setClassifier+…`
   está copiado con variaciones en cada entrypoint. El comportamiento depende del orden
   de imports. (A7, H3.)
5. **La UI web es un god-file**: [`apps/web/src/index.ts`](../../apps/web/src/index.ts)
   (716 LOC) concentra bootstrap, auth, 16 rutas, render por template literals con `esc()`
   manual (~90 call-sites, con un XSS reflejado real en `/graph`, `backlog #5`), CSS en
   string y JS de cliente embebido. (D1-D3.)

Y de pasada aparecieron **bugs de comportamiento** (no solo código feo): el XSS de
`/graph`, el lookup de dedup, `POST /save` sin guard, `lint-act.ts` ejecuta su CLI al ser
importado, y el fallback del reconciliador ante fallo del LLM es `'update'` (un timeout
puede reescribir conocimiento existente).

## Decisiones de arquitectura

Traducción para quien viene de MVC/DDD: **los handlers de Hono y las tools MCP son los
controllers, `@cortex/core` es el modelo/dominio, y cada app es un adapter de entrada**
(UI, API REST, MCP, CLI). El patrón objetivo es *hexagonal ligero* — el que el repo ya
intenta ser — **sin DDD táctico**: no hay invariantes ni casos de uso que justifiquen
aggregates/repositories formales, ORM o contenedor de DI a esta escala (~9k LOC).

Decisiones registradas en [`decisions.md`](../decisions.md):

- **Reglas de dependencia entre paquetes** (tabla en [`CLAUDE.md`](../../CLAUDE.md)):
  10 líneas que blindan todo lo demás.
- **La UI sigue en Hono SSR estructurado** (no SPA, no htmx todavía), con **umbrales
  escritos** para subir de nivel. `apps/web` y `apps/server` **no se fusionan**.
- Un solo paquete nuevo como máximo (`auth`), y solo al final, con todo verde.

## Plan por fases

Disciplina transversal: **un PR por paso**, con `pnpm typecheck && pnpm test &&
pnpm test:integration` en verde; no se mergea sin CI. Nada de arreglos «ya que estoy»
fuera del fichero tocado. La vara de medir de cada paso: **¿elimina un bug o una clase de
bugs?** Si solo mueve código para que el grafo quede más bonito, va al final o no va.

### Fase A — riesgo real (~1 semana; se mergea pase lo que pase)

- [x] **A-1 · Parches de corrección** (S): (a) XSS de `/graph` —
  `JSON.stringify(project).replaceAll('<','\\u003c')` en `apps/web/src/index.ts:664`, y
  borrar la rama legacy `?token=` de `/auth/cli`; (b) guard de acceso + `createdBy=email`
  en `POST /save` (web) — y en el mismo PR ajustar el criterio de `autoCurate` (hoy filtra
  por `created_by='session-backfill'`, que ya no identifica lo auto-capturado; usar
  `sourceType`); (c) guard `import.meta.url` en `lint-act.ts`, `seed.ts` (¡hace TRUNCATE!)
  y `link.ts`; (d) fallback del reconciler `'update'` → `'noop'`
  (`packages/agents/src/reconcile.ts:22`).
- [x] **A-2 · Lookup canónico único de proyecto** (S): `findProjectId(sql, ref)` con
  semántica `canonical_name` en `projects.ts`; borrar las 6-7 copias (la de `dedup.ts:28`
  y `capture.ts:31` van por `name` exacto). **Antes** del cambio, test de integración
  «Acme Portal» vs «acme portal» que demuestra el bug — unificar cambia comportamiento a
  propósito (la reconciliación empezará a encontrar lo que hoy ignora).
- [x] **A-3 · Wiring explícito** (M): `wireLlm()` en `@cortex/agents` (encapsula
  `isLlmEnabled` + `setClassifier` + `setReranker` + `wireReconciler` + `CORTEX_RERANK`);
  `registerUsageSink()` exportado en vez del `import "./usage.js"` fantasma; quitar el
  `wireReconciler()` top-level de `connect-sessions.ts`; `buildMcpServer` queda como
  factoría pura (el `loadEnv`+wiring se va a los entrypoints).
- [x] **A-4 · `api-client` + `credentials` únicos** (S): a `@cortex/shared` (excepción
  pragmática documentada — no merece paquete propio); borra las 4 copias de lectura de
  `~/.cortex/credentials` y unifica el default de `CORTEX_SERVER_URL`.
- [x] **A-5 · Tabla de reglas de dependencia en `CLAUDE.md`** (S) — hecho en el PR de
  esta documentación.

### Fase B — estructura (~1-2 semanas)

- [x] **B-1 · Entrypoints → `apps/cli/src/commands/`** (L, hecho en 3 PRs: #7 core,
  #8 agents, #9 sync): la lógica queda como función exportada en su paquete; cada
  comando parsea argv y la llama; dispatcher con carga perezosa de rutas literales
  (sin mutar `process.argv`). `scripts/cortex-sync.ts` → `commands/sync/` (un adapter
  por agente). Los hooks instalados NO se rompieron: los scripts `hook:context`/
  `hook:capture` quedan como puentes de compatibilidad (retirar en fase D) y
  `cortex sync --apply` detecta y ACTUALIZA la sintaxis antigua de los hooks.
- [x] **B-2 · `setMediaExtractor`** (M, PR #10): visión/OCR/whisper salen de
  `core/extract.ts` a `agents/media.ts` con el patrón de hooks existente; la config LLM
  se unifica en `shared/llm-config.ts` (fuera `openrouter.ts` y las dos `VisionCfg`).
  `core` vuelve a ser determinista de verdad — **fase B completa**.

### Fase C — apps (~1-2 semanas)

- [x] **C-1 · Guard de acceso único + apps testeables** (M, PR #11): `checkProjectAccess`
  / `checkEntryAccess` en core con `'ok'|'not_found'|'forbidden'` y política unificada
  (inexistente → not_found; ADR; cubre `backlog #4`); `createApp()` en las 3 apps Hono
  (web/server: `app.ts`; mcp: `http-app.ts`) + 5 smoke tests con `app.request()`; fix de
  `CORTEX_MCP_AUTH=off` y sweep de sesiones MCP (`backlog #30`). El helper `runServer`
  común se descartó: `shared` no puede depender de hono/database sin romper las reglas —
  tres entrypoints de ~15 líneas ganan a una dependencia mal puesta.
- [x] **C-2 · Split de `apps/web`** (L, PR #12): `routes/` por recurso (11) +
  `middleware/` (session, access) + `views/` con `html` de `hono/html` (autoescape;
  `esc()` eliminado de los call-sites, 4 `raw()` auditados); CSS y `graph.js` a
  `public/` con `serveStatic` (vis-network sigue en CDN, anotado en el ADR de UI);
  `accessibleProjects` local (N+1) sustituido por `listAccessibleProjects` de core con
  `entryCount` (query agregada única); `askProjectContext()` extraído a agents
  (des-duplicado entre `/ask` y la tool MCP); `onError` global, `safeParse` de `type`
  y cookie `secure` en producción; test de integración de autoescape (XSS real).
- [x] **C-3 · Gemelo ligero en `apps/server`** (S, PR #13): `routes/{auth,context,
  install}.ts` + `auth-helpers` + `parseBody` con zod de `shared` (`safeParse` → 400 con
  issues; fuera los `as never`; paridad de enums verificada contra todos los conectores);
  `onError` global; el catch de `/context-pack` queda SOLO para la carrera guard→consulta
  (contrato del hook intacto) — **fase C completa**.

### Fase D — solo si el producto no ha pivotado

- [x] **D-1 · Split interno de core y agents** (M, PR #15): `operations.ts` →
  `save.ts`/`search.ts`/`context-pack.ts`; `connect-sessions.ts` →
  `transcript-utils`/`distill`/`capture-pipeline` (+ unit test de `scrub()`, que es
  código de seguridad — 8 casos); borrado el pipeline muerto (`ingestSessionFile`,
  `alreadyIngested`, `resolveProjectFromCwd`, `SUPPORTED_DOC_EXTS`). Superficie pública
  de los barrels intacta.
- [x] **D-2 · Consolidaciones que arreglan bugs** (M, PR #16): `rrfFuse` único
  (vectors↔code, conservando el score normalizado en híbrido vs sin normalizar en código);
  `extractJson` único en `agents/llm-json.ts` (3→1; distill gana el manejo de fences);
  `canonicalize` como base de `norm`/`slugify` (equivalencia de output verificada); Voyage
  plegado en `OpenAICompatibleEmbeddingProvider` (gana reintentos). La unificación de la
  política de retry (retry×2 sobre Mastra) se aplaza: es tuning con riesgo, no dedup.
- [ ] **D-3 · Config y poda** (M): `config.ts` lazy por paquete (defaults en un sitio);
  `.env.example` completo (~37 vars sin documentar); poda de código muerto y del barrel
  de core; decidir la hipótesis Mastra-workflows (adoptar o borrar `workflows.ts` +
  `demo-capture.ts`, con ADR).
- [ ] **D-4 · `packages/auth`** (M): extraer auth+email (único paquete nuevo; `isAdmin`
  puro a `shared` para no crear ciclo). Al final, con todo verde.
- [ ] **D-5 · ADRs y docs** (S): matriz de las 3 vías de escritura
  (`saveContext`/`saveWithReconciliation`/`captureBatch`), zod de filas (validar o
  degradar a tipos), FTS `'spanish'`, pricing hardcodeado en `usage.ts`, migración
  `UNIQUE(source_id,target_id,relation_type)` en relations (`backlog #16`) y CHECK de
  visibility, columna vector sin dimensión (`backlog #34`).

## Qué NO hacemos (deliberadamente)

Para que la decisión no se re-litigue: **nada de** DDD táctico (entities/aggregates/
repositories formales), ORM o query-builder (el SQL con tagged templates de postgres.js es
seguro y legible; el problema era la dispersión), contenedor de DI (el patrón `setX()` +
parámetro `sql` opcional basta), capa de «services» entre handlers y core (delegación
vacía), framework de frontend (umbrales escritos: htmx cuando haga falta el primer
refresco parcial; Preact+Vite solo si el grafo evoluciona a explorador con estado),
microservicios, node-pg-migrate/drizzle (el runner de 54 líneas vale; solo advisory lock),
índices HNSW/dimensión fija ya (ADR: se decide al fijar proveedor serio de embeddings), ni
cobertura exhaustiva de tests de las apps (smoke de guards + unit de lo puro). Máximo un
paquete nuevo (`auth`).

## Riesgos

- **La red de tests es estrecha** (392 LOC de tests / ~8k de fuente; 0 en las 4 apps):
  por eso A-2 y C-1 escriben tests *antes* de los movimientos grandes.
- **A-2 y C-1 cambian comportamiento a propósito** (dedup empieza a reconciliar; política
  de proyecto inexistente unificada): revisar los datos de demo antes de desplegar.
- **B-1 rompe rutas instaladas** en máquinas de devs (hooks, shim): coordinar el
  `cortex sync --apply`.
- **Scope creep**: con ~70 hallazgos, la tentación de «ya que estoy» es enorme.
  Disciplina de un PR por paso.
- **El refactor compite con validar el producto**: las fases A-B eliminan el riesgo real;
  C-D son posponibles si la demo pivota.
