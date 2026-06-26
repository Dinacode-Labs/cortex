# Tests, observabilidad, operación y producción — Auditoría Cortex

## Valoración

La base operativa es **sólida para un PoC**: CI ejecuta contra Postgres real con
advisory lock y aislamiento de volumen, el `docker-compose` de deploy está bien
ordenado (proyecto aislado del de dev para no borrar datos con un `down -v`,
migraciones one-shot que bloquean al resto hasta terminar, `depends_on` por
healthcheck de Postgres). No está, sin embargo, **a la altura de un sistema de
primera línea en producción**: faltan piezas de operación que cualquier servicio
con datos como única fuente de verdad necesita —backup/restore, healthchecks de
los servicios de app, observabilidad de la capa HTTP, alertas del worker y TLS en
el borde— y la red de regresión no cubre runtime (MCP/HTTP) ni la lógica de
dominio más sutil. Nada de esto es un defecto grave dado el carácter declarado de
hipótesis a validar, pero sí es la lista de deberes antes de poner clientes
reales encima.

## Hallazgos por severidad

### 🟡 Medio — Sin backup/restore de Postgres
- **Evidencia:** `deploy/docker-compose.yml` (líneas 17-73) define
  `postgres/migrate/server/web/mcp/worker` pero ningún servicio o cron de backup;
  los datos viven solo en el volumen `cortex-pgdata` (línea 25, 72-73). `scripts/`
  contiene únicamente `cortex-sync.ts` e `install.sh`; un grep en todo el repo de
  `pg_dump`/`pgbackrest`/`pg_restore` no devuelve nada.
- **Impacto:** Postgres es la **única fuente de verdad** (documental + vectorial +
  relacional). Un fallo de disco o un borrado de volumen significa pérdida total e
  irreversible. No hay punto de recuperación.
- **Recomendación:** cron de `pg_dump` (o pgbackrest) con retención, **restore
  probado** y documentado en `docs/`. Backup automático antes de cada migración.
- **Esfuerzo:** M

### 🟡 Medio — Servicios de app sin healthcheck (solo Postgres)
- **Evidencia:** en `deploy/docker-compose.yml` solo `postgres` define
  `healthcheck` (líneas 26-30). `server`, `web`, `mcp` y `worker` no, pese a que el
  server ya expone un endpoint trivialmente sondeable: `apps/server/src/index.ts`
  (`app.get("/health", …)`, línea ~37).
- **Impacto:** `restart: unless-stopped` reinicia procesos que mueren, pero **no
  detecta un servicio colgado** (event loop bloqueado, conexión a Postgres rota
  pero proceso vivo). Un worker muerto pasa inadvertido sin señal alguna.
- **Recomendación:** `healthcheck` con `curl -f /health` (que internamente haga un
  `SELECT 1`) en server/web/mcp; un latido/heartbeat para el worker (touch a una
  fila o log estructurado verificable).
- **Esfuerzo:** S

### 🟡 Medio — Sin observabilidad de la capa HTTP
- **Evidencia:** la única observabilidad es la de coste/uso de LLM (ADR-0016).
  `server`/`web`/`mcp` no tienen middleware de logging, ni request-id, ni medición
  de latencia, ni un `app.onError` uniforme.
- **Impacto:** imposible diagnosticar en operación: no se sabe la latencia por
  endpoint, ni la tasa de error, ni **qué tool MCP invocó quién**. Sin trazas de
  request no hay forma de correlacionar un incidente.
- **Recomendación:** middleware común (pino) con request-id, latencia, status y
  ruta; `app.onError` uniforme que registre y devuelva un cuerpo de error estable.
- **Esfuerzo:** M

### 🟡 Medio — Worker e install.sh sin alerta ni e2e
- **Evidencia:** `packages/agents/src/maintain-worker.ts` descarta el report del
  ciclo de mantenimiento y solo loguea (no hay tabla `jobs` ni registro
  persistente del resultado). `scripts/install.sh` usa `git … pull --ff-only ||
  true` (línea 21) y `"$CORTEX" auth login … || true` (línea 33): los fallos se
  tragan silenciosamente, y no hay test e2e del instalador.
- **Impacto:** un mantenimiento fallido pasa inadvertido (degradación silenciosa de
  la calidad de la memoria); un install fallido deja al cliente con la versión
  vieja **sin ninguna señal** de que no se actualizó.
- **Recomendación:** persistir resultados del worker en una tabla `jobs` con alerta
  (p. ej. vía Brevo) ante fallo; test e2e de `install.sh` que falle ruidosamente en
  vez de continuar con `|| true`.
