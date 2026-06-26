# Backlog priorizado de mejora — Dinacode Cortex

> Auditoría jefe. Consolidación de TODOS los hallazgos accionables de las 7 dimensiones,
> ordenados por prioridad. **Prioridad**: P0=critical, P1=high, P2=medium, P3=low.
> Dentro de cada severidad, primero menor esfuerzo (S → M → L).
> **Esfuerzo**: S (horas), M (1-3 días), L (semana+).
> Fecha de revisión: 2026-06-23.

## Tabla única de recomendaciones

| # | Prio | Dimensión | Hallazgo / Recomendación accionable | Sev | Esf |
|---|------|-----------|--------------------------------------|-----|-----|
| 1 | P0 | Seguridad | Búsqueda/ask sin proyecto filtra proyectos privados (web y MCP). Empujar autorización a core: sin proyecto, restringir a `listAccessibleProjects` (default-deny). | critical | M |
| 2 | P1 | Seguridad | `validateEntry` sin control de acceso (MCP y web): IDOR para mutar estado de entradas ajenas por UUID. Pasar email y verificar `canAccessProject`. | high | S |
| 3 | P1 | Seguridad | `POST /save` (web) escribe en cualquier proyecto sin autorización. Exigir `guardProject`, `createdBy=user.email`, validar `type`. | high | S |
| 4 | P1 | Seguridad | `guardProject` es fail-open (devuelve true si no encuentra el proyecto). Default-deny por slug; unificar resolución con el core. | high | S |
| 5 | P1 | Seguridad | XSS reflejado en `/graph` vía `JSON.stringify(project)` en script inline. Escapar `<` en la salida JSON o usar atributo `data-` con `esc()`; CSP sin inline. | high | S |
| 6 | P1 | Seguridad | Fuga de secretos al LLM en conectores no-Claude (sin `scrub()`). Centralizar `scrub()` antes de `distill`; ampliar a connection strings y cookies; test. | high | S |
| 7 | P1 | Modelo de datos | `resolve-entities` fusiona entidades por nombre ignorando `type` → corrompe el grafo (DELETE irreversible). Agrupar por `${type}:canonicalize(name)`; test de homónimos. | high | S |
| 8 | P1 | Cobertura del plan | El "filtrado por permisos" del plan no se aplica en búsqueda/ask sin proyecto (promesa entregada incorrectamente). Autorización en core, política default-deny. | high | M |
| 9 | P2 | Arquitectura | Cap `maxOutputTokens=60` rompe el reconciler con modelo de razonamiento (siempre 'update'). Subir cap (≥512); decisión en campo JSON aislado; distinguir fallo LLM de 'noop'. | medium | S |
| 10 | P2 | Arquitectura | Graceful shutdown incompleto en los 3 servidores (`server.close()` sin await). `await` con deadline + force-exit, `closeSql`, `exit` con código; handler `server.on('error')`. | medium | S |
| 11 | P2 | Arquitectura | Sin validación defensiva del proveedor de embeddings (`vectors[0]!`). Validar `length===inputs.length` y dimensión esperada antes de persistir/consultar; error claro. | medium | S |
| 12 | P2 | Arquitectura | Runner de migraciones sin advisory lock ni checksums (race en arranque concurrente). `pg_advisory_lock` al inicio; checksum por migración; documentar camino sin transacción. | medium | S |
| 13 | P2 | Arquitectura | `relate()` es check-then-act sin constraint único → relaciones duplicadas bajo concurrencia. Índice único + `ON CONFLICT DO NOTHING`, eliminar el SELECT previo. | medium | S |
| 14 | P2 | Modelo de datos | `findNearest` toma el vecino global y comprueba `sameKind` a posteriori → se salta dedup de mismo `sourceType`. Filtrar por `source_type` en `vectorSearch` (o top-k same-kind). | medium | S |
| 15 | P2 | Modelo de datos | Idempotencia de `captureBatch` por `source_reference` sin constraint/índice. UNIQUE parcial `(project_id, source_reference)` + `ON CONFLICT DO NOTHING RETURNING`. | medium | S |
| 16 | P2 | Modelo de datos | `relations` sin unicidad → `relate()` TOCTOU duplica aristas (incl. contradicts/belongs_to). UNIQUE `(source_id, target_id, relation_type)` + `ON CONFLICT DO NOTHING`. | medium | S |
| 17 | P2 | Modelo de datos | Self-join de duplicados en lint compara por `embedding_model` pero no por `embedding_version` (mismatch de dimensión). Añadir `embedding_version` (y `chunk_index`) al join. | medium | S |
| 18 | P2 | Modelo de datos | Decisión 'update' del LLM sobre no-`agent_session` cae a ADD silencioso (duplicado 0.82-0.95 no limpiable). Registrar relación `supersedes`/degradar a NOOP con aviso. | medium | S |
| 19 | P2 | Calidad de memoria | Score expuesto incoherente con el ranking (mezcla coseno y RRF normalizado). Exponer una única señal homogénea (RRF normalizado) en `/search`, `/code` y MCP. | medium | S |
| 20 | P2 | Seguridad | Condición de carrera (TOCTOU) en `verifyOtp` (supera el cap de 5 intentos). UPDATE condicional atómico con RETURNING o `SELECT FOR UPDATE`; lockout por email. | medium | S |
| 21 | P2 | Cobertura del plan | Redacción de secretos (anonimización §18) no uniforme. Centralizar `scrub()` en `captureCondensedViaApi` antes de cualquier LLM; cubrir connection strings/cookies. | medium | S |
| 22 | P2 | Solidez investigación | `competitive-landscape.md` desfasado (presenta como pendientes features ya implementadas). Columna Estado (hecho/parcial/pendiente) + banner de fecha; refs a ADR-0009/0011/0012. | medium | S |
| 23 | P2 | Solidez investigación | Docs de research sin fecha de revisión ni estado de vigencia. Cabecera estándar (creación/última revisión/estado); revisar en cada PR del área. | medium | S |
| 24 | P2 | Solidez investigación | Incertidumbre de visión ('a probar') enviada a producción sin cerrar. Sondeo real (POST image_url por modelo), anotar resultado, conectar fallback OCR (tesseract). | medium | S |
| 25 | P2 | Tests y operación | Servicios de app sin healthcheck (solo Postgres). `healthcheck curl -f /health` con `SELECT 1`; latido para el worker. | medium | S |
| 26 | P2 | DX y onboarding | `curl\|sh` clona por SSH un repo privado y hace checkout completo sin pre-aviso. Documentar prerrequisitos (Node≥20, git, SSH) y el checkout; fallback HTTPS o mensaje claro. | medium | S |
| 27 | P2 | DX y onboarding | `CLAUDE.md` desfasada: dice "5 tools" cuando son 8. Actualizar a 8 (o enlazar la tabla del README como fuente única) y podar. | medium | S |
| 28 | P2 | Arquitectura | Escrituras multi-paso sin atomicidad (saveContext, supersede, captureBatch, indexRepo). Envolver cada camino compuesto en `sql.begin(tx)`; calcular embedding antes de abrir la tx. | medium | M |
| 29 | P2 | Arquitectura | Llamadas LLM sin timeout ni `AbortSignal`: un endpoint colgado bloquea workers. `AbortController` con deadline (60-120s); reducir `maxRetries`+backoff; circuit breaker. | medium | M |
| 30 | P2 | Arquitectura | Fuga de recursos: Map de sesiones MCP HTTP sin TTL ni límite. `lastSeen` + barrido periódico que cierre inactivas; tope de sesiones; cerrar transporte en el barrido. | medium | M |
| 31 | P2 | Arquitectura | Errores tragados con catch vacío (findNearest, api-client, conectores). Distinguir errores esperados de infraestructura: loguear con contexto / re-lanzar; contadores de fallo. | medium | M |
| 32 | P2 | Arquitectura | Idempotencia por `source_reference`/slug basada en chequeos de aplicación sin constraint (races). Constraints reales + `ON CONFLICT`; `createProject` en tx con error de dominio. | medium | M |
| 33 | P2 | Modelo de datos | Umbrales de reconciliación calibrados para qwen3 pero el proveedor por defecto es local-feature-hash. Umbrales dependientes del modelo (tabla de calibración) o forzar embedding semántico. | medium | M |
| 34 | P2 | Modelo de datos | Columna `vector` sin dimensión fija ni validación `length(vector)=dim`. Fijar `vector(N)` o `CHECK (vector_dims=dim)`; documentar re-embed al cambiar de modelo; planear índice ANN. | medium | M |
| 35 | P2 | Modelo de datos | Doble fuente de verdad para 'vigente' (`validity` vs `valid_to`/`status`). Definir UNA señal autoritativa (`valid_to`) y derivar `validity`; centralizar la invalidación. | medium | M |
| 36 | P2 | Modelo de datos | `createProject` por colisión de slug devuelve un proyecto preexistente AJENO. Tratar la colisión como conflicto explícito; `INSERT ... ON CONFLICT (slug)` con resultado tipado. | medium | M |
| 37 | P2 | Calidad de memoria | Reconciliación estilo mem0 rota (token cap 60 + solo vecino #1). Subir cap, salida estructurada parseada por campo, comparar contra top-k; avisar cuando queda degradada. | medium | M |
| 38 | P2 | Calidad de memoria | KNN exacta O(n) sin índice ANN (hnsw/ivfflat). Fijar dimensión + índice HNSW por (model, version); paginar self-joins de dedup/lint. | medium | M |
| 39 | P2 | Calidad de memoria | Sin reranker cross-encoder de 2ª etapa (el LLM list-rank es frágil y apagado por defecto). Integrar bge-reranker/Cohere/FlashRank sobre ~50 candidatos; mantener list-rank opcional. | medium | M |
| 40 | P2 | Calidad de memoria | Detección de contradicciones limitada (2 ejes por regex ES) y resolución temporal incompleta. Conflicto basado en LLM sobre top-k; invalidación bi-temporal de relaciones; exponer no resueltas. | medium | M |
| 41 | P2 | Calidad de memoria | Sin distinción episódica/semántica ni memoria por-usuario; curación por proxy frágil. Modelar tipo de memoria y scope por usuario; decay basado en recurrencia/acceso real. | medium | M |
| 42 | P2 | Seguridad | Sin rate-limit en `/auth/request` (email-bombing + reset de lockout). Throttle por email e IP, backoff, límite de OTP activos. | medium | M |
| 43 | P2 | Seguridad | Sin validación zod ni límite de payload/items (DoS). Validar bodies con zod (400); limitar tamaño de body e items (413). | medium | M |
| 44 | P2 | Seguridad | Hardening de transporte débil (Host del instalador, DNS rebinding MCP, cookie sin secure/CSRF, token en query). Fijar `CORTEX_PUBLIC_URL`; bind 127.0.0.1+allowedHosts; cookie secure+CSRF; quitar token de la query. | medium | M |
| 45 | P2 | Seguridad | Doble resolución de proyecto, sesiones MCP sin TTL, salidas LLM/Brevo sin timeout. Resolver por identidad estable; idle-timeout/tope de sesiones; `AbortController` con timeout. | medium | M |
| 46 | P2 | Cobertura del plan | No hay auditoría de accesos pese a exigirlo el plan (§18). Log de accesos (tool, usuario, proyecto, ts, nº hits) reutilizando infra de `ai_traces`; base para RBAC. | medium | M |
| 47 | P2 | Cobertura del plan | Loop §12.8 (aprendizaje desde consultas) no implementado ni en roadmap. Implementar (logging de consultas + clusters sin respuesta) o documentar como descartado/pendiente. | medium | M |
| 48 | P2 | Cobertura del plan | Sin reindexado/versionado de embeddings al cambiar de modelo (§9.2/§9.6). Comando `reembed --provider X` por proyecto que marque `embedding_version`; filtrar por (model, version). | medium | M |
| 49 | P2 | Cobertura del plan | Sólo 1 de 3 workflows Mastra del §20.4 implementado. Envolver context-pack y dedup/contradicción en `createWorkflow` (o dejar documentado como pendiente, ya aceptable). | medium | M |
| 50 | P2 | Solidez investigación | Recomendación de research no implementada: transcripción enchufable con fallback local. Implementar `TranscriptionProvider` (patrón embeddings) o documentar el acoplamiento a 'nan'. | medium | M |
| 51 | P2 | Tests y operación | Sin backup/restore de Postgres (única fuente de verdad). Cron de `pg_dump`/pgbackrest con restore probado y documentado. | medium | M |
| 52 | P2 | Tests y operación | Sin observabilidad de la capa HTTP (solo coste LLM). Middleware (pino) con request-id/latencia/status y `app.onError` uniforme en server/web/mcp. | medium | M |
| 53 | P2 | Tests y operación | Worker e `install.sh` sin alerta ni e2e. Tabla `jobs` con alerta vía Brevo; test e2e de `install.sh` que falle ruidosamente. | medium | M |
| 54 | P2 | Calidad de memoria | Sin evaluación de retrieval ni calibración de umbrales (no hay golden set/recall/nDCG/MRR). Golden set + script `eval` como gate en CI; recalibrar umbrales por modelo; subset LOCOMO/LongMemEval. | medium | L |
| 55 | P2 | Calidad de memoria | Las entradas no se trocean (un embedding por entrada, truncado a 8000 chars). Chunking con solape (`chunk_index>0`) + agregación en ranking; contextual chunking; sustituir el truncado. | medium | L |
| 56 | P2 | Tests y operación | Runtime MCP/HTTP y dominio sin tests; deploy sin TLS. Tests `app.fetch` (auth on/off) + unitarios de dominio; Caddy/Traefik con TLS y cabeceras. | medium | L |
| 57 | P3 | Arquitectura | Cliente Postgres sin pool/SSL/timeouts/`prepare:false` (no apto para pooler gestionado). Parametrizar desde env: max, idle/connect_timeout, ssl, `prepare:false` con pooler; documentar. | low | S |
| 58 | P3 | Arquitectura | `shutdownObservability` depende de método no tipado de Mastra; servidores de larga vida no lo invocan. Fijar/detectar la API de shutdown; llamarlo en server/web/mcp-http. | low | S |
| 59 | P3 | Arquitectura | Aciertos de arquitectura a mantener (hooks LLM↔core, advisory lock, ON CONFLICT, conexión perezosa). Mantener; replicar `sql.begin`/advisory lock en caminos de escritura y migración que carecen. | low | S |
| 60 | P3 | Modelo de datos | Faltan índices para patrones calientes (vigencia y `source_reference`). Índices compuestos `(project_id, type) WHERE valid_to IS NULL` y `(project_id, source_reference)`. | low | S |
| 61 | P3 | Modelo de datos | BIEN: grafo bi-temporal coherente (invalidar≠borrar, point-in-time consistente). Mantener; reforzar con tests point-in-time entre las 3 rutas de retrieval. | low | S |
| 62 | P3 | Modelo de datos | BIEN: exclusión de imágenes del dedup por embedding (caption≠identidad). Mantener; generalizar `metadata.format` a otros artefactos con embedding derivado (audio). | low | S |
| 63 | P3 | Seguridad | Errores crudos del core/DB y OTP sin salt. Mensajes genéricos + logging; HMAC/salt del OTP; re-validar dominio en `verifyOtp`. | low | S |
| 64 | P3 | Seguridad | BIEN: primitivas de identidad sólidas (hash, token 32B, canje atómico, SQL parametrizado, esc()). Mantener; construir autorización centralizada default-deny encima. | low | S |
| 65 | P3 | Calidad de memoria | BIEN: búsqueda híbrida vector+FTS+RRF (K=60, over-fetch, filtros coherentes). Mantener; parametrizar K y pool, añadir reranker cross-encoder (ver #39). | low | S |
| 66 | P3 | Calidad de memoria | BIEN: modelo bi-temporal + provenance por entrada (ventaja real vs memorias planas). Mantener; exponer point-in-time en UI/MCP; extender validez temporal a relaciones; validar `asOf`. | low | S |
| 67 | P3 | Cobertura del plan | Modelo de datos §14 implementado fiel y completo. Mantener; pulir deuda de tipado (`Row=Record<string,any>` en `map.ts`). | low | S |
| 68 | P3 | Cobertura del plan | Las 5 tools MCP mínimas están todas, ampliadas a 8. Mantener; reflejar la versión real (hoy hardcodeada a '0.0.0' en `server.ts`). | low | S |
| 69 | P3 | Cobertura del plan | Embeddings y LLM realmente enchufables con fallback local (ADR-0005 validado). Mantener; pendientes conocidos: local no semántico, whisper/visión atados a 'nan'. | low | S |
| 70 | P3 | Cobertura del plan | Deriva del roadmap: "no hay server aún" cuando server/deploy/worker ya existen. Podar roadmap: mover a 'hecho' despliegue y worker; estado real del scheduler. | low | S |
| 71 | P3 | Solidez investigación | Citas débiles en `multimodal-ingestion.md` (nombres sin URLs). Añadir URLs concretas a las afirmaciones cargadas (contrato API, límites, precios, libs). | low | S |
| 72 | P3 | Solidez investigación | Afirmaciones sobre internals de terceros apoyadas en fuentes secundarias (flaggeado). Verificar contra fuente primaria antes de copiar patrones; refrescar cifras (gbrain: 74 tools, reranker). | low | S |
| 73 | P3 | Solidez investigación | BIEN: research primario verificable y trazado a ADRs (memory-capture-policy). Mantener el método (citas primarias + marca de incertidumbre + traza a ADR) y extenderlo a futuros docs. | low | S |
| 74 | P3 | DX y onboarding | README + guía formativa de calidad excepcional con honestidad sobre límites. Mantener; cada nueva capacidad trae su sección y recuadro "Qué mirar"; vigilar que las cifras no caduquen. | low | S |
| 75 | P3 | DX y onboarding | README omite el conector `connect-meeting` (sí existe en el CLI). Añadir la fila a la tabla de conectores o marcar como experimental. | low | S |
| 76 | P3 | DX y onboarding | CONTRIBUTING afirma "incremental por sourceReference" (engañoso: la extracción IA cara se re-ejecuta). Matizar: guardado idempotente pero extracción no incremental; añadir caché/manifiesto. | low | S |
| 77 | P3 | DX y onboarding | Comentarios de código desfasados ("cuando migren…" ya migrado; stdout vs stderr de OTP). Poda de comentarios/TODO resueltos en `apps/cli` y `packages/core`. | low | S |
| 78 | P3 | DX y onboarding | `git pull --ff-only \|\| true` en el instalador silencia fallos de actualización. Avisar cuando el pull falla (cambios locales/divergencia) en vez de tragarlo. | low | S |
| 79 | P3 | DX y onboarding | Sin LICENSE ni plantillas de PR/issue. Añadir `.github/PULL_REQUEST_TEMPLATE.md` con el checklist de CONTRIBUTING; LICENSE/NOTICE interno. | low | S |
| 80 | P3 | Tests y operación | Migraciones sin rollback, checksums ni lock. `pg_advisory_lock`, checksums, forward-only y backup pre-migración. | low | M |
| 81 | P3 | Arquitectura | `recordUsage` (INSERT) en el camino caliente y serializado de cada generación LLM. Hacerlo fire-and-forget o bufferizar uso/trazas y flush por lotes; flush en el shutdown. | low | M |
| 82 | P3 | Arquitectura | `fs` síncrono en walkRepo/chunkFile y carga completa de relations/transcripts en memoria. Migrar a `fs/promises`+streaming; filtrar relations por proyecto en SQL; cota de tamaño. | low | M |
| 83 | P3 | Modelo de datos | Heurística de 'corroborado' (`updated_at > created_at + 1 min`) frágil para auto-curación. Registrar corroboración explícita (`metadata.corroborations` o tabla de eventos). | low | M |
| 84 | P3 | Modelo de datos | Columnas bi-temporales de `relations` declaradas pero nunca usadas. Implementar invalidación temporal de relaciones (cerrar `valid_to`) o retirar las columnas. | low | M |
| 85 | P3 | Calidad de memoria | FTS y embeddings monolingües sin detección de idioma (config 'spanish' hardcodeada). Detectar idioma por entrada y usar la config adecuada; peso configurable entre ramas RRF. | low | M |
| 86 | P3 | Cobertura del plan | Existe una suite de tests (contradice "Sin tests"), pero cobertura parcial. Actualizar roadmap; priorizar tests de heurísticas críticas (RRF, polaridad, caminos del reconciler). | low | M |
| 87 | P3 | DX y onboarding | Inconsistencia de naming en la ayuda del CLI (`cortex:link` pnpm vs `cortex link`). Unificar mensajes de uso a `cortex <sub>`; reservar `pnpm cortex:*` para infra. | low | M |
| 88 | P3 | Arquitectura | Estado global de proceso para classifier/reranker/reconciler (singletons module-level). A medio plazo, inyección por contexto/petición (multi-tenant); documentar como límite conocido. | low | L |

## Olas de ejecución

### Ahora (P0 / P1) — bloquea confianza, seguridad y correctitud del grafo
Filas **1-8** (1 critical + 7 high). Foco: aislamiento por proyecto/cliente (autorización default-deny en core para search/ask, #1/#8), broken access control de escritura y mutación (#2, #3, #4), XSS (#5), fuga de secretos al LLM (#6) y corrupción irreversible del grafo en mantenimiento (#7). Casi todo esfuerzo **S** salvo #1/#8 (M): se puede cerrar en pocos días y elimina las fugas de datos confidenciales y la corrupción de datos. **Hacer primero**: la autorización centralizada (#1, #8) destapa y cierra de paso #4 (fail-open) y #5 (XSS habilitado por el fail-open).

### Siguiente (P2) — robustez, atomicidad y calidad de retrieval
Filas **9-56** (medium). Tres bloques:
- **Integridad/atomicidad** (S/M): transacciones en escrituras compuestas (#28), constraints únicos + `ON CONFLICT` (#13, #15, #16), dimensión fija de `vector` (#34), señal única de vigencia (#35), colisión de slug (#36), TOCTOU en OTP (#20).
- **Resiliencia operativa** (M): timeouts/AbortSignal en LLM (#29), TTL de sesiones MCP (#30), rate-limit (#42), validación de payload (#43), hardening de transporte (#44), backup (#51), observabilidad HTTP (#52), healthchecks (#25).
- **Calidad de memoria** (M/L): reconciler usable (#9, #37), índice ANN (#38), reranker cross-encoder (#39), chunking (#55) y, transversal, el **harness de evaluación con golden set** (#54) que debe preceder cualquier recalibración de umbrales.

### Más adelante (P3) — pulido, deuda menor y "mantener"
Filas **57-88** (low). Mejoras incrementales (índices #60, naming CLI #87, caché de extracción), poda de documentación (#70, #75-79, #86), endurecimiento opcional del cliente Postgres (#57) y refactors de fondo (singletons → inyección por contexto #88). Incluye los **aciertos a preservar** (#59, #61, #62, #64-69, #73, #74): no requieren trabajo más allá de no regresarlos y replicar sus buenos patrones.
