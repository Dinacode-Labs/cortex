# Arquitectura, estabilidad y robustez — Auditoría Cortex

## Valoración

La arquitectura de Cortex está **bien estratificada**: `@cortex/core` es determinista y desacoplado de la capa LLM, que se inyecta limpiamente vía hooks globales (`setClassifier`/`setReranker`/`setReconciler`) con fallback heurístico cuando no hay modelo. El grafo de dependencias es acíclico (`shared → database/embeddings → core → agents/apps`) y hay aciertos puntuales de robustez (advisory lock en `maintain`, `ON CONFLICT` en `resolveEntity`, singleton perezoso de conexión, transacción en `resolve-entities`). Es el andamiaje correcto.

Sin embargo, **no está a la altura de un sistema de primera línea** para uso más allá de demo: arrastra deuda de producción concentrada en cuatro frentes — (1) ausencia casi total de atomicidad transaccional en los caminos de escritura multi-paso, (2) degradación silenciosa ante fallos de proveedor (sin timeouts/cancelación, `catch` vacíos, cap de tokens que rompe el reconciler), (3) fugas de recursos y shutdown no drenado en los servidores de larga vida, y (4) configuración de conexión Postgres pensada solo para el Docker local. Las races detectadas son reales pero acotadas a baja concurrencia. Nada de esto es bloqueante para la PoC interna; sí lo sería para multi-tenant/producción.

**Severidad global de la dimensión: media.** Base sólida, deuda real y bien localizada.

---

## Hallazgos por severidad

No hay hallazgos 🔴 Críticos ni 🟠 Altos en esta dimensión: las debilidades son estructurales pero su radio de impacto está acotado por el alcance PoC, el fallback local de embeddings y los subsistemas compensatorios (maintain/reconciliación, reindexado idempotente).

### 🟡 Medios

#### M1 · Cap `maxOutputTokens=60` rompe el reconciler con un modelo de razonamiento
- **Evidencia:** `packages/agents/src/reconcile.ts:18` llama `runAgent("reconciler", prompt, { maxOutputTokens: 60 })`. El modelo por defecto al optar por OpenRouter es de razonamiento (`packages/agents/src/openrouter.ts:39`, `OPENROUTER_MODEL='deepseek/deepseek-v4-pro'`). La decisión se extrae con `raw.match(/noop|update|supersede/i)` sobre toda la respuesta y, en no-match (`:20`) o en `catch` (`:22`), cae a `"update"`.
- **Impacto:** Con un modelo de razonamiento, 60 tokens pueden agotarse antes de emitir la decisión → respuesta vacía/truncada → `"update"` sistemático. La lógica ADD/UPDATE/SUPERSEDE/NOOP (núcleo anti-context-rot) degrada a fusión por defecto: no se invalida lo obsoleto (supersede) ni se descarta lo redundante (noop). **Matización importante:** el provider por defecto es `none` (`openrouter.ts:22`), así que sin optar por OpenRouter no hay reconciler activo; con modelos no-razonadores 60 tokens bastan; y el rol fuerza `response_format: json_object` (`mastra.ts:58,61-72`), por lo que `res.text` expone el JSON, no la cadena de pensamiento. Aun cayendo a `"update"`, el merger consolida (no se pierde conocimiento), solo no se emiten supersede/noop. Riesgo real y **condicional**, no "roto por defecto".
- **Recomendación:** Subir `maxOutputTokens` a un valor compatible con reasoning (512-1024) o separar `reasoning_tokens` del output útil; emitir la decisión en un campo JSON aislado (`{"decision": ...}`) y parsear ese campo en vez de un `match` laxo; distinguir "fallo LLM" de "noop" para no fusionar por defecto ante error.
- **Esfuerzo:** S

