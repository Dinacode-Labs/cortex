# Auditoría integral de Dinacode Cortex — Resumen ejecutivo

> Auditoría a fecha **junio 2026** sobre la rama `main`. Ocho dimensiones, hallazgos
> críticos/altos verificados adversarialmente contra el código. Severidades: 🔴 crítica/alta ·
> 🟡 media · 🟢 baja / bien hecho. El producto es un **PoC interno** ("hipótesis a validar"),
> y la severidad se ha calibrado en consecuencia.

## Veredicto global

Cortex es un PoC **funcionalmente rico y con cimientos sólidos** —modelo de conocimiento
bi-temporal fiel al plan §14, búsqueda híbrida vector+FTS+RRF correcta, embeddings/LLM
realmente enchufables con fallback local, inyección limpia LLM↔core, las 8 tools MCP, y una
documentación de onboarding excepcionalmente honesta— pero **todavía no está al nivel de los
sistemas de memoria de primera línea** por dos clases de problema. Primero, **seguridad**: la
autorización es *opt-in* y *fail-open*, de modo que cualquier usuario autenticado puede leer
memoria de proyectos privados ajenos (búsqueda/ask sin proyecto → fuga de datos, **crítica**),
mutar entradas ajenas, escribir en proyectos ajenos, ejecutar XSS en `/graph` y filtrar secretos
en claro al LLM por los conectores no-Claude. Segundo, **madurez de memoria y operación**: no
hay harness de evaluación (recall/nDCG/MRR), los umbrales son constantes mágicas calibradas para
un modelo distinto al `local` por defecto, la reconciliación estilo mem0 está degradada (token cap
de 60 + parseo laxo), no se trocean documentos largos, no hay índice ANN, ni backup de Postgres, ni
observabilidad HTTP, y las escrituras compuestas carecen de atomicidad. Nada de esto es
irrecuperable: la base es correcta y la mayor parte del trabajo pendiente es **endurecer
autorización y cerrar la brecha de proceso/operación**, no rediseñar. Riesgos mayores hoy:
**confidencialidad cross-tenant** y **degradación silenciosa de la calidad de memoria con el uso**.

## Scorecard por dimensión

| # | Dimensión | Estado | Síntesis |
|---|-----------|--------|----------|
| 01 | Arquitectura, estabilidad y robustez | 🟡 | Buenos patrones (hooks, advisory lock, ON CONFLICT) pero escrituras compuestas sin transacción, LLM sin timeout, errores tragados en silencio. |
| 02 | Seguridad y autenticación | 🔴 | Primitivas de identidad sólidas, pero la **autorización es opt-in y fail-open**: fuga de proyectos privados (crítica), IDOR, escritura sin scope, XSS y fuga de secretos al LLM. |
| 03 | Modelo de datos y correctitud | 🟡 | Modelo bi-temporal coherente, pero fusión de entidades ignora el `type` (corrompe el grafo), umbrales descalibrados y falta de unicidad/atomicidad. |
| 04 | Calidad de memoria vs SOTA | 🟡 | Híbrido+RRF y bi-temporal por encima de RAG plano, pero sin evaluación, sin chunking, sin ANN, reconciliación mem0 rota y reranker apagado por defecto. |
| 05 | Cobertura de requisitos vs plan | 🟡 | Modelo §14, tools §16 y pluggability cumplidos; pero el filtrado por permisos se entrega de forma eludible, sin auditoría de accesos ni loop §12.8. |
| 06 | Solidez de la investigación | 🟡 | Research primario verificable y trazado a ADRs (memory-capture-policy), pero docs sin fecha/estado y un gap-analysis competitivo desfasado. |
| 07 | Tests, observabilidad y producción | 🟡 | Hay suite de tests (auth/permisos/integración), pero sin backup Postgres, sin healthcheck de apps, sin observabilidad HTTP ni TLS en deploy. |
| 08 | DX, onboarding y documentación | 🟢 | README/guía formativa excepcionales y honestos; derivas menores (CLAUDE.md "5 tools", `curl|sh` SSH sin pre-aviso, naming `cortex:link`). |

## Top 10 hallazgos (transversales, críticos/altos primero)