- **Esfuerzo:** M

### 🟡 Medio — Runtime MCP/HTTP y dominio sin tests; deploy sin TLS
- **Evidencia:** `tests/integration` no arranca `server`/`web`/`mcp` vía
  `app.fetch`, y faltan unitarios de la lógica de dominio más delicada
  (RRF/fusión de ranking, detección de contradicciones, reconciliación, chunking).
  El deploy no termina en TLS: la cookie de sesión se emite sin `Secure`
  (`apps/web/src/index.ts` ~línea 99: `setCookie(c, "cortex_session", session, {
  httpOnly: true, sameSite: "Lax", path: "/", … })`).
- **Impacto:** posibles fugas de autorización y errores de lógica sutil sin red de
  regresión; con HTTP en claro la cookie viaja sin protección y un XSS en
  superficies como `/graph` se vuelve explotable end-to-end.
- **Recomendación:** tests con `app.fetch` (auth on/off, rutas protegidas) +
  unitarios de dominio; terminar TLS en un reverse proxy (Caddy/Traefik) con
  cabeceras de seguridad y marcar la cookie `Secure` en producción.
- **Esfuerzo:** L

### 🟢 Bajo — Migraciones sin rollback, checksums ni lock
- **Evidencia:** `packages/database/src/migrate.ts` aplica los `.sql` de
  `migrations/` en orden (líneas 25-40); es forward-only (no hay ficheros `down`),
  `schema_migrations` guarda solo `name` + `applied_at` (líneas 14-19, sin
  checksum) y no usa `pg_advisory_lock`.
- **Impacto:** acotado. Cada migración corre en **su propia transacción**
  (`sql.begin`, líneas 34-37), por lo que el DDL revierte atómicamente si falla; y
  la PK sobre `name` (línea 16) hace que un doble-apply concurrente falle de forma
  segura en vez de corromper la tabla. El riesgo real es la falta de rollback
  combinada con la ausencia de backup (ver hallazgo de backup).
- **Recomendación (nice-to-have):** `pg_advisory_lock` para serializar el runner,
  checksums de los ficheros aplicados, mantener forward-only explícito y backup
  pre-migración. Minoritario mientras sea un único operador con `pnpm db:migrate`
  manual.
- **Esfuerzo:** M

## Qué está bien

- **CI realista:** los tests corren contra un Postgres real (no mocks), con
  advisory lock y volumen aislado, lo que evita falsos verdes por dobles
  escrituras concurrentes.
- **Compose de deploy bien pensado:** proyecto `cortex-deploy` aislado del de dev
  para que su volumen `cortex-pgdata` nunca colisione ni lo borre un `down -v`
  (cabecera del fichero, líneas 5-7).
- **Orden de arranque correcto:** `migrate` es one-shot (`restart: "no"`) y el
  resto de servicios espera a `service_completed_successfully` además de a Postgres
  `service_healthy` (líneas 37-70). No hay carrera de arranque.
- **Healthcheck de Postgres con `pg_isready`** y reintentos, que es lo que de
  verdad gobierna el arranque del resto.
- **Migraciones transaccionales y fail-safe** ante doble-apply (PK en `name`).
- **Hay batería de tests** (`auth`, `domain`, `permissions`, `project-config`,
  `session-readers`, `core`, integración): la cobertura existe, aunque no llega al
  runtime de los servidores ni a toda la lógica de dominio.
- **Observabilidad de coste/uso de LLM ya implementada** (ADR-0016): el eje más
  caro del sistema ya está instrumentado.

## Recomendaciones priorizadas

1. **Backup/restore de Postgres** con restore probado y documentado, y backup
   automático pre-migración (M). Es lo único irreversible de la lista.
2. **TLS en el borde** (Caddy/Traefik) + cookie `Secure` + cabeceras de seguridad
   (parte de L). Cierra la exposición en claro de sesión y el XSS explotable.
3. **Healthchecks de server/web/mcp y heartbeat del worker** (S). Coste mínimo,
   gran ganancia en detección de fallos.
4. **Observabilidad HTTP**: middleware pino con request-id/latencia/status y
   `app.onError` uniforme en los tres servicios (M).
5. **Alertas del worker** (tabla `jobs` + aviso ante fallo) y **e2e de
   install.sh** que falle ruidosamente (M).
6. **Tests de runtime** (`app.fetch`, auth on/off) **y unitarios de dominio**
   (RRF, contradicciones, reconciliación, chunking) (L).
7. **Hardening de migraciones**: advisory lock + checksums + forward-only
   explícito (M). Nice-to-have mientras sea operación manual de un solo operador.