#### M2 · Escrituras multi-paso sin atomicidad transaccional
- **Evidencia:** `packages/core/src/operations.ts:123-159` (`saveContext`): `INSERT sources` → `INSERT context_entries` → `storeEmbedding` → links/relations son statements autocommit independientes, sin `sql.begin()`. `packages/core/src/dedup.ts:111-119` (supersede): `saveContext(nueva)` e `invalidateEntry(vieja)` tampoco son atómicos. `indexRepo` (`packages/core/src/code.ts:258-282`) hace DELETE+inserts por lote sin transacción. Contraste deliberado: `packages/core/src/resolve-entities.ts:63` sí envuelve en `sql.begin(async tx => ...)`.
- **Impacto:** Un fallo a mitad (p.ej. `provider.embed` lanza en `vectors.ts:14`, o un crash entre save e invalidate) deja estado parcial: entradas committeadas sin embedding (no buscables semánticamente), fuentes huérfanas, o DOS entradas vigentes duplicadas. En `indexRepo` hay además una ventana donde el código del repo no está en BD. No hay rollback ni compensación. Acotado por: alcance PoC, fallback local de embeddings (baja tasa de fallo por defecto), no se pierde el contenido de la fuente, y maintain/reconciliación + reindexado idempotente limitan el radio.
- **Recomendación:** Envolver cada camino compuesto en `sql.begin(async tx => ...)` pasando `tx` a todas las sub-operaciones (entry+embedding+links+invalidación como unidad). Donde el embedding dependa de un proveedor lento, calcular el vector **antes** de abrir la transacción y solo persistir dentro.
- **Esfuerzo:** M

#### M3 · Llamadas LLM sin timeout ni cancelación (AbortSignal)
- **Evidencia:** `packages/agents/src/mastra.ts:131` fija `maxRetries=6` pero no pasa `AbortSignal` ni timeout a `agent.generate`. `apps/.../enrich-project.ts:48-87` lanza `CONCURRENCY` workers (def 3), cada uno `await extractGraph → runAgent`. Sin circuit breaker ni deadline por operación (grep confirma cero `Abort`/`timeout`/`circuit` en `packages/agents/src`).
- **Impacto:** Un proveedor lento/colgado bloquea el worker sin progreso; con concurrencia limitada agota los slots y cuelga el pipeline (enrich/maintain/ingesta) sin diagnóstico. Acotado: los timeouts por defecto de `undici` (~300s headers/body) acotan cada llamada (amplificado por reintentos, no literalmente "indefinido"), y el peor camino es CLI en PoC, no un loop de servidor de alto rendimiento.
- **Recomendación:** `AbortController` con timeout por llamada (60-120s) propagado a `agent.generate`; reducir `maxRetries` con backoff y jitter acotado; circuit breaker que abra tras N fallos consecutivos para fallar rápido a heurística.
- **Esfuerzo:** M

#### M4 · Fuga de recursos: `Map` de sesiones MCP HTTP sin TTL ni límite
- **Evidencia:** `apps/mcp-server/src/http.ts:17` `const sessions = new Map(...)`; solo se purga en `t.onclose` (`:54-56`). Sin barrido por inactividad, idle-timeout ni cota de número de sesiones en todo el fichero.
- **Impacto:** Clientes que no cierran limpiamente (caída de red, kill) — donde `onclose` no dispara — dejan `{transport, McpServer, conexión}` colgando indefinidamente → crecimiento ilimitado de memoria. Vector de DoS por acumulación. Acotado: el endpoint exige Bearer por defecto (no DoS anónimo), footprint moderado por sesión (pool SQL compartido, no conexión dedicada) y PoC interno.
- **Recomendación:** Guardar `lastSeen` por sesión y un barrido periódico (`setInterval`) que cierre/elimine transportes inactivos > N min; máximo de sesiones (rechazar con error claro al superarlo); cerrar el transporte en el barrido, no solo en `onclose`.
- **Esfuerzo:** M

#### M5 · Graceful shutdown incompleto en los tres servidores
- **Evidencia:** `apps/server/src/index.ts:205-208`: `shutdown()` llama `server.close()` sin esperar callback ni drenar in-flight → `closeSql()` → `process.exit(0)`. Mismo patrón en `apps/web/src/index.ts:706-708` y `apps/mcp-server/src/http.ts:71-72`. Ninguno maneja el evento `'error'` del server (p.ej. `EADDRINUSE` → excepción no gestionada).
- **Impacto:** Cierra conexiones/queries en vuelo abruptamente (errores o escrituras a medias en peticiones activas, agravado por la falta de atomicidad de M2), y un fallo de bind queda como crash no controlado. Salida siempre con código 0 aunque haya habido error.
- **Recomendación:** `await new Promise(r => server.close(r))` con deadline (force-exit tras N s), luego `closeSql`, y `process.exit` con código según error; añadir `server.on('error')` que loguee y salga con código ≠ 0.
- **Esfuerzo:** S

