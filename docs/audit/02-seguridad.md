# Seguridad y autenticación — Auditoría Cortex

## Valoración general

La **identidad** está bien construida: OTP y tokens hasheados (SHA-256), tokens de 32
bytes con CSPRNG, canje atómico de tickets de un solo uso, SQL parametrizado y `esc()`
consistente en el render. El modelo de aislamiento por proyecto existe y es correcto
(`canAccessProject` / `listAccessibleProjects`). El problema serio **no es criptográfico
sino de autorización**: ese modelo de aislamiento está construido pero **no se aplica** en
las rutas de lectura/escritura clave. La consecuencia es una fuga de confidencialidad
**crítica** (búsqueda/ask sin proyecto leen y sintetizan respuestas LLM sobre proyectos
privados ajenos) más varios fallos de control de acceso roto (IDOR de escritura, guard
fail-open) y un XSS reflejado habilitado por ese mismo fail-open. No está a la altura de
un sistema de primera línea hasta cerrar la capa de autorización: hoy el patrón dominante
es **default-allow** donde debería ser **default-deny**.

> Para un PoC interno con whitelist de dominio el blast radius está acotado a usuarios ya
> autenticados de la consultora, pero el efecto (un empleado de un cliente lee la memoria
> privada de otro cliente) es exactamente lo que esta plataforma promete evitar.

---

## Hallazgos por severidad

### 🔴 Crítico

#### C1 · Búsqueda/ask sin proyecto filtra proyectos privados (web y MCP)
- **Evidencia:** `apps/web/src/index.ts:264` (`/search`) y `:392` (`/ask`) invocan la
  búsqueda con `project` indefinido; `guardProject` devuelve `true` cuando el nombre está
  vacío (`apps/web/src/index.ts:78`). En MCP, `guard()` permite cuando no hay `project`
  (`apps/mcp-server/src/server.ts:47`). `searchContext` fija `projectId=null`
  (`packages/core/src/operations.ts:243`) y `hybridSearch`/`vectorSearch` solo filtran
  `if (args.projectId)` (`packages/database/.../vectors.ts:84,171`), por lo que un
  `projectId` nulo busca en **todos** los proyectos, incluidos los privados.
- **Impacto:** Cualquier usuario autenticado lee entradas y obtiene **respuestas LLM
  sintetizadas** (`ask_project_context`) de proyectos privados a los que no tiene acceso.
  Fuga de datos confidenciales cross-tenant.
- **Recomendación:** Mover la autorización al core: cuando no se especifica proyecto,
  restringir la búsqueda a los `projectIds` accesibles del usuario
  (`listAccessibleProjects`), con semántica **default-deny**. No confiar en el guard de la
  capa web/MCP.
- **Esfuerzo:** M

### 🟠 Alto

#### A1 · `validate` sin comprobar acceso (MCP y web) — IDOR/BOLA
- **Evidencia:** `apps/mcp-server/src/server.ts:153-161` y `apps/web/src/index.ts:347-353`
  llaman a `validateEntry` **sin guard**, a diferencia del resto de rutas (incluido el
  propio `GET /entry/:id` en `:292`). `operations.ts:278-284` hace el `UPDATE` solo por
  `id` (UUID), sin scope de proyecto.
- **Impacto:** Un autenticado muta el estado (`validated`/`rejected`/`obsolete`) de
  entradas de proyectos privados ajenos conociendo el UUID. Violación de integridad
  cross-tenant. Atenúa que solo afecta al campo `status` y requiere conocer un UUID v4 no
  enumerable.
- **Recomendación:** `validateEntry` debe recibir el email y verificar
  `canAccessProject` del proyecto de la entrada (resolver proyecto desde el `id` y
  comprobar antes del `UPDATE`).
- **Esfuerzo:** S

#### A2 · `POST /save` (web) escribe en cualquier proyecto sin autorización
- **Evidencia:** `apps/web/src/index.ts:356-364`: el handler llama a
  `saveContext({ project, type, createdBy: "web-ui" })` sin `guardProject`, mientras todas
  las rutas de lectura del fichero sí lo hacen (`/search:263`, `/ask:387`, `/pack:430`,
  `/code:475`, `/lint:512`, `/graph:624`). `type` se castea `as never` sin validar.
- **Impacto:** Cualquier autenticado contamina la memoria de proyectos privados ajenos
  (broken access control de escritura); además `createdBy` queda fijado a `"web-ui"` en
  vez del email, rompiendo la atribución / no repudio.
- **Recomendación:** Exigir `guardProject(email, project)`, fijar `createdBy = user.email`
  y validar `type` contra el enum del dominio (zod).
- **Esfuerzo:** S

#### A3 · `guardProject` es fail-open
- **Evidencia:** `apps/web/src/index.ts:77-81`: devuelve `true` si no hay nombre **o** si
  `findProjectByName` (resolución por nombre exacto sensible a mayúsculas,
  `projects.ts:34`) no encuentra el proyecto. La capa de datos, en cambio, resuelve el
  mismo nombre por `canonical_name = canonicalize()` (`code.ts:141-143`, `text.ts:10-17`).
