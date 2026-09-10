# Dinacode Cortex

[![CI](https://github.com/Dinacode-Labs/cortex/actions/workflows/ci.yml/badge.svg)](https://github.com/Dinacode-Labs/cortex/actions/workflows/ci.yml)

**Memoria corporativa de contexto** — **producto interno de Dinacode**. Captura el
conocimiento disperso de los proyectos (decisiones, restricciones, incidencias,
convenciones, PRs, conversaciones, docs, código…), lo estructura en una capa **híbrida
— documental + vectorial + grafo + bi-temporal —** y lo expone a personas y agentes de
IA (Claude Code, Codex, OpenCode, Hermes) por un **MCP corporativo** y unos **hooks** que
automatizan el bucle: tu agente arranca **sabiendo** el proyecto y, al terminar, Cortex
**captura** lo aprendido (atribuido a tu email).

- Plan fundacional: [`dinacode-cortex-contexto-y-plan-demo.md`](./dinacode-cortex-contexto-y-plan-demo.md)
- Decisiones (ADR): [`docs/decisions.md`](./docs/decisions.md) · Roadmap: [`docs/roadmap.md`](./docs/roadmap.md)
- Contribuir (PRs): [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Auditoría integral (jun 2026): [`docs/audit/`](./docs/audit/README.md) · **Refactor de
  arquitectura en curso** (jul 2026): [`docs/refactor/`](./docs/refactor/README.md)

> **Cómo leer este README.** Tiene dos partes. La **práctica** (instalar, usar, operar)
> es referencia rápida. La **[guía formativa](#guía-formativa-cómo-funciona-por-dentro)**
> explica *desde cero* cómo funciona la tripa: qué es un embedding, qué es el RAG, qué es
> un grafo de conocimiento, qué hace cada agente de IA… No hace falta experiencia previa.
> El objetivo de esa parte es que **entiendas lo suficiente para juzgar si Cortex funciona
> bien y dónde hay que mejorarlo** — por eso cada concepto lleva un recuadro «⚠️ Qué mirar»
> con sus límites reales.

---

## Índice

**Práctico**
- [Para developers — instalar y usar](#para-developers--instalar-y-usar)
- [Capacidades](#capacidades) · [Arquitectura](#arquitectura)
- [Tools MCP (8)](#tools-mcp-8) · [Toolbelt](#toolbelt-skills-y-mcps-que-reparte-cortex-sync) · [Conectores](#ingesta-de-fuentes-conectores)
- [Operar el servidor (infra/admin)](#operar-el-servidor-infraadmin) · [Estructura del repo](#estructura-del-repo)

**[Guía formativa: cómo funciona por dentro](#guía-formativa-cómo-funciona-por-dentro)**
- [0. El problema y la idea](#0-el-problema-y-la-idea-en-una-imagen)
- [1. La unidad de conocimiento (y la trazabilidad)](#1-la-unidad-de-conocimiento-y-la-trazabilidad)
- [2. Embeddings y búsqueda vectorial — la base del RAG](#2-embeddings-y-búsqueda-vectorial--la-base-del-rag)
- [3. Búsqueda léxica y búsqueda híbrida (RRF)](#3-búsqueda-léxica-y-búsqueda-híbrida-rrf)
- [4. Rerank: una segunda opinión del LLM](#4-rerank-una-segunda-opinión-del-llm)
- [5. El grafo de conocimiento (entidades y relaciones)](#5-el-grafo-de-conocimiento-entidades-y-relaciones)
- [6. Bi-temporal: el tiempo, e «invalidar ≠ borrar»](#6-bi-temporal-el-tiempo-e-invalidar--borrar)
- [7. Los agentes de IA, uno a uno (con ejemplos)](#7-los-agentes-de-ia-uno-a-uno-con-ejemplos)
- [8. El bucle de captura y reconciliación (estilo mem0)](#8-el-bucle-de-captura-y-reconciliación-estilo-mem0)
- [9. El context pack y la herencia](#9-el-context-pack-y-la-herencia)
- [10. Lint y observabilidad](#10-lint-salud-del-conocimiento-y-observabilidad)
- [Cómo evaluar Cortex — checklist](#cómo-evaluar-cortex--checklist-para-developers)

---

## Para developers — instalar y usar

Un comando instala el CLI `cortex`, el **toolbelt** (MCP + skills + comandos) y los
**hooks** en tus agentes, e inicia sesión (email + OTP):

```bash
curl -fsSL https://<servidor-cortex>/install.sh | sh
```

Luego, en cualquier repo de trabajo:

```bash
cortex link --create "Mi Proyecto"   # crea el proyecto y vincula esta carpeta (.cortex.json)
cortex link <slug>                   # vincula a un proyecto que YA existe (si tienes acceso)
cortex ui                            # abre la UI web ya autenticada (listado de proyectos)
cortex --help                        # todos los comandos
```

**Qué obtienes (sin hacer nada más):** al abrir una sesión con tu agente, Cortex
**inyecta** el context-pack del proyecto; al cerrarla, **captura** lo aprendido
(destilado, no en crudo) firmado con tu email. Además, el toolbelt deja tus agentes con
MCP de Cortex + skills del ecosistema (Plane, Jira, Notion, Teams…).

- **Opt-in por repo:** sin `.cortex.json` no se inyecta ni captura nada. `cortex link --ignore`
  desactiva un repo concreto (p.ej. uno personal anidado).
- **Vincular a algo existente:** el slug es la identidad. Si haces `--create` y el slug ya
  existe, **no se crea un duplicado**: te vinculas (si tienes acceso) o, si es privado, se
  te avisa para **pedir acceso al admin** (sin crear nada).
- **Permisos:** los proyectos son **públicos** por defecto; `--private` los restringe a su
  dueño + miembros; `--parent <slug>` los cuelga de un cliente (heredan contexto y permisos).
  En la UI (`cortex ui` → **Proyectos**) ves los proyectos a los que tienes acceso; el
  **admin** los ve todos y **añade/quita** miembros de los privados.
- Solo necesitas que el **servidor de Cortex esté en marcha** (lo opera tu equipo de infra).

## Capacidades

- **Bucle automático (hooks)** — inyección de contexto al abrir sesión + auto-captura al
  cerrarla, en los 4 agentes. La captura **reconcilia** (estilo mem0: ADD/UPDATE/SUPERSEDE/
  NOOP) y se atribuye al usuario; `maintain` auto-cura (promueve lo corroborado, decae lo muerto).
- **Búsqueda híbrida** — vectorial (pgvector) + léxica (FTS) con Reciprocal Rank Fusion + rerank LLM opcional.
- **Grafo de conocimiento** — entidades y relaciones (LLM) con resolución de variantes y visualización.
- **Bi-temporal** — cada hecho tiene vigencia; lo obsoleto se **invalida, no se borra** (consultas *point-in-time*).
- **Context packs y Q&A** — paquete por proyecto/área + respuestas con citas; **herencia** del padre en la jerarquía.
- **Ingesta multimodal** — capa `extract` única: texto/Markdown, Word/PDF/Excel, `.drawio`,
  imágenes (caption por visión), audio/vídeo (whisper + ffmpeg).
- **Identidad y gobierno** — login email+OTP (sin passwords), admin(s) por env, proyectos
  públicos/privados, jerarquía cliente→subproyectos, atribución `created_by`=email.
- **Lint** del conocimiento + **indexación de código** + **observabilidad de IA** (coste/tokens + AI tracing).
- **MCP corporativo** (8 tools) consumible por Claude Code / Codex / OpenCode / Hermes.

## Arquitectura

```
Claude Code / Codex / OpenCode / Hermes
   │ (MCP, 8 tools)   │ (hooks: inyecta contexto / auto-captura)   │ (cortex CLI)
   ▼                  ▼                                            ▼
 apps/mcp-server    apps/server (API HTTP + auth OTP)        apps/web (UI, cookie auth)
        │                 │   ▲  los hooks/conectores escriben por la API autenticada
        └────────┬────────┘   │  (atribución + permisos); ya no tocan la BD directa
                 ▼            api-client
        packages/core  (@cortex/core)   ── dominio determinista: captura, búsqueda híbrida,
                 │   ▲                       context-pack, lint, bi-temporal, reconciliación,
                 │   │ setClassifier/        proyectos/slug/permisos/jerarquía, auth (OTP),
                 │   │ setReranker/          extract multimodal, captureBatch
                 │   │ setReconciler
                 │   └── packages/agents (@cortex/agents) ── Agents de Mastra (classifier,
                 │           graph, reranker, retriever, distiller, merger, reconciler) + maintain
                 ├── packages/embeddings (local|nan|openai|voyage)
                 └── packages/database (Postgres + pgvector + FTS + migraciones)
        packages/shared  ── modelo de dominio (zod)
```

`@cortex/core` es **determinista** y funciona sin claves; la inteligencia (`@cortex/agents`,
LLM + Mastra) se **inyecta** desde los entrypoints. El porqué de cada pieza está en
[`docs/decisions.md`](./docs/decisions.md); el **cómo funciona** se explica en la
[guía formativa](#guía-formativa-cómo-funciona-por-dentro).

## Tools MCP (8)

Dos transportes: **stdio** (local, por proceso — `pnpm mcp`) y **HTTP autenticado**
(Streamable HTTP — `cortex mcp-http`, puerto 8788), que exige el mismo token Bearer que
la API. Para conectar un agente al MCP por HTTP: `claude mcp add --transport http
cortex <url>/mcp --header "Authorization: Bearer <token>"`.

| Tool | Qué hace |
| --- | --- |
| `save_project_context` | Guarda conocimiento (clasifica, resume, detecta duplicados/contradicciones) |
| `search_project_context` | Búsqueda híbrida (vector + léxico + rerank) |
| `get_project_context_pack` | Paquete de contexto del proyecto/área; admite `asOf` (point-in-time) |
| `list_project_decisions` | Decisiones vigentes |
| `validate_context_entry` | Validar / rechazar / marcar obsoleta |
| `ask_project_context` | Pregunta en lenguaje natural → respuesta sintetizada con fuentes |
| `search_project_code` | Búsqueda híbrida sobre el código indexado |
| `lint_project_context` | Salud del conocimiento (contradicciones, duplicados, huecos…) |

## Toolbelt: skills y MCPs que reparte `cortex sync`

Además del MCP de Cortex, `cortex sync` instala un set de **capacidades compartidas del
equipo** en tus agentes. Reparte **configuración, no credenciales**: cada tool necesita su
propia auth (`cortex sync --doctor` dice qué falta). Registry **PR-able**:
[`config/toolbelt.json`](./config/toolbelt.json) — para añadir/mejorar una skill, PR aquí.

**Skills** (instrucciones + scripts que el agente usa):

| Skill | Qué hace | Auth |
| --- | --- | --- |
| `cortex-capture` | Capturar conocimiento en Cortex (decisiones, incidencias, convenciones…) con baja fricción | — (usa el MCP `cortex`) |
| `bkt` | CLI de Bitbucket (Data Center + Cloud): repos, PRs, ramas, issues, webhooks, pipelines | token Bitbucket (keyring) |
| `plane-api` | Helpers REST de Plane (self-hosted) para lo que el MCP no cubre: adjuntos nativos, Markdown→HTML | `PLANE_API_KEY` |
| `google-chat` | Google Chat: listar spaces, enviar/leer mensajes, gestionar DMs | OAuth Google |
| `agent-teams` | Microsoft Teams: enviar mensajes, leer canales, reacciones | credenciales Teams |
| `expect` | QA de front-end: testea/valida componentes React/`.tsx`/`.css` (expect-cli), busca bugs de UI | — (CLI local) |

**MCPs** (servidores de tools que se registran en el agente):

| MCP | Qué da | Auth |
| --- | --- | --- |
| `cortex` | Las 8 tools de memoria de arriba | token Cortex (en HTTP) |
| `plane` | Gestión de proyectos Plane (tickets, ciclos, módulos, work items…) | `PLANE_API_KEY` |
| `atlassian` | Jira + Confluence | OAuth Atlassian |
| `notion` | Páginas y bases de Notion | token Notion |
| `chrome-devtools` | Inspección/automatización de Chrome (depurar front-end) | — |

**Comando**: `/cortex-save` (guardar contexto desde el chat del agente).

## Ingesta de fuentes (conectores)

Se ejecutan con el CLI y escriben **por la API autenticada** (atribución + permisos +
embedding por lotes). Requieren `cortex auth login` y el servidor en marcha. El primer
argumento es el **slug** del proyecto (de `cortex link`):

```bash
cortex connect-github   "<slug>" <owner/repo>     # PRs/issues (vía gh)
cortex connect-docs     "<slug>" <ruta-dir>       # carpeta multimodal (docs/imágenes/audio/vídeo)
cortex connect-notion   "<slug>" <ruta-export>    # export de Notion (páginas + adjuntos, enlazados)
cortex connect-sessions "<slug>" <ruta-repo> [claude|codex|opencode|hermes]  # backfill de sesiones
```

Por defecto la captura tipa los items por **heurística** (barato) y la inteligencia
(reclasificación de tipos, grafo, reconciliación, curación) se aplica luego con
`cortex maintain` (su paso `reclassify` re-tipa con LLM lo ingerido por heurística, sin
re-ingerir). Con `CORTEX_CAPTURE_LLM=1` cada item se **clasifica con el LLM** ya en la
ingesta (tipos fiables desde el minuto uno), a cambio de 1 llamada LLM por item.

La **indexación de código** (`cortex index-code`) y `cortex lint` / `resolve-entities` /
`temporal` sueltos son tareas de servidor (acceso directo a BD) — ver `cortex --help` y CONTRIBUTING.

## Operar el servidor (infra/admin)

Requisitos: Node ≥ 20, pnpm, Docker.

```bash
git clone git@github.com:Dinacode-Labs/cortex.git && cd cortex
pnpm install
cp .env.example .env          # proveedores, Brevo (OTP), CORTEX_ADMIN_EMAIL, CORTEX_AUTH_DOMAIN
pnpm db:up && pnpm db:migrate # Postgres + pgvector (Docker, puerto host 5433) + esquema
pnpm cortex server            # API HTTP + auth (8787) — sirve también /install.sh
pnpm web                      # UI web (8080)
pnpm cortex mcp-http          # MCP por HTTP autenticado (Streamable HTTP, 8788)
pnpm cortex maintain-worker   # mantenimiento programado (cron)
```

- **Auth:** login **email + OTP** sin passwords; el usuario **es su correo**
  (`CORTEX_AUTH_DOMAIN`, whitelist). **Admin(s):** `CORTEX_ADMIN_EMAIL` (coma-separado)
  ven todos los proyectos y gestionan permisos. OTP por **Brevo** (`BREVO_API_KEY`); sin
  clave, modo dev (el código se loguea, no se envía).
- **Proveedores** (`.env`, por defecto `local`/`none` sin claves). Todo endpoint soportado
  habla el dialecto OpenAI, así que un solo proveedor genérico sirve para NaN, Ollama,
  vLLM o LM Studio (ADR-0024). Ejemplo con NaN:
  ```bash
  LLM_PROVIDER=openai-compatible
  LLM_BASE_URL=https://api.nan.builders/v1
  LLM_API_KEY=...
  LLM_MODEL=deepseek-v4-flash            # 1M ctx, visión, tool calling
  CORTEX_VISION_MODEL=deepseek-v4-flash  # el de chat puede ser text-only

  EMBEDDINGS_PROVIDER=openai-compatible  # local | openai-compatible | openai | voyage
  EMBEDDINGS_BASE_URL=https://api.nan.builders/v1
  EMBEDDINGS_API_KEY=...
  EMBEDDINGS_MODEL=qwen3-embedding
  EMBEDDINGS_DIM=4096                    # obligatorio: fija el esquema vectorial
  ```
  `local` no es semántico (solo arranque sin claves); al cambiar de proveedor de
  embeddings hay que reindexar (cambian las dimensiones). `CORTEX_MODEL_<ROL>` cambia el
  modelo de un agente concreto y admite `proveedor:modelo` para mandar solo ese rol a otro
  sitio (p. ej. `CORTEX_MODEL_RETRIEVER=openrouter:x-ai/grok-4.5`). `CORTEX_LLM_CONCURRENCY`
  (def. 4) limita las llamadas en paralelo: el cupo del proveedor es por API key.
- **Mantenimiento** (server, idempotente, con lock): `pnpm cortex maintain
  ["<Proyecto>"]` encadena reclassify(tipos heurísticos→LLM) → enrich(only-missing) →
  resolve → temporal → curate → reconcile → lint. El **sync de fuentes es manual** (lo
  dispara el developer); esto es
  solo mantenimiento.

### Despliegue (docker-compose)

Stack completo en contenedores: Postgres (pgvector) + migraciones + servidor (API/auth) +
UI web + MCP HTTP + worker de mantenimiento. Una sola imagen, un comando por servicio.

```bash
cp deploy/.env.example deploy/.env     # edita: POSTGRES_PASSWORD, DATABASE_URL, dominio,
                                       # CORTEX_ADMIN_EMAIL, BREVO_API_KEY, proveedores
docker compose -f deploy/docker-compose.yml up -d --build
```

- `migrate` aplica el esquema antes de arrancar el resto (`service_completed_successfully`).
- Puertos: servidor `8787`, UI `8080`, MCP HTTP `8788`. Ponlos tras un proxy/HTTPS y fija
  `CORTEX_PUBLIC_URL`/`CORTEX_SERVER_URL`/`CORTEX_WEB_URL` al dominio. El servidor sirve
  `/install.sh` con esa URL inyectada → los devs hacen `curl -fsSL <dominio>/install.sh | sh`.
- El `DATABASE_URL` apunta al servicio interno `postgres` (su contraseña debe coincidir con
  `POSTGRES_PASSWORD`).

## Estructura del repo

```
apps/        mcp-server (MCP stdio+HTTP) · web (UI) · server (API + auth) · cli (cortex)
packages/    core · agents · embeddings · database · shared
config/      toolbelt.json (registry) · skills/ (vendored) · commands/
scripts/     install.sh (instalador remoto; lo sirve apps/server)
docs/        decisions.md · roadmap.md · research/ · audit/ (jun 2026) · refactor/ (jul 2026)
```

Las **reglas de dependencia** entre paquetes (qué puede importar qué) están en
[`CLAUDE.md`](./CLAUDE.md); hay un **refactor por fases en curso** — antes de tocar un
área, mira [`docs/refactor/README.md`](./docs/refactor/README.md).

Cómo contribuir, dónde vive cada cosa y convenciones: [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

# Guía formativa: cómo funciona por dentro

> Esta parte está pensada para **entender Cortex de verdad sin haber tocado antes RAG,
> embeddings ni grafos de conocimiento**. Vamos de lo simple a lo complejo, siempre con
> **un mismo ejemplo** (un proyecto ficticio, *Acme Portal*, con su *módulo de
> facturación*). Cada sección termina con un recuadro **«⚠️ Qué mirar»**: dónde están los
> límites reales, qué es solo «de demo» y qué podríamos mejorar. Léelo con espíritu
> crítico — todo el planteamiento de Cortex es **hipótesis a validar**.

## 0. El problema y la idea, en una imagen

**El problema.** En una consultora, el conocimiento de cada proyecto vive desperdigado:
en la cabeza de quien lo hizo, en un ticket de Plane, en un hilo de chat, en un PR, en un
PDF del cliente. Cuando entra alguien nuevo —o cuando un **agente de IA** abre una
sesión— empieza «a ciegas»: no sabe que *este* cliente prohíbe la nube pública, ni que
*ese* módulo ya petó dos veces por timeouts. Repite errores y vuelve a preguntar lo de
siempre.

**La idea.** Cortex es una **memoria de proyecto** que:

```
   CAPTURA            ESTRUCTURA                 RECUPERA              SIRVE
 (de muchas      (clasifica, vincula en      (búsqueda híbrida   (a personas por la UI;
  fuentes:        un grafo, fecha y marca   + grafo + filtro     a agentes de IA por el
  chat, PRs,      la vigencia de cada        temporal)            MCP y los hooks)
  docs, código,   hecho)
  sesiones IA)
```

El **bucle** que lo hace automático: cuando abres una sesión con tu agente, un *hook*
le **inyecta** lo que Cortex sabe del proyecto; cuando la cierras, otro *hook* **destila**
lo aprendido y lo **guarda**. Trabajas → Cortex aprende → el siguiente arranca sabiendo más.

**Una decisión de diseño que conviene tener clara desde ya:** Cortex está partido en dos.

- **`@cortex/core` es determinista**: guarda, busca, deduplica y vincula **sin usar ningún
  LLM**. Funciona sin claves de API.
- **`@cortex/agents` es la inteligencia**: envuelve llamadas a un LLM (clasificar, extraer
  el grafo, rerankear, sintetizar respuestas) y se **inyecta** en el core al arrancar
  (`setClassifier`, `setReranker`, `setReconciler`). Si no hay LLM, el core **cae a
  heurísticas** y sigue funcionando.
- **Precedencia siempre:** *input explícito > LLM > heurística*. La IA **aumenta**; nunca
  es un punto único de fallo.

## 1. La unidad de conocimiento (y la trazabilidad)

Todo lo que Cortex sabe son **entradas de contexto** (`context_entries`). Cada entrada es
**un hecho**: una decisión, una restricción, una incidencia, una convención… Hay **14
tipos** (`decision`, `constraint`, `incident`, `architecture`, `module_note`,
`technical_debt`, `convention`, `business_rule`, `integration_note`, `risk`, `how_to`,
`meeting_summary`, `pr_summary`, `ticket_resolution`).

Lo que diferencia a Cortex de «un cajón de notas» es que **cada hecho arrastra su
procedencia** (el principio de trazabilidad, §5.5 del plan). Una entrada de ejemplo:

```
title:            "El cliente Acme Corp no permite servicios cloud públicos"
content:          "La solución debe desplegarse en infraestructura propia (on-prem)."
type:             constraint
─── trazabilidad (§5.5) ───────────────────────────────────────────────
source_type:      meeting_transcript          ← de dónde salió
source_reference: "Reunión kickoff 2026-01"   ← referencia al original
created_by:       "ana@dinacode.com"           ← QUIÉN lo metió (atribución)
created_at:       2026-01-10                    ← CUÁNDO lo supimos
confidence:       verified                      ← cuánto nos fiamos
status:           validated                     ← estado en su ciclo de vida
validity:         current                       ← ¿sigue vigente?
valid_from/_to:   2026-01-10 / NULL             ← ventana temporal (ver §6)
```

- **`confidence`** (`low` < `medium` < `high` < `verified`): una nota auto-capturada de una
  sesión entra como `low`; algo confirmado contra una fuente real puede ser `verified`. El
  lint cuenta cuántas entradas de baja confianza hay.
- **`status`** (ciclo de vida): `draft → pending_validation → validated / rejected /
  obsolete / superseded`. El context-pack y la lista de decisiones **excluyen** lo
  `rejected`/`obsolete`.
- **`validity`** + **`valid_from`/`valid_to`**: la vigencia en el tiempo (sección 6).

> **💡 Por qué importa.** «No conviertas inferencias en hechos.» Si el caption de una
> imagen o el resumen de un LLM se guardan, se guardan **como inferencia** (con su
> confianza y su origen), no como verdad absoluta. Así un humano puede luego validar,
> rechazar o corregir, y siempre se sabe de dónde vino cada cosa.

> **⚠️ Qué mirar.** El `status` por defecto es `pending_validation`: hoy **nadie valida a
> mano de forma sistemática** (sería demasiada fricción), así que la calidad sube sola por
> la auto-curación (§8), no por revisión humana. Si para un cliente concreto necesitas
> garantías más fuertes, ese flujo de validación todavía no existe (está en el roadmap).

## 2. Embeddings y búsqueda vectorial — la base del RAG

**RAG** = *Retrieval-Augmented Generation*. En cristiano: en vez de pedirle al LLM que
conteste «de memoria», primero **recuperamos** los trozos de conocimiento relevantes y se
los damos como contexto. La pregunta del millón es: *¿cómo encontramos «lo relevante»?*

**Embedding (la pieza clave).** Un embedding convierte un texto en una **lista de números**
(un vector), de forma que **textos con significado parecido caen cerca** en ese espacio.
Imagina un mapa donde «caída del checkout» y «error al pagar» quedan casi pegados aunque
**no compartan ni una palabra**. Eso es lo que un embedding *semántico* captura.

**Búsqueda vectorial.** Para buscar, convertimos también **la pregunta** en un vector y
medimos qué entradas tienen el vector más «cercano». Cortex usa Postgres con la extensión
**pgvector** y mide la cercanía con la **distancia coseno** (operador `<=>`): cuanto menor
la distancia, más parecido. Devuelve las entradas ordenadas de más a menos cercanas.

**Los proveedores de embeddings son enchufables** (variable `EMBEDDINGS_PROVIDER`):

| Proveedor | Modelo | Dimensiones | ¿Semántico? |
| --- | --- | --- | --- |
| `local` (por defecto) | feature-hashing | 256 | **NO** — solo solape de palabras |
| `openai-compatible` | el que sirva el endpoint (p. ej. `qwen3-embedding` en NaN) | la que declares en `EMBEDDINGS_DIM` | Sí |
| `openai` | `text-embedding-3-large` | 3072 | Sí |
| `voyage` | `voyage-3` | 1024 | Sí |

> **⚠️ Qué mirar — esto es importante para no llevarte una falsa impresión:**
> - **`local` NO es semántico.** No es una red neuronal: hashea cada palabra a una de 256
>   «casillas» (el *hashing trick*). Dos textos se parecen **solo si comparten palabras
>   literales**; «coche» y «automóvil» caen en casillas distintas. Existe **solo para
>   arrancar sin claves** y probar el cableado. **Para evaluar la calidad real de búsqueda,
>   configura `nan`/`openai`/`voyage`** — con `local` el sistema *parece* tonto y no es
>   culpa del diseño.
> - **No hay índice ANN** (tipo HNSW/IVFFlat): la búsqueda vectorial es un **escaneo
>   exacto** sobre las filas filtradas. Correcto y simple, pero **O(n)** — escalará mal con
>   cientos de miles de entradas. Es una elección «de demo» consciente.
> - **Cambiar de proveedor obliga a reindexar.** Cada vector guarda su `embedding_model` y
>   sus dimensiones; la búsqueda solo compara contra vectores **del modelo activo**. Si
>   pasas de `local` (256) a `openai` (1536) sin re-embeber, la rama vectorial encuentra
>   **cero filas** (en silencio) y la búsqueda degrada a solo-léxico.
> - **Las entradas no se trocean** (una entrada = un vector). Una entrada larguísima se
>   embebe entera; no hay *chunking* de entradas (el código sí se trocea, ver §código).

## 3. Búsqueda léxica y búsqueda híbrida (RRF)

La búsqueda vectorial es genial para el **significado**, pero floja para lo **literal**:
si buscas `TICKET-4821` o `OAuth2 PKCE`, quieres ese token **exacto**, y el vector puede no
clavarlo. Para eso está la **búsqueda léxica** (FTS, *full-text search*): Postgres mantiene
un índice de las palabras de cada entrada (con *stemming* en español: «facturación»,
«facturar» y «factura» comparten raíz) y encuentra coincidencias de términos.

- **Vectorial** → capta *sentido* (paráfrasis, sinónimos).
- **Léxica** → capta *precisión* (IDs, nombres propios, jerga, acrónimos).

Cortex hace **búsqueda híbrida**: lanza **las dos** y **fusiona** los rankings. El problema
de fusionar es que sus puntuaciones no son comparables (la distancia coseno va de 0 a 1; el
score léxico es otra escala). La solución es **Reciprocal Rank Fusion (RRF)**, que ignora
las puntuaciones y usa solo la **posición** de cada resultado en cada lista:

```
puntuación_RRF(doc) = Σ   1 / (K + posición)        con K = 60
                   (sumando por cada lista — vectorial y léxica — donde aparece el doc)
```

**Intuición para no-iniciados:** estar el **1.º** de una lista vale un pelín más que estar
el 2.º, y mucho más que estar el 10.º, pero con rendimientos decrecientes (la `K=60`
suaviza la curva). Y lo más importante: si un documento aparece **en las dos listas**, sus
contribuciones **se suman** → sube arriba del todo. Es decir, **premia lo que es a la vez
semánticamente relevante y coincide en palabras**, que es justo lo que quieres.

**Ejemplo.** Pregunta: *«¿cómo desplegamos el módulo de facturación?»*

```
Rama VECTORIAL (por sentido)      Rama LÉXICA (por palabras)
 1. A  How-to: desplegar fact.     1. B  Constraint: facturación on-prem
 2. C  Decisión: elegimos Stripe   2. A  How-to: desplegar facturación
 3. B  Constraint: on-prem
 4. D  Incidencia: checkout

RRF fusiona →  A y B aparecen en AMBAS listas  →  suben a lo más alto
Resultado:  A , B , C , D     (A y B se separan claramente de C y D)
```

> **⚠️ Qué mirar.**
> - El **número que se muestra** como «score» de cada resultado **no es el valor RRF**: el
>   *orden* lo decide RRF, pero el score visible es la **similitud coseno** (para hits que
>   tocaron la rama vectorial) o el RRF normalizado (para los solo-léxicos). No ordenes
>   mentalmente por ese número.
> - El léxico usa `ts_rank` de Postgres (parecido a BM25, no idéntico). Para BM25 «de
>   verdad» habría que mirar `pg_search`/ParadeDB — anotado en las decisiones.

## 4. Rerank: una segunda opinión del LLM

La híbrida + RRF da un buen montón de candidatos, pero ordenados por una fórmula mecánica.
El **rerank** es un paso opcional: se cogen los ~15 mejores candidatos y se le pide a un
**LLM** que los reordene «de más a menos relevante» **para esta pregunta concreta** y
descarte el ruido. Es la diferencia entre «coincide» y «de verdad responde».

- Se activa solo si hay LLM configurado (y no `CORTEX_RERANK=off`). Se inyecta con
  `setReranker`; el core por sí solo no llama a ningún LLM.
- Es **a prueba de fallos**: si el LLM se cae, hay ≤1 candidato o la respuesta no parsea,
  se devuelve el orden híbrido **sin romper nada**. Nunca «pierde» resultados: los que el
  LLM no menciona se añaden al final.

> **⚠️ Qué mirar.** El *reranker dedicado* de nan (un modelo especializado) dio resultados
> **poco fiables** en pruebas (llegó a rankear una «receta de tortilla» por encima de docs
> de pagos), así que se usa el **LLM de chat** como reranker. Funciona, pero es **más caro
> y lento** que un reranker dedicado bueno (Cohere/Voyage) — punto claro a re-evaluar.

## 5. El grafo de conocimiento (entidades y relaciones)

Una búsqueda te da textos sueltos. Un **grafo de conocimiento** te da **cómo se relacionan
las cosas**. La idea, en simple:

- **Nodos (entidades):** las «cosas» del proyecto — un cliente, un módulo, una tecnología,
  un servicio, una persona, una integración… (hay **11 tipos** de entidad).
- **Aristas (relaciones):** conexiones **con tipo** entre nodos — «el módulo de facturación
  *depends_on* la integración con el ERP», «la incidencia X *caused_by* Stripe» (hay **10
  tipos** de relación: `depends_on`, `affects`, `caused_by`, `resolved_by`, `supersedes`,
  `contradicts`, `belongs_to`, `implemented_by`, `discussed_in`, `related_to`).

Un detalle elegante: **la propia entrada puede ser un nodo**. Cuando el extractor de grafo
encuentra una relación cuyo origen es la entrada misma, usa la palabra clave `"ENTRADA"`.
Así una incidencia se conecta directamente a lo que afecta:

```
[entrada: "El PDF de facturación falla con cargas grandes por timeouts"]
        │ affects
        ▼
[módulo: facturación] ──belongs_to──▶ [proyecto: Acme Portal] ──belongs_to──▶ [cliente: Acme Corp]
```

**Resolución de variantes (dedup).** «Acme», «Acme Corp» y «acme.com» son el mismo cliente.
Cortex normaliza los nombres (minúsculas, sin acentos) y mantiene **un nodo canónico por
(tipo, nombre normalizado)**. Un paso de mantenimiento (`resolveEntities`) fusiona además
las variantes que no se normalizan igual, re-apuntando sus enlaces y relaciones al nodo
ganador (el más conectado). Determinista, sin LLM.

**Qué preguntas te deja responder el grafo** (que la búsqueda por texto no puede):
- «¿Qué toca el módulo de facturación? ¿Qué se rompe si lo cambio?» → caminas las aristas.
- «¿Cuáles son los módulos sensibles del proyecto?» → entidades `module` del proyecto.
- «¿Dónde hay contradicciones?» → aristas `contradicts`.
- «¿Qué áreas petan pero no tienen ninguna decisión documentada?» (huecos) → ver lint (§10).

> **⚠️ Qué mirar.**
> - El «grafo» son **dos tablas en Postgres** (`entities` + `relations`), no una base de
>   datos de grafos (Neo4j). Va bien para expansión de 1 salto; **travesías profundas
>   multi-salto** serían incómodas con SQL.
> - La extracción de relaciones la hace un **LLM** (el agente `graph`): puede inventar o
>   perderse aristas. Hay un filtro de integridad (una relación solo sobrevive si sus dos
>   extremos son entidades conocidas), pero **no hay extracción de grafo sin LLM** — sin LLM
>   solo se detectan entidades por diccionario, no relaciones ricas.
> - Las **contradicciones entre entidades no se resuelven solas** (no hay «ganador» claro):
>   el lint las reporta para que un humano decida.

## 6. Bi-temporal: el tiempo, e «invalidar ≠ borrar»

Los hechos **cambian**. En enero decidimos «mantener el módulo legacy de facturación»; en
junio decidimos «migrarlo». Un sistema ingenuo **sobrescribe** el hecho viejo — y entonces
ya no puedes responder «¿qué creíamos en marzo?». Cortex es **bi-temporal**: nunca borra,
guarda *cuándo fue verdad cada cosa*.

Cada hecho lleva **dos ejes de tiempo**:
- **`valid_from` / `valid_to`** → la **ventana de vigencia**: desde cuándo y hasta cuándo
  fue verdad en el mundo real. **`valid_to = NULL` significa «vigente ahora mismo».**
- **`observed_at`** → cuándo lo **afirmó la fuente** (la fecha de la reunión, del ticket…).
- **`created_at`** → cuándo lo **ingirió Cortex** (el eje del sistema).

**El principio: invalidar ≠ borrar.** Para «retirar» un hecho no se borra la fila: se
**cierra su ventana** (se le pone `valid_to`). La fila sigue ahí, consultable. Una nueva
decisión que reemplaza a otra crea una arista `supersedes` y cierra la ventana de la vieja.

**Consultas *point-in-time* (`asOf`).** Como la historia se conserva, puedes preguntar «¿qué
sabíamos a fecha X?»:

```
2026-01-10  Decisión A: "mantener el módulo legacy"      → valid_from=01-10, valid_to=NULL
2026-06-01  Decisión B: "migrar el módulo legacy"         → B supersedes A
            (al invalidar)  A: valid_to=06-01, superseded_by=B, validity=superseded

  Consulta asOf = 2026-03-15  → devuelve A ("mantener")   ← lo que creíamos entonces
  Consulta asOf = 2026-06-10 (o sin asOf) → devuelve B ("migrar")  ← lo vigente
```

Por defecto, la búsqueda y el context-pack devuelven **solo lo vigente** (`valid_to IS
NULL`); `asOf` reconstruye cualquier foto del pasado. (Verificado en un proyecto real,
LevelUp: 266 hechos vigentes / 147 históricos; a 2026-05-28 había 182, a 06-12 había 239.)

> **⚠️ Qué mirar.** La auto-invalidación cubre **supersesiones entrada→entrada** y los
> hechos marcados «Histórico» (p.ej. legacy de Plane). Las **contradicciones entre
> entidades del grafo no se auto-invalidan** (las reporta el lint). Y no hay aún *decay*
> adaptativo por «volatilidad» del tema — el envejecimiento es por reglas fijas.

## 7. Los agentes de IA, uno a uno (con ejemplos)

Aquí «agente» **no** significa un robot autónomo que razona en bucle y usa herramientas.
Significa **un rol con una sola llamada a un LLM** (un *system prompt* + un *prompt* + parseo
del resultado + un *fallback* si falla). Hay siete, más un par de orquestadores. Todos pasan
por una función común (`runAgent`) que además **registra los tokens** gastados (observabilidad).

| Agente | Qué hace | Si no hay LLM |
| --- | --- | --- |
| `classifier` | Clasifica un texto y extrae entidades | heurísticas del core |
| `graph` | Extrae entidades **y relaciones** (el grafo) | no hay (solo entidades por diccionario) |
| `reranker` | Reordena los resultados de búsqueda | orden híbrido original |
| `retriever` | Redacta la respuesta en prosa citando el contexto | muestra los fragmentos en crudo |
| `distiller` | Destila una sesión/reunión a conocimiento tipado | no hay |
| `reconciler` | Decide noop / update / supersede ante un casi-duplicado | dedup determinista (solo noop) |
| `merger` | Fusiona dos piezas sobre lo mismo en una | conserva la existente |

**Ejemplos concretos de cada transformación:**

**`classifier`** — texto suelto → entrada tipada:
```
IN : "Decidimos introducir RabbitMQ para procesar las exportaciones de
      facturación de forma asíncrona y evitar timeouts."
OUT: { type: "decision",
       title: "Cola RabbitMQ para exportaciones de facturación asíncronas",
       summary: "Se introduce RabbitMQ para exportar facturación async y evitar timeouts.",
       entities: [ { name: "RabbitMQ", type: "technology" } ] }
```

**`graph`** — texto → entidades + relaciones:
```
IN : "La pasarela Stripe devolvió 500 en producción; lo causó un cambio de
      versión de la API de Stripe. Se resolvió fijando la versión."
OUT: { entities:  [ { name: "Stripe", type: "integration" } ],
       relations: [ { source: "ENTRADA", target: "Stripe", type: "caused_by" } ] }
```

**`reconciler` + `merger`** — info nueva que refina a la vieja:
```
EXISTENTE: "Se usa RabbitMQ para exportaciones asíncronas."
NUEVA    : "Las exportaciones de facturación ahora van por RabbitMQ con reintentos y DLQ."
reconciler → "update"   (refina, no contradice)
merger     → "Cola de exportaciones con RabbitMQ
              Las exportaciones de facturación se procesan async con RabbitMQ,
              con reintentos y dead-letter queue."   → reemplaza y re-embebe la vieja
```

**`retriever`** — pregunta + fragmentos → respuesta con prosa (clásico paso de
«generation» del RAG): redacta **solo** a partir del contexto recuperado y, si no basta,
lo dice.

> **⚠️ Qué mirar.**
> - **Modelos por defecto:** `qwen3.6` (vía nan, gratis) o `deepseek-v4-pro` (vía
>   OpenRouter). La calidad de clasificación, grafo y reconciliación **depende del modelo**;
>   evalúa con el que vayáis a usar en serio.
> - **Salida estructurada «a mano»:** los modelos no respetan de forma fiable el
>   `structuredOutput` de Mastra, así que se les fuerza `response_format: json_object` y se
>   **valida el JSON manualmente** (descartando claves/enlikes inválidos). Funciona y es
>   rápido, pero es un *workaround*.
> - **Cada agente es UNA llamada**, no un bucle de razonamiento con herramientas: simple y
>   barato, pero no «se lo piensa» ni se autocorrige.
> - **Detalle técnico:** `@cortex/agents` usa **zod v4** (lo exige Mastra), aislado del
>   **zod v3** del resto del repo. No se cruzan schemas entre ambos lados; la frontera se
>   cruza con tipos TypeScript planos.

## 8. El bucle de captura y reconciliación (estilo mem0)

Cuando entra conocimiento nuevo (al guardar, o al cerrar una sesión), no se vuelca «a lo
bruto». El paso clave es la **reconciliación** (inspirada en [mem0](https://github.com/mem0ai/mem0)):
por cada pieza nueva se busca la más parecida que ya existe y se decide **qué hacer**:

```
similitud ≥ 0.95  y misma fuente   → NOOP        (es casi idéntica, no añade nada)
similitud 0.82–0.95 (hay reconciler):
        reconciler dice "update"     → MERGE      (fusiona y re-embebe)   [solo auto-capturado]
        reconciler dice "supersede"  → INVALIDA   (cierra ventana de la vieja, ver §6)
                                       o, si la vieja es de FUENTE/CURADA → marca "contradicts"
        reconciler dice "noop"       → se queda la vieja
similitud < 0.82                    → ADD         (entra como hecho nuevo, confianza low)
```

**Guardarraíl crítico:** Cortex **nunca reescribe ni invalida automáticamente** conocimiento
de **fuente o curado por humanos**. Solo las entradas **auto-capturadas** (`agent_session`)
se fusionan o se superan solas; si una nota nueva contradice algo curado, se anota un
`contradicts` para que **lo revise una persona**. La IA no pisa lo que un humano dio por bueno.

**Auto-curación (sin humano en el bucle).** La captura escribe ya, con confianza baja. Luego
`maintain` ejecuta `autoCurate`, que **promueve** a confianza media lo que se ha
**corroborado** (volvió a salir en otra sesión) y **decae** (saca de búsqueda) lo viejo que
nunca se corroboró. La calidad sube sola con el tiempo, sin frenar la captura.

**Secretos.** Antes de que el LLM vea nada —y otra vez antes de guardar— se **borran
secretos** (claves PEM, JWT, `sk-…`, tokens de GitHub/Slack/AWS/Google, `Bearer …`/`Basic …`,
`api_key=…`, contraseñas dentro de connection strings y cabeceras `Cookie`). El borrado se
aplica en dos capas independientes: en la destilación, sea cual sea el agente de origen, y en
el guardado del servidor, que **no confía** en que el cliente haya limpiado. Las sesiones de
trabajo son logs personales: se destila el conocimiento, no se guarda el transcript crudo.

> **⚠️ Qué mirar.** Los umbrales (`0.95`, `0.82`) son **parámetros a calibrar**: muy altos
> → duplicados; muy bajos → fusiona cosas distintas. El reconciler, ante la duda (error del
> LLM), tira a **"update"** («no invalidar a la ligera»). Evalúa con datos reales si la
> reconciliación está fusionando lo que debe.

## 9. El context pack y la herencia

El **context pack** es «lo que un agente debería saber siempre» de un proyecto, en pequeño y
curado. `get_project_context_pack` arma: **decisiones vigentes, restricciones, riesgos,
deuda técnica, convenciones, módulos sensibles**, y —si pasas un `area`— un top-5 de lo más
relevante a esa área (búsqueda vectorial). Solo hechos **vigentes** por defecto; admite
`asOf` para la foto histórica.

**Herencia.** Un subproyecto **hereda el contexto de sus ancestros**. Si «Boluda» es el
cliente y `boluda-api` un subproyecto, el pack de `boluda-api` incluye lo común de «Boluda»
**sin** mezclar el contexto de `boluda-web`. Así se evita el *context-rot* de meterlo todo
en un saco, y a la vez no se duplica lo compartido. Los permisos cascada igual (ser miembro
de «Boluda» abre sus subproyectos).

Este pack renderizado a Markdown es **exactamente lo que el hook de `SessionStart` inyecta**
en tu agente al abrir sesión (vía la API autenticada, truncado a ~6000 caracteres).

> **⚠️ Qué mirar.** La herencia hoy aplica al **context-pack**, no a `search`/`ask` (una
> búsqueda en el subproyecto no trae aún lo del padre). Y el pack se **trunca**: en
> proyectos enormes, decidir *qué entra* en ese presupuesto de contexto es justo el tema que
> Alejandro levantó (índice navegable / jerárquico) y que está **a estudiar en el roadmap**.

## 10. Lint (salud del conocimiento) y observabilidad

**Lint.** Igual que un linter de código, `lint_project_context` revisa la **salud del
conocimiento** (un paso que casi ningún producto del mercado hace). Comprueba:
1. **Contradicciones** (aristas `contradicts` del grafo).
2. **Posibles duplicados** (pares con similitud vectorial > 0.88).
3. **Entidades huérfanas** (un nodo enlazado a una sola entrada y sin relaciones).
4. **Baja confianza** (cuántas entradas `low`).
5. **Histórico/obsoleto** (cuánto hay envejecido).
6. **Huecos** (la estrella): áreas con **≥2 incidencias y 0 decisiones** documentadas —
   módulos que petan y nadie ha dejado constancia de qué hacer.

Hay un planificador (`lint-act`) que convierte eso en acciones propuestas (abrir tarea para
un hueco, consolidar duplicados), pero **es dry-run**: imprime el plan y **no escribe nada**
en sistemas externos. Actuar (crear tareas reales) es un paso supervisado aparte.

**Observabilidad.** Cada llamada a IA (LLM + embeddings) registra sus **tokens** en la tabla
`llm_usage`, con una tabla de precios para **estimar coste** (con nan el coste es 0, pero
queremos poder estimar si se cambia a OpenAI/Anthropic). Además, cada ejecución de agente
emite un **árbol de trazas** (`agent_run → model_generation → …`) a la tabla `ai_traces`. La
UI `/usage` muestra coste por operación/agente/modelo y el árbol de trazas.

> **⚠️ Qué mirar.** El lint es **deterministico y barato**, pero sus umbrales y reglas (qué
> es «duplicado», qué es «hueco») son heurísticos: úsalos como señal, no como verdad. Y de
> momento **reporta**, no corrige (por diseño).

---

## Cómo evaluar Cortex — checklist para developers

El objetivo de toda esta guía es que puedas **juzgar con criterio** si Cortex funciona y
dónde mejorarlo. Cuando lo pruebes, mira sobre todo esto:

1. **¿Con qué proveedor de embeddings estás probando?** Con `local` la búsqueda **no es
   semántica** — no saques conclusiones de calidad. Configura `nan`/`openai`/`voyage`.
2. **¿La búsqueda híbrida trae lo relevante?** Prueba consultas por **significado** (deben
   funcionar por vector) y por **ID/jerga** (deben funcionar por léxico). Si algo evidente
   no sale, mira si está indexado y con qué confianza/vigencia.
3. **¿El grafo conecta bien las cosas?** Revisa entidades duplicadas (¿hace falta pasar
   `resolve`?) y relaciones inventadas o ausentes (las pone un LLM).
4. **¿La reconciliación fusiona lo que debe?** ¿Aparecen duplicados (umbral alto) o se mezcla
   lo que no debería (umbral bajo)? ¿Respeta lo curado por humanos?
5. **¿Lo temporal cuadra?** Marca algo como superado y comprueba que `asOf` devuelve la foto
   correcta y que lo vigente excluye lo viejo.
6. **¿La auto-captura destila bien?** Cierra una sesión y mira qué guardó: ¿conocimiento
   útil y tipado, o ruido? ¿Coló algún secreto (no debería)?
7. **Coste/latencia:** mira `/usage`. ¿Cuántos tokens cuesta clasificar/rerankear/destilar?
   ¿Compensa el LLM frente a las heurísticas para vuestro caso?

Todo lo de arriba es **hipótesis a validar**. Si encuentras un punto flojo, anótalo: las
decisiones vivas están en [`docs/decisions.md`](./docs/decisions.md) y lo pendiente/ideas en
[`docs/roadmap.md`](./docs/roadmap.md). Cómo contribuir: [`CONTRIBUTING.md`](./CONTRIBUTING.md).