#### M6 · Errores tragados con `catch` vacío que degradan silenciosamente
- **Evidencia:** `packages/core/src/dedup.ts:37-44` (`findNearest`) envuelve todo en `try/catch{}` y devuelve `null` ante CUALQUIER error (BD o proveedor de embeddings) → degrada a ADD-sin-dedup. `apps/.../api-client.ts:34` (`apiGet`/`apiPost`) capturan todo y devuelven `null`/`ok:false` sin status ni log. `extract.ts` (conectores) devuelve `null` sin distinguir 401/parse-error/fichero vacío. `saveContext`: `classifier(...).catch(() => null)` (`operations.ts:99`).
- **Impacto:** Fallos reales de infraestructura (DB caída, token expirado, 401/429 del proveedor, fichero corrupto) se vuelven indistinguibles de "no hay nada que hacer". El sistema parece funcionar mientras pierde conocimiento o salta dedup; diagnóstico muy costoso por ausencia de señal. Robustez aparente, no real.
- **Recomendación:** Distinguir errores esperados (sin vecino, no soportado) de errores de infraestructura: loguear con contexto (al menos `console.error` con causa) y/o re-lanzar los de infraestructura; contadores agregados de tasa de fallo por proveedor para alertar.
- **Esfuerzo:** M

#### M7 · Sin manejo defensivo del proveedor de embeddings (`vectors[0]!`)
- **Evidencia:** `packages/core/src/vectors.ts:15` `const vec = vectors[0]!`; `vectors.ts:96` y `:168` `toVectorLiteral(vectors[0]!)`. Si `provider.embed` devuelve `[]` o un vector de dimensión incorrecta, no hay validación: crash con `!` sobre `undefined`, o `INSERT`/operador `<=>` falla por mismatch de dimensión.
- **Impacto:** Un fallo parcial del proveedor (respuesta vacía, dimensión cambiada entre versiones) propaga un crash poco diagnosticable en el camino caliente de save/search y puede romper KNN por mismatch dimensional. La columna `dim` es solo informativa; nada garantiza `length(vector) = dim`.
- **Recomendación:** Validar `vectors.length === inputs.length` y la dimensión esperada antes de persistir/consultar; lanzar error claro ("proveedor devolvió N dims, se esperaban M"); considerar un `CHECK`/índice por dimensión a nivel de esquema.
- **Esfuerzo:** S

#### M8 · Runner de migraciones sin advisory lock ni checksums
- **Evidencia:** `packages/database/src/migrate.ts:10-54`: lee `schema_migrations`, aplica las no registradas (cada una en su `sql.begin`), sin `pg_advisory_lock` global ni verificación de checksum. Cada fichero corre dentro de transacción (`CREATE INDEX CONCURRENTLY` sería imposible).
- **Impacto:** Dos procesos `db:migrate` simultáneos (dos instancias arrancando) pueden intentar aplicar la misma migración → carrera/errores. Editar una migración ya aplicada pasa inadvertido. No hay rollback/down. Contrasta con `maintain.ts`, que sí usa advisory lock.
- **Recomendación:** Tomar `pg_advisory_lock` al inicio de `migrate()` y liberarlo al final; guardar checksum por migración y abortar si difiere; documentar que `CREATE INDEX CONCURRENTLY` requeriría un camino sin transacción.
- **Esfuerzo:** S

#### M9 · `relate()` es check-then-act sin constraint único
- **Evidencia:** `packages/core/src/entities.ts:50-61` hace `SELECT`-existe y luego `INSERT`, sin restricción única en la tabla `relations`. `enrich-project.ts:66` lanza `CONCURRENCY` workers que comparten pool y llaman `relate()` con relaciones potencialmente solapadas; `saveContext` concurrentes ídem. `resolveEntity` sí está protegido con `ON CONFLICT`, `relate` no.
- **Impacto:** Dos ejecuciones concurrentes pasan ambas el `SELECT` e insertan la misma arista (incluidas `belongs_to` y la marca `contradicts` de la reconciliación) → grafo con duplicados. Idempotencia rota en el enriquecimiento paralelo.
- **Recomendación:** Índice único sobre `(source_id, source_type, target_id, target_type, relation_type)` e insertar con `ON CONFLICT DO NOTHING`, eliminando el `SELECT` previo.
- **Esfuerzo:** S