- **Impacto:** Un usuario logueado lee un proyecto privado variando
  mayúsculas/espacios/acentos: el guard falla abierto mientras la consulta sí resuelve el
  proyecto real y filtra sus entradas. Habilita además el XSS de A4.
- **Recomendación:** **Default-deny** por slug canónico; unificar la resolución de nombre
  del guard con la del core (`findProjectId` / `canonicalize`).
- **Esfuerzo:** S

#### A4 · XSS reflejado en `/graph` vía `JSON.stringify(project)`
- **Evidencia:** `apps/web/src/index.ts:659` inserta `project` (query param leído en
  `:623`) con `JSON.stringify` dentro de un `<script>` inline. `JSON.stringify` **no**
  escapa `</script>`, así que `?project=</script><script>…</script>` ejecuta JS arbitrario.
  El fail-open de A3 permite inyectar nombres arbitrarios sin bloqueo previo.
- **Impacto:** Ejecución de JavaScript arbitrario en el navegador de un usuario
  autenticado. La cookie `httpOnly` limita el robo de sesión, pero permite acciones en la
  sesión de la víctima.
- **Recomendación:** Escapar `<` en la salida JSON (`<`) o pasar el dato vía atributo
  `data-` con `esc()`; añadir CSP sin `inline`.
- **Esfuerzo:** S

#### A5 · Fuga de secretos al LLM en conectores no-Claude
- **Evidencia:** `captureCondensedViaApi` (`connect-sessions.ts:147-159`) pasa su input
  `condensed` directo a `distill` → `runAgent` (`:153`), que postea al endpoint remoto
  OpenRouter/DeepSeek (`mastra.ts:82`), **sin** `scrub()`. El camino Claude sí limpia en
  `condenseSession:84`, pero `session-readers.ts:22-34` (codex/opencode/hermes) y
  `connect-meeting.ts:54` (`ex.text`) pasan texto crudo; `scrub()` solo corre sobre lo
  persistido (`:164`).
- **Impacto:** Claves, tokens y connection-strings en claro hacia un endpoint LLM de un
  tercero. Exfiltración irreversible. Atenúa el estado de PoC y el LLM local por defecto.
- **Recomendación:** Centralizar `scrub()` **antes** de `distill` en todos los caminos;
  ampliar el scrub a connection strings y cookies; añadir test.
- **Esfuerzo:** S

### 🟡 Medio

#### M1 · Sin rate-limit en `/auth/request`
- **Evidencia:** `apps/server/src/index.ts:53-62` sin throttle ni middleware.
  `requestOtp` (`packages/core/src/auth.ts:48-60`) en cada llamada genera un OTP nuevo,
  invalida el previo (`:54`) e inserta una fila con `attempts=0` (default en
  `migrations/0009_auth.sql:18`) y envía correo Brevo.
- **Impacto:** Email-bombing y consumo de cuota/coste Brevo. Acotado por la whitelist de
  dominio (`isAllowedEmail`, `:51`): no se bombardean dominios arbitrarios. El "reset del
  lockout" **no** habilita takeover práctico (cap de 5 por OTP, código CSPRNG de 6
  dígitos, cada request invalida el anterior → ~200k correos para fuerza bruta,
  detectable). El vector creíble es abuso/DoS de correo.
- **Recomendación:** Throttle por email e IP, backoff y límite de OTP activos.
- **Esfuerzo:** M

#### M2 · Condición de carrera (TOCTOU) en `verifyOtp`
- **Evidencia:** `packages/core/src/auth.ts:67-82`: el `SELECT` del OTP, el chequeo
  `attempts >= MAX_ATTEMPTS` en JS y el `UPDATE` incremental no son atómicos ni usan
  lock; peticiones concurrentes comparten un contador obsoleto y superan el cap.
- **Impacto:** Se supera el límite de 5 intentos en paralelo. Mitigado: el incremento es
  atómico y el bypass queda acotado por la concurrencia de conexiones (una ráfaga de
  decenas de intentos, no ilimitado), de modo que la fuerza bruta del espacio de 1M sigue
  siendo impráctica, aunque la protección queda degradada.
- **Recomendación:** `UPDATE` condicional atómico con `RETURNING` (o `SELECT … FOR
  UPDATE`); lockout por email.
- **Esfuerzo:** S

#### M3 · Sin validación zod ni límite de payload/items (DoS)
- **Evidencia:** `apps/server/src/index.ts:146-152` y `:185` castean los bodies con
  `as never` sin zod; `:162-176` acepta `items` sin cota; ningún `POST` limita tamaño de
  body ni `content-type`.
- **Impacto:** Valores arbitrarios crudos al core; un `POST` o batch enorme agota
  memoria/CPU.
- **Recomendación:** Validar bodies con zod (400) y limitar tamaño de body e `items`
  (413).
- **Esfuerzo:** M

