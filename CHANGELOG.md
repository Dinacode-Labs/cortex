# Changelog

Cambios notables de Cortex. Formato: [Keep a Changelog](https://keepachangelog.com/es/1.1.0/);
versionado [SemVer](https://semver.org/lang/es/).

Mientras estemos en `0.x`, una versión **menor** puede traer cambios incompatibles y una
**patch** solo arregla cosas.

## [Unreleased]

### Added
- **Modo local, para probar Cortex sin desplegar nada** (`deploy/local.yml`): un compose que
  levanta Postgres, la API, la UI y el MCP en `127.0.0.1` con un solo comando, sin dominio,
  sin TLS, sin claves y sin pedir una sola variable de entorno. Los datos sobreviven a un
  reinicio, porque una memoria de proyecto solo demuestra su valor cuando lleva semanas
  acumulando. Antes, la única forma de verlo funcionando era montar el despliegue de
  producción entero.

### Changed
- Documentación consolidada para la v0.1.0: el roadmap deja de listar como pendiente lo que
  ya está hecho y se queda con lo que falta de verdad; el README, `CLAUDE.md` y
  `CONTRIBUTING.md` describen el producto que hay hoy, no el que se clonaba. Hay tests que
  vigilan los enlaces internos, los ADR citados y que no se cuele material corporativo.

## [0.1.0] — 2026-09-10

Primera versión publicable. Cortex deja de ser un repo que se clona para convertirse en un
servidor que se despliega y un CLI que se instala: `npm i -g @dinacode/cortex`, `cortex auth
login`, `cortex setup --all`, y los agentes de ese portátil ya leen y escriben en la memoria
del proyecto, sin claves de modelo y sin base de datos en local.

### Added
- **Despliegue de producción completo** (ADR-0027): imagen de tres etapas sin
  devDependencies ni fuentes, corriendo como usuario `node`; Caddy delante con TLS
  automático y un solo dominio (`/` la web, `/api` la API, `/mcp` el MCP, `/install.sh` el
  instalador); Postgres sin puertos publicados; copia diaria con retención 7d/4s/6m;
  `deploy/restore.sh` con modo simulacro y `deploy/backup-now.sh`; y `deploy/README.md` con
  los procedimientos de actualizar, restaurar y rotar credenciales.
- **`/health` de verdad** en API, web y MCP: hace `select 1` y devuelve 503 si la base no
  responde. Antes decían `ok` mientras el proceso viviera, que es justo lo que no hay que
  decirle a un orquestador. El worker, que no escucha en ningún puerto, deja un fichero de
  latido que el compose vigila.
- Cabeceras de seguridad en las tres apps y `CORTEX_BIND_HOST` para elegir en qué interfaz
  escuchan. Por defecto, solo local: asomarse a la red es una decisión de quien despliega.
- **El CLI se publica en npm como `@dinacode/cortex`**: un solo fichero de ~110 KB con
  `@cortex/client` y `@cortex/shared` dentro, y solo tres dependencias públicas fuera (el SDK
  de MCP, zod y yaml). Instalado global ocupa 24 MB, frente a los ~235 MB del clon del
  monorepo que hacía falta antes.
- **`cortex version`** (y `--version`): la versión del CLI, la del servidor y la versión
  mínima de cliente que el servidor exige. **`cortex upgrade`** instala la última publicada y
  recuerda pasar `cortex setup --all` después.
- **`cortex doctor`**: comprueba de una vez Node, la sesión, el servidor, el token, el MCP, el
  vínculo de esta carpeta y la integración de cada agente, y dice qué comando arregla cada
  fallo. Sale con código 1 solo si algo impide de verdad que Cortex funcione.
- **`cortex toolbelt sync|doctor`**: instala el registry de tu organización (MCPs, skills y
  comandos de terceros) en los agentes detectados. Simulacro por defecto, `--apply` para
  escribir. Una entrada a la que le falte su variable de entorno se omite con un aviso: un MCP
  registrado y roto es peor que uno ausente.
- **`cortex setup` cubre los cinco agentes**: Claude Code y Codex comparten plugin (Codex lee
  el mismo marketplace; solo su MCP se registra aparte), OpenCode recibe un plugin JS que
  inyecta el contexto y captura al quedarse la sesión inactiva, Pi una extensión que inyecta
  el contexto como mensaje de sesión y captura al cerrarla, y Hermes sus hooks y su MCP en
  `config.yaml`. Todos con copia de seguridad, idempotencia y `--remove`.
- **`cortex hook-capture --platform`** con detección automática: como el plugin es el mismo
  para varios agentes, el hook deduce cuál es por la ruta del transcript. Acepta `--session`
  (id o ruta) y `--cwd`, y en Codex, si el evento no trae ninguno de los dos, usa la sesión
  más reciente de ese repo.
- **Lectores de sesión por agente**: Pi (nuevo), y las variantes «una sola sesión» de Codex,
  OpenCode y Hermes que necesita el hook. `cortex connect-sessions` acepta ya `pi`.
- **`cortex setup <agente>|--all`**: instala la integración de Cortex en los agentes de tu
  equipo con el mecanismo nativo de cada uno. Idempotente, con copia de seguridad antes de
  tocar nada, `--dry-run`, `--remove` y `--status`. Instalar el CLI y configurar los agentes
  pasan a ser dos cosas distintas: se puede reconfigurar sin reinstalar (ADR-0032).
- **Plugin de Claude Code** (`plugin/claude-code/`, marketplace `dinacode-cortex` declarado
  en este mismo repo): hooks de contexto y captura, el MCP `cortex mcp`, la skill
  `cortex-capture` y `/cortex-save` en un solo paquete que el usuario ve y controla desde
  `/plugin`. Si no se puede instalar (repo privado sin acceso), `setup` cae a hooks en
  `~/.claude/settings.json` y funciona igual.
- **Migración desde la instalación anterior**, dentro del propio `cortex setup`: los hooks
  `pnpm -C <clon> cortex hook-*` se sustituyen en su sitio en vez de duplicarse, el MCP que
  apuntaba al repo clonado se vuelve a registrar contra el servidor, los symlinks a `config/`
  se retiran y el shim de `~/.local/bin/cortex` se borra. El clon en `~/.dinacode-cortex` se
  avisa pero no se toca: puede tener un `.env` con claves.
- **`cortex mcp`**: servidor MCP por stdio que hace de puente hacia el MCP HTTP del
  servidor, autenticado con el token de `cortex auth login`. Es lo que se registra en los
  agentes (`claude mcp add cortex -- cortex mcp`): el proceso local no toca la base de datos
  y las tools respetan los permisos del usuario. Si no hay sesión o el token ha caducado, el
  agente **arranca igual** (lista de tools vacía y aviso), en vez de fallar al inicializarse
  (ADR-0025).
- `CORTEX_HOME` sustituye a `~` al buscar `~/.cortex/credentials`, para poder usar una
  sesión aparte en pruebas sin pisar la del usuario.
- **`cortex-admin`**: los comandos de operador (migrate, seed, ingest, maintain, enrich,
  lint, conectores pesados y los servicios) salen del CLI a su propia app, que vive en la
  imagen de despliegue. El CLI `cortex` se queda con lo de developer y deja de depender de
  Postgres, Mastra y la extracción documental (ADR-0025).
- **Destilación de sesiones en el servidor** (`POST /capture/session`): los hooks mandan el
  transcript condensado y escrubado, y el servidor lo destila con su propia clave. Ningún
  portátil necesita ya credenciales de LLM. Idempotente por sesión —los hooks disparan
  varias veces sobre la misma— y si la sesión creció solo se destila la parte nueva
  (ADR-0025).
- **Endpoints nuevos en la API**: `GET /client-config` (público: la URL del MCP, la versión
  y la versión mínima de cliente, para que el CLI no adivine nada), `GET /version`,
  `GET /toolbelt.json`, `GET /projects/:slug` y `POST /projects`. Con ellos, `cortex link`
  deja de necesitar Postgres.
- **`@cortex/client`**: paquete nuevo con todo el lado cliente (credenciales, HTTP, cliente
  tipado de la API, `.cortex.json`, transcripts). Depende solo de `@cortex/shared`, sin
  Postgres ni Mastra, que es lo que permitirá distribuir el CLI con `npm i -g` (ADR-0025).
  Los contratos de la API pasan a `shared/api-contract.ts`, compartidos por servidor y
  cliente para que no se desincronicen.
- **Build compilado**: `pnpm build` (`tsc -b` con project references) genera `dist/` en cada
  paquete y app de servidor, y Docker arranca `node dist/...` en vez de transpilar con `tsx`
  en cada arranque. Desarrollar sigue sin requerir build gracias a una condición
  `development` en los `exports` (ADR-0030).
- Proveedor `openai-compatible` para LLM y embeddings: sirve para NaN, Ollama, vLLM o
  LM Studio con la misma configuración. `CORTEX_MODEL_<ROL>` admite `proveedor:modelo` para
  mandar un solo rol a otro proveedor (ADR-0024).
- Semáforo `CORTEX_LLM_CONCURRENCY` (def. 4) compartido por chat, visión, STT y embeddings:
  el límite del proveedor es por API key, no por endpoint.
- `CORTEX_PRICING_JSON` para corregir o dar de alta precios de modelos sin desplegar.
- Marca configurable: `CORTEX_BRAND_NAME` y logo por `CORTEX_BRAND_LOGO_SVG` /
  `CORTEX_BRAND_LOGO_FILE` (ADR-0013 revisado).
- Email transaccional enchufable: `CORTEX_EMAIL_PROVIDER=log|brevo|smtp`, validado al
  arrancar el servidor (ADR-0028).
- Licencia Apache-2.0, `NOTICE`, `SECURITY.md`, código de conducta, plantillas de issue/PR y
  Dependabot (ADR-0029).
- `docs/toolbelt-registry.md`: esquema del registry para que una organización declare su
  propio toolbelt fuera de este repo.

### Removed
- **`cortex sync`**. Hacía dos cosas a la vez: instalar Cortex y repartir las herramientas de
  la empresa. Ahora son `cortex setup` y `cortex toolbelt sync`, y quien escriba el comando
  viejo recibe un mensaje que lo explica. Con él se va el shim de `~/.local/bin`.

### Changed
- **La superficie de producto pasa a inglés**: las descripciones de las 8 tools MCP (las lee
  un modelo que puede estar trabajando en cualquier idioma), los mensajes del CLI, la skill
  `cortex-capture`, `/cortex-save` y los errores de la API que consume el CLI. Los prompts de
  los agentes LLM siguen en español —el corpus lo es—, y también los ADRs, el roadmap y los
  comentarios del código. La UI web se traduce más adelante.
- **`install.sh` ya no clona el repo**: instala el CLI desde npm, inicia sesión y llama a
  `cortex setup --all`. Node no se instala por su cuenta —meterle una versión a alguien por
  detrás le rompe otros proyectos—, se exige ≥ 20 y se dan tres formas de ponerlo. Los fallos
  típicos (npm sin permisos, `cortex` fuera del PATH) traen el comando exacto que los arregla.
- `cortex link` va por la API en vez de por la base de datos: era el último comando del CLI
  que necesitaba Postgres.
- `cortex hook-capture`, `connect-sessions` y `connect-meeting` ya no llaman al modelo: solo
  condensan y envían. El pipeline que destilaba en el cliente desaparece.
- La documentación de **proceso interno** (auditoría de seguridad, plan de refactor,
  estrategia de modelos con costes y la investigación de ingesta atada a un proveedor) sale
  del repo: abrir el código no es abrir el proceso. El criterio de qué se publica y qué no
  está en el ADR-0031.
- `nan` pasa a ser un **alias obsoleto** de `openai-compatible` (avisa al usarse; se retira
  en 0.2.0). Igual para `EMBEDDINGS_PROVIDER=nan`.
- `CORTEX_AUTH_DOMAIN` y `BREVO_SENDER` pierden su valor por defecto: dependían del dominio
  de quien escribió el producto. Sin `CORTEX_AUTH_DOMAIN` cualquiera puede registrarse, y el
  servidor lo avisa al arrancar.
- El toolbelt corporativo sale del repo a uno privado; `config/toolbelt.json` queda con lo
  del producto (ADR-0014 revisado, ADR-0026).
- Fixtures de tests a `example.com`; referencias a clientes reales neutralizadas.
- `xlsx` se instala desde el CDN oficial de SheetJS (0.20.3) en vez de npm, cuya versión
  está abandonada con dos CVE sin corregir.

### Fixed
- `scrub()` se aplica en **todos** los caminos de captura: hasta ahora solo los transcripts
  de Claude llegaban limpios al modelo; los de Codex, OpenCode, Hermes y las reuniones iban
  crudos. Además el servidor vuelve a limpiar lo que recibe, sin fiarse del cliente.
- `resolveEntities` agrupaba por nombre ignorando el tipo, así que fusionaba entidades
  distintas y borraba la perdedora sin vuelta atrás. Ahora la clave incluye el tipo.
- La elección de entidad canónica no tenía desempate estable y dependía del orden de filas
  de Postgres; era la causa de un test de integración intermitente.
- `loadEnv` resolvía el `.env` relativo a su propio fichero fuente, así que se rompía al
  compilar o al mover el paquete. Ahora busca por `CORTEX_ENV_FILE`, `INIT_CWD` y cwd.
- Una variable de entorno declarada pero vacía no caía a su valor por defecto:
  `EMBEDDINGS_PROVIDER=` reventaba el arranque en vez de usar `local`, y una clave vacía
  cortaba la cadena de fallback.