#### M10 · Idempotencia por `source_reference` y por `slug` sin constraint (races)
- **Evidencia:** `capture.ts:38-44` salta lo ya ingerido con un `SELECT` por item sin unicidad en BD → dos batches concurrentes con el mismo `sourceReference` doble-insertan. `projects.ts:41-63` (`createProject`) es check-then-act (`findProjectBySlug` → `resolveEntity` → `UPDATE slug`) sin transacción: dos `canonical_name` distintos que slugifican igual violan el índice único parcial de slug → excepción no gestionada (500/crash).
- **Impacto:** Duplicados en ingesta concurrente y crash no controlado al crear proyectos con slugs colisionantes. La idempotencia prometida de conectores y `createProject` depende de timing, no de invariantes de BD.
- **Recomendación:** Apoyar la dedup en constraints reales (índice único por `(project_id, source_reference)`) con `ON CONFLICT`; envolver `createProject` en transacción y capturar la violación de unicidad de slug para devolver un error de dominio claro en vez de 500.
- **Esfuerzo:** M

### 🟢 Bajos

#### L1 · Cliente Postgres sin pool/SSL/timeouts/`prepare:false` explícitos
- **Evidencia:** `packages/database/src/client.ts:14-17`: `postgres(getDatabaseUrl(), { transform: { undefined: null } })` — única configuración. Sin `max`, `ssl`, `connect_timeout`, `idle_timeout` ni `prepare:false`.
- **Impacto (matizado):** Buena parte del impacto temido **no aplica hoy**: postgres.js trae por defecto pool de 10 conexiones y `connect_timeout` de 30s, así que "sin pool / cuelga sin límite" es falso, y `ssl` puede fijarse vía `DATABASE_URL`. El único despliegue es Docker local (`docker-compose.yml`, `.env.example` → `localhost:5433`); no hay PgBouncer/Supabase/pooler en el repo. `prepare:true` y SSL no forzado son notas de hardening **de futuro**, no un SPOF actual. Por eso baja a severidad baja.
- **Recomendación:** Parametrizar desde env: `max`, `idle_timeout`, `connect_timeout`, `ssl` (require en prod) y `prepare:false` cuando se detecte un pooler en modo transaction. Documentar en `.env.example`.
- **Esfuerzo:** S

#### L2 · `recordUsage` (INSERT) en el camino caliente y serializado de cada generación LLM
- **Evidencia:** `packages/agents/src/mastra.ts:141` hace `await recordUsage(...)` antes de devolver el texto; `recordUsage` traga sus errores (`usage.ts`) pero añade un INSERT síncrono por generación. El exporter de trazas (`trace-exporter`) inserta fila a fila sin batch.
- **Impacto:** Acoplamiento agents→DB en cada llamada LLM: latencia extra y, en un servidor de alto volumen de spans, cuello de botella de escritura. Aceptable en CLIs, problemático en server.
- **Recomendación:** `recordUsage` fire-and-forget con captura de error, o bufferizar uso/trazas y flush por lotes/intervalo; mantener el flush en el shutdown de los servidores de larga vida.
- **Esfuerzo:** M

#### L3 · `shutdownObservability` depende de un método no tipado de Mastra; los servidores no lo invocan
- **Evidencia:** `packages/agents/src/mastra.ts:113-120` castea Mastra a `any` y llama `shutdown?.()`; si la versión no expone `shutdown` es un no-op silencioso. Solo lo llaman los CLIs (maintain, enrich-run, connect-*, hook-capture); `apps/server`, `apps/web` y `apps/mcp-server` NO lo llaman.
- **Impacto:** Contrato frágil ante upgrades de Mastra (flush silenciosamente omitido). Mitigado hoy porque el exporter no bufferiza; pero si se introduce batching (ver L2), los servidores perderían spans al cerrar.
- **Recomendación:** Fijar la dependencia de la API de shutdown (o detectar su ausencia y loguear); llamar `shutdownObservability` en el shutdown de server/web/mcp-http.
- **Esfuerzo:** S

