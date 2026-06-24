# Dinacode Cortex

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

> Hay dos públicos: **developers** que *usan* Cortex (sección siguiente, sin pnpm) e
> **infra/admin** que *opera el servidor* ([más abajo](#operar-el-servidor-infraadmin)).

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
cortex ui                            # abre la UI web ya autenticada
cortex --help                        # todos los comandos
```

**Qué obtienes (sin hacer nada más):** al abrir una sesión con tu agente, Cortex
**inyecta** el context-pack del proyecto; al cerrarla, **captura** lo aprendido
(destilado, no en crudo) firmado con tu email. Además, el toolbelt deja tus agentes con
MCP de Cortex + skills del ecosistema (Plane, Jira, Notion, Teams…).

- **Opt-in por repo:** sin `.cortex.json` no se inyecta ni captura nada. `cortex link --ignore`
  desactiva un repo concreto (p.ej. uno personal anidado).
- **Permisos:** los proyectos son **públicos** por defecto; `--private` los restringe a
  ti + miembros; `--parent <slug>` los cuelga de un cliente (heredan contexto y permisos).
- Solo necesitas que el **servidor de Cortex esté en marcha** (lo opera tu equipo de infra).

![Dashboard](./docs/screenshot-dashboard.png)
![Preguntar al agente de recuperación](./docs/screenshot-ask.png)
![Grafo de conocimiento](./docs/screenshot-graph-entities.png)

## Capacidades

- **Bucle automático (hooks)** — inyección de contexto al abrir sesión + auto-captura al
  cerrarla, en los 4 agentes. La captura **reconcilia** (estilo mem0: ADD/UPDATE/DELETE/
  NOOP) y se atribuye al usuario; `maintain` auto-cura (promueve lo corroborado, decae lo muerto).
- **Búsqueda híbrida** — vectorial (pgvector) + léxica (FTS) con Reciprocal Rank Fusion + rerank LLM opcional.
- **Grafo de conocimiento** — entidades y relaciones (LLM) con resolución de variantes y visualización.
- **Bi-temporal** — cada hecho tiene vigencia; lo obsoleto se **invalida, no se borra** (consultas *point-in-time*).
- **Context packs y Q&A** — paquete por proyecto/área + respuestas con citas; **herencia** del padre en la jerarquía.
- **Ingesta multimodal** — capa `extract` única: Word/PDF/Excel, `.drawio`, imágenes
  (caption por visión), audio/vídeo (whisper + ffmpeg).
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
LLM + Mastra) se **inyecta** desde los entrypoints. Detalle en [`docs/decisions.md`](./docs/decisions.md).

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
pnpm --filter @cortex/agents run maintain:worker   # mantenimiento programado (cron)
```

- **Auth:** login **email + OTP** sin passwords; el usuario **es su correo**
  (`CORTEX_AUTH_DOMAIN`, whitelist). **Admin(s):** `CORTEX_ADMIN_EMAIL` (coma-separado)
  ven todos los proyectos y gestionan permisos. OTP por **Brevo** (`BREVO_API_KEY`); sin
  clave, modo dev (el código se loguea, no se envía).
- **Proveedores** (`.env`, por defecto `local` sin claves):
  ```bash
  EMBEDDINGS_PROVIDER=nan        # local | nan | openai | voyage
  LLM_PROVIDER=nan               # none | nan | openrouter
  NAN_API_KEY=...                # nan.builders (OpenAI-compatible)
  ```
  `local` no es semántico (solo arranque sin claves); al cambiar de proveedor de
  embeddings hay que reindexar (cambian las dimensiones).
- **Mantenimiento** (server, idempotente, con lock): `pnpm --filter @cortex/agents run
  maintain ["<Proyecto>"]` encadena enrich(only-missing) → resolve → temporal → curate →
  reconcile → lint. El **sync de fuentes es manual** (lo dispara el developer); esto es
  solo mantenimiento.

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

## Ingesta de fuentes (conectores)

Se ejecutan con el CLI y escriben **por la API autenticada** (atribución + permisos +
embedding por lotes). Requieren `cortex auth login` y el servidor en marcha. El primer
argumento es el **slug** del proyecto (de `cortex link`):

```bash
cortex connect-github   "<slug>" <owner/repo>     # PRs/issues (vía gh)
cortex connect-docs     "<slug>" <ruta-dir>       # carpeta multimodal (docs/imágenes/audio/vídeo)
cortex connect-notion   "<slug>" <ruta-export>    # export de Notion (páginas + adjuntos, enlazados)
cortex connect-sessions "<slug>" <ruta-repo>      # backfill de sesiones de agente (destiladas)
```

La **indexación de código** (`index-code`) y el `lint`/`resolve`/`temporal` sueltos son
tareas de servidor (acceso directo a BD) — ver `pnpm --filter @cortex/core run …` y CONTRIBUTING.

## Estructura del repo

```
apps/        mcp-server (MCP stdio) · web (UI) · server (API + auth) · cli (cortex)
packages/    core · agents · embeddings · database · shared
config/      toolbelt.json (registry) · skills/ (vendored) · commands/
scripts/     install.sh (instalador) · cortex-sync.ts (toolbelt + hooks + CLI)
docs/        decisions.md · roadmap.md · research/ · capturas
```

Cómo contribuir, dónde vive cada cosa y convenciones: [`CONTRIBUTING.md`](./CONTRIBUTING.md).