1. 🔴 **Crítica · Seguridad/Requisitos** — Búsqueda/ask sin proyecto filtra proyectos privados: `searchContext` pasa `projectId=null` y `hybridSearch` no filtra → cualquier autenticado lee y obtiene respuestas LLM de memoria privada ajena. *(vectors.ts:84,171; operations.ts:243; server.ts:47)*
2. 🔴 **Alta · Seguridad** — `guardProject` es **fail-open**: devuelve `true` si el nombre no existe, mientras la capa de datos resuelve el proyecto real por `canonical_name` → variantes de caso/acentos saltan el guard. *(web/index.ts:77-81)*
3. 🔴 **Alta · Seguridad** — `POST /save` (web) escribe en cualquier proyecto sin `guardProject`, con `createdBy="web-ui"` y `type as never` → contaminación y atribución falsa cross-tenant. *(web/index.ts:356-364)*
4. 🔴 **Alta · Seguridad** — `validate_context_entry` muta estado (validated/rejected/obsolete) de entradas de proyectos ajenos por UUID, sin control de acceso (IDOR/BOLA). *(MCP server.ts:153-161; web/index.ts:347-353; operations.ts:284)*
5. 🔴 **Alta · Seguridad** — XSS reflejado en `/graph` vía `JSON.stringify(project)` en `<script>` inline (no escapa `</script>`), habilitado por el fail-open del guard. *(web/index.ts:659)*
6. 🔴 **Alta · Seguridad** — Fuga de secretos al LLM en conectores no-Claude: `session-readers`/`connect-meeting` destilan texto crudo sin `scrub()` → claves/tokens/connection-strings en claro a un tercero, exfiltración irreversible. *(session-readers.ts:22; connect-sessions.ts:153)*
7. 🔴 **Alta · Datos** — `resolve-entities` fusiona entidades por **nombre ignorando el `type`** (`norm(e.name)`), choca con el `UNIQUE(type, canonical_name)` online y borra los "losers" → corrupción irreversible del grafo en el loop de mantenimiento. *(resolve-entities.ts:41,77)*
8. 🟡 **Media · Memoria** — Sin harness de evaluación (recall/nDCG/MRR) ni calibración: imposible demostrar calidad o detectar regresiones; umbrales mágicos (0.82/0.95/0.85/0.05) sin dataset reproducible. *(grep eval/recall → 0; dedup.ts:17-18)*
9. 🟡 **Media · Memoria/Datos** — Reconciliación estilo mem0 degradada: `maxOutputTokens=60` sobre modelo de razonamiento + match laxo + fallback a "update", y solo evalúa el vecino #1 → acumulación silenciosa de cuasi-duplicados (0.82-0.95). *(reconcile.ts:18; dedup.ts:38,103)*
10. 🟡 **Media · Arquitectura/Datos** — Escrituras compuestas (saveContext, supersede, captureBatch, indexRepo) **sin transacción**: un fallo a mitad deja entradas sin embedding, fuentes huérfanas o dos "vigentes" duplicadas. *(operations.ts:123-159; dedup.ts:112-114)*

## Las 5 apuestas de mayor impacto

1. **Autorización centralizada *default-deny* en `core`.** Empujar el email/identidad a `searchContext`/`ask`/`validateEntry`/`save`: sin proyecto, restringir a `listAccessibleProjects`; con proyecto, exigir `canAccessProject` siempre. Cierra de un golpe los hallazgos 1-4 (la fuga crítica y tres altas) y convierte la confidencialidad de "eludible" en invariante. **Por qué primero:** es el riesgo mayor (datos de varios clientes) y el hueco doc↔código más grave.
2. **Cerrar las fugas de XSS y de secretos al LLM.** Escapar `<` en la salida JSON de `/graph` (o `data-`+CSP) y centralizar `scrub()` en `captureCondensedViaApi` antes de cualquier `distill`, ampliándolo a connection-strings/cookies. **Por qué:** dos altas de seguridad con corrección de esfuerzo S/S y exposición irreversible (exfiltración).
3. **Harness de evaluación + recalibración por modelo.** Golden set (50-150 queries por proyecto de demo) midiendo recall@k/nDCG/MRR de `hybridSearch` y precisión/recall de la reconciliación; recalibrar 0.82/0.95/0.85/0.05 por embedding y fijarlo como gate en CI. **Por qué:** sin esto no se puede afirmar "primera línea" ni evitar regresiones silenciosas; es el gap más estructural de la dimensión de memoria.
4. **Atomicidad transaccional en los caminos de escritura + corregir la fusión de entidades.** Envolver saveContext/supersede/indexRepo en `sql.begin(tx)` (replicando el patrón ya presente en `resolve-entities`) y cambiar la clave de agrupación a `${type}:${canonicalize(name)}`. **Por qué:** elimina estados parciales/duplicados y la corrupción irreversible del grafo (hallazgos 7 y 10) con esfuerzo S/M.
5. **Mínimos de producción: backup, healthchecks y observabilidad HTTP.** Cron `pg_dump` con restore probado, healthcheck `curl -f /health` para server/web/mcp/worker, y middleware de logging con request-id/latencia/`app.onError`. **Por qué:** la BD es la única fuente de verdad (pérdida total irreversible hoy) y sin observabilidad no se puede operar ni diagnosticar; barato y desbloquea el paso de demo a interno fiable.

## Documentos por dimensión

- [01 — Arquitectura, estabilidad y robustez](./01-arquitectura.md)
- [02 — Seguridad y autenticación](./02-seguridad.md)
- [03 — Modelo de datos y correctitud](./03-datos.md)
- [04 — Calidad de memoria y retrieval vs SOTA](./04-memoria-sota.md)
- [05 — Cobertura de requisitos vs el plan fundacional](./05-requisitos.md)
- [06 — Solidez de la investigación](./06-investigacion.md)
- [07 — Tests, observabilidad, operación y producción](./07-ops.md)
- [08 — DX, onboarding y documentación](./08-dx.md)
- [09 — Modelos y costes](./09-modelos-y-costes.md)
- [99 — Backlog priorizado de hallazgos](./99-backlog-priorizado.md)