#### L4 · Estado global de proceso para classifier/reranker/reconciler
- **Evidencia:** `operations.ts:40` y `:54` (classifier, reranker) y `dedup.ts:79` (reconciler) son `let` module-level mutados por `setClassifier`/`setReranker`/`setReconciler`. `mastra` es también singleton (`mastra.ts:75`).
- **Impacto:** La configuración LLM queda fijada al proceso entero: en un servidor multi-tenant no se puede variar clasificador/reconciliador por proyecto o petición, y la mutación por orden de import dificulta el testing aislado. Decisión razonable hoy (entrypoint único cablea), pero limita la evolución a multi-tenant.
- **Recomendación:** A medio plazo, inyección por contexto/petición (pasar los hooks en un objeto de contexto a las operaciones) en vez de singletons globales; documentarlo como límite conocido.
- **Esfuerzo:** L

#### L5 · `fs` síncrono en indexado y carga completa en memoria de relations/transcripts
- **Evidencia:** `code.ts:71-101,113-118` usan `readdirSync`/`readFileSync`/`statSync`/`openSync`; `indexRepo` se invoca desde apps. `queries.ts:154-163` (`getProjectGraph`) trae la tabla `relations` completa (sin filtro de proyecto) y filtra en JS. `connect-sessions.ts:71` hace `readFileSync` del `.jsonl` entero + `split('\n')`.
- **Impacto:** Indexar un repo grande bloquea el event loop durante toda la operación (impacta a peticiones concurrentes si corre en servidor). `getProjectGraph` no escala (trae relaciones de todos los proyectos). Transcripts grandes se cargan enteros sin cota → presión de memoria.
- **Recomendación:** Migrar a `fs/promises` y streaming/iteración por lotes para indexado; filtrar `relations` por proyecto en SQL (JOIN con nodos del proyecto) con paginación; cota de tamaño de fichero y stream de líneas para transcripts.
- **Esfuerzo:** M

---

## Qué está bien

Para un juicio equilibrado, estos aciertos son la base sólida sobre la que apoyar las correcciones (no tocar, replicar):

- **Desacoplo limpio LLM ↔ core por hooks** con fallback heurístico: `setClassifier`/`setReranker`/`setReconciler` (`operations.ts:46-55`, `dedup.ts:80-82`). El core sigue funcionando (degradado) sin LLM ni claves.
- **Advisory lock en `maintain`**: `maintain.ts:36-43` toma `pg_try_advisory_lock` en conexión reservada para evitar solape de mantenimientos.
- **`resolveEntity` con `ON CONFLICT`** y **fusión de entidades en transacción** (`resolve-entities.ts:63` con `sql.begin`) — el patrón correcto que falta replicar en M2/M9/M10.
- **Singleton perezoso de conexión** (`client.ts:12-19`): importar el módulo no abre conexiones hasta usarlo.
- **Embeddings enchufables con fallback local** sin API key.
- **Grafo de dependencias acíclico** entre paquetes (`shared → database/embeddings → core → agents/apps`).

---

## Recomendaciones priorizadas (esta dimensión)

1. **Atomicidad de escrituras (M2)** — envolver `saveContext`, supersede y `indexRepo` en `sql.begin`, calculando embeddings antes de la transacción. Mayor impacto en consistencia. *(M)*
2. **Idempotencia por constraints reales (M9, M10)** — índices únicos + `ON CONFLICT` en `relations`, `(project_id, source_reference)` y slug; envolver `createProject` en transacción. Elimina duplicados y crashes de la ingesta paralela. *(S/M)*
3. **Visibilidad de fallos (M6, M7)** — dejar de tragar errores de infraestructura; validar la forma del vector de embeddings. Convierte robustez aparente en real y abarata el diagnóstico. *(S/M)*
4. **Resiliencia de proveedor (M3, M1)** — timeout/AbortSignal + circuit breaker en llamadas LLM; subir `maxOutputTokens` del reconciler y parsear la decisión de un campo JSON aislado. *(S/M)*
5. **Ciclo de vida de procesos (M5, M4, M8)** — shutdown drenado con deadline y `server.on('error')`; TTL/cota en sesiones MCP HTTP; advisory lock + checksums en el runner de migraciones. *(S/M)*
6. **Hardening de datos y observabilidad (L1, L2, L3)** — parametrizar el cliente Postgres desde env; bufferizar uso/trazas y llamar `shutdownObservability` en los servidores. *(S/M)*
7. **Escalado de futuro (L4, L5)** — inyección de hooks por contexto para multi-tenant; `fs/promises`/streaming y filtrado de `relations` en SQL. *(M/L)*