#### M4 · Hardening de transporte débil
- **Evidencia:** `install.sh` usa el origin del `Host` (`apps/server/src/index.ts:48`);
  MCP `http.ts:48-53` sin `enableDnsRebindingProtection`; `serve()` sin `hostname`
  (escucha en `0.0.0.0`); cookie de web sin `secure` ni CSRF (`apps/web/src/index.ts:99`);
  `/auth/cli` (`:89-97`) acepta token en query string.
- **Impacto:** Supply-chain por `Host` spoofeado, DNS rebinding al MCP local, sesión en
  claro, CSRF y token en logs/`Referer`.
- **Recomendación:** Fijar `CORTEX_PUBLIC_URL`; bindear `127.0.0.1` con `allowedHosts`;
  cookie `secure` + CSRF + cabeceras de seguridad; quitar el token de la query.
- **Esfuerzo:** M

#### M5 · Doble resolución de proyecto, sesiones MCP sin TTL, salidas sin timeout
- **Evidencia:** MCP `server.ts:48` resuelve por `findProjectByName` mientras el core usa
  `findProjectId` por `canonical_name` (`operations.ts:380`); `http.ts:17,50-56` mantiene
  un `Map` de sesiones que solo se purga en `onclose`; `email.ts:16` hace `fetch` a Brevo
  sin timeout.
- **Impacto:** Una variante de nombre concede acceso a un privado; sesiones colgadas sin
  límite; un Brevo lento cuelga el login.
- **Recomendación:** Resolver por identidad estable (slug canónico); idle-timeout y tope
  de sesiones; `AbortController` con timeout en las salidas HTTP.
- **Esfuerzo:** M

### 🟢 Bajo

#### B1 · Errores crudos del core/DB y OTP sin salt
- **Evidencia:** `apps/server/src/index.ts:157/:175/:188` devuelven `e.message`;
  `email.ts:29` incluye el body de Brevo; `auth.ts` hace `sha256(code)` sin salt;
  `verifyOtp` (`:63`) no re-valida `isAllowedEmail`.
- **Impacto:** Filtración útil para reconnaissance; hashing marginal del OTP; falta
  defensa en profundidad de dominio.
- **Recomendación:** Mensajes genéricos al cliente + logging interno; HMAC/salt del OTP;
  re-validar el dominio en `verify`.
- **Esfuerzo:** S

---

## Qué está bien (mantener)

- **Primitivas de identidad sólidas:** OTP y tokens hasheados (SHA-256), token de 32
  bytes con CSPRNG; `redeemUiTicket` hace canje atómico de un solo uso
  (`auth.ts:136-141`); el token de CLI nunca viaja en la URL (se canjea por ticket).
- **SQL parametrizado** en todo el acceso a datos; sin concatenación de strings.
- **`esc()` consistente** en el render del HTML (salvo el caso JSON inline de A4).
- **Modelo de aislamiento correcto:** `canAccessProject` con cascada bien resuelta y
  `listAccessibleProjects` (`projects.ts:75-103`) — existe y funciona, solo falta
  **aplicarlo** en las rutas afectadas.
- **Gate de sesión real:** la web devuelve 401 sin sesión (`index.ts:108-114`); el MCP
  no reutiliza session-ids (`http.ts:39`).

El trabajo pendiente es de **autorización y hardening**, no de rediseño criptográfico.

---

## Recomendaciones priorizadas

1. **(C1) Cerrar la fuga de proyectos privados en búsqueda/ask** — autorización en el
   core: sin proyecto → restringir a `projectIds` accesibles, default-deny. Afecta web y
   MCP. (M)
2. **(A3) Convertir `guardProject` en default-deny** y unificar la resolución de nombre
   con `canonicalize()`/`findProjectId` del core. Cierra el bypass por variante de nombre
   y precondiciona el XSS. (S)
3. **(A2) Proteger `POST /save`** con `guardProject`, `createdBy=user.email` y validación
   de `type`. (S)
4. **(A1) Añadir control de acceso a `validateEntry`** (email + `canAccessProject` del
   proyecto de la entrada) en MCP y web. (S)
5. **(A4) Corregir el XSS de `/graph`** escapando `<` en el JSON inline o usando atributo
   `data-`; añadir CSP. (S)
6. **(A5) Centralizar `scrub()` antes de `distill`** en todos los conectores y ampliarlo a
   connection strings/cookies, con test. (S)
7. **(M1/M2) Rate-limit y lockout de autenticación:** throttle por email/IP en
   `/auth/request` y `UPDATE` atómico con `RETURNING` en `verifyOtp`. (M/S)
8. **(M3/M4/M5) Hardening de transporte y entrada:** zod + límites de payload, cookie
   `secure`+CSRF, bind a `127.0.0.1` + `allowedHosts`/DNS-rebinding, timeouts en salidas
   HTTP, TTL de sesiones MCP. (M)
9. **(B1) Defensa en profundidad:** mensajes de error genéricos, HMAC/salt del OTP,
   re-validación de dominio en `verify`. (S)
