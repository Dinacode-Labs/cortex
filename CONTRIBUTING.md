# Contribuir a Cortex

Mejoras, arreglos y nuevas capacidades llegan por **PR** contra este repo. Esta guía explica
cómo está montado y dónde tocar cada cosa.

> **Nada corporativo en el repo.** Clientes por su nombre, personas como responsables de
> tareas, skills de herramientas internas y material de marca **no van aquí**: viven en un
> repo privado aparte (ADR-0026). En la documentación, un cliente es «un cliente real» o
> «Acme»; una tarea no lleva responsable.
>
> **Tampoco el proceso interno** (ADR-0031): qué proveedor usamos con qué clave y a qué
> coste, auditorías de seguridad, planes de refactor con hallazgos por fichero y prioridades
> de negocio. El producto documenta *cómo se configura*, no *qué configuración tiene nuestro
> despliegue*. Regla rápida: si ayuda a alguien de fuera a usar, entender o mejorar Cortex,
> es público; si describe cómo lo operamos nosotros, es privado. Ante la duda, privado.

## Puesta en marcha (dev)

```bash
pnpm install
cp .env.example .env          # embeddings/LLM; sin claves funciona en modo local
pnpm db:up && pnpm db:migrate # Postgres + pgvector (Docker) + esquema
pnpm typecheck                # comprobar tipos en todo el monorepo (no requiere build)
pnpm build                    # opcional en dev; obligatorio para Docker/producción
```
**En desarrollo no hace falta compilar**: todo se ejecuta con `tsx` sobre las fuentes
(`pnpm cortex`, `pnpm --filter @cortex/server dev`…). Lo hace posible una condición
`development` en los `exports` de cada paquete, que resuelve a `src/` cuando el proceso se
lanza con `--conditions=development` (lo hacen los scripts) y a `dist/` en cualquier otro
caso. Por eso `pnpm typecheck` y los tests funcionan sin haber compilado nunca.

**En producción sí se compila**: `pnpm build` ejecuta `tsc -b` sobre las *project
references* y deja `dist/` en cada paquete y app; el Dockerfile arranca `node dist/...`. Si
tocas la resolución de rutas a ficheros de datos (migraciones, estáticos de la web,
`install.sh`), compila y comprueba que siguen resolviendo: el CI tiene un smoke para eso,
porque es el fallo típico que ni el typecheck ni los tests detectan.

`apps/cli` queda fuera de `tsc -b` a propósito: se empaqueta con un bundler para poder
distribuirlo como CLI instalable.

## Mapa del repo (dónde vive cada cosa)

| Quieres… | Toca… |
| --- | --- |
| Operación de dominio (captura, búsqueda, pack, lint, proyectos, auth) | `packages/core/src/` (**determinista, sin LLM**) |
| Capa LLM (clasificar, grafo, rerank, síntesis, destilar, fusionar, reconciliar) | `packages/agents/src/` (Agents de **Mastra**) |
| Modelo de dominio (tipos, enums, schemas zod) | `packages/shared/src/domain.ts` |
| Esquema/SQL/cliente Postgres | `packages/database/` (migraciones en `migrations/`) |
| Proveedor de embeddings | `packages/embeddings/` |
| Servidor MCP (stdio) · UI web · API+auth · CLI | `apps/mcp-server` · `apps/web` · `apps/server` · `apps/cli` |
| Lado cliente (HTTP, credenciales, `.cortex.json`, transcripts) | `packages/client/` — **sin** Postgres ni LLM |
| Comando de developer (auth, link, hooks) | `apps/cli/src/commands/` — solo `client` + `shared` |
| Comando de operador (BD, modelo, servicios) | `apps/admin/src/commands/` |
| Lo que Cortex instala en Claude Code (hooks, MCP, skill, comando) | `plugin/claude-code/` (+ `.claude-plugin/marketplace.json` en la raíz) |
| Integración por agente (`cortex setup`) | `apps/cli/src/setup/` — un adaptador por agente, más `hooks-json.ts` y `legacy.ts` |
| Registry de terceros (`cortex toolbelt`) | `config/toolbelt.json` (esquema) + `apps/cli/src/toolbelt/` |
| Diagnóstico (`cortex doctor`) | `apps/cli/src/commands/doctor.ts` |
| Empaquetado del CLI para npm | `apps/cli/tsup.config.ts` (bundle; los `@cortex/*` van dentro) |

**Regla de oro de dependencias:** `core` NO importa `agents` (evita ciclo). La inteligencia
se **inyecta**: cada entrypoint llama a `wireLlm()` (de `@cortex/agents`) tras `loadEnv()`,
que cablea `setClassifier`/`setReranker`/`setReconciler` y el sink de uso de embeddings.
Si una operación de core necesita LLM, define el hook en core y cabléalo en `wire.ts`.
La tabla completa de reglas (qué paquete puede importar qué, dónde van los side effects)
está en [`CLAUDE.md`](./CLAUDE.md#reglas-de-dependencia-qué-puede-importar-qué).

> **Refactor en curso (julio 2026):** hay un plan por fases en
> las decisiones en [`docs/decisions.md`](./docs/decisions.md). Antes de tocar un área, mira si
> el plan la cubre; algunas rutas de esta guía (p.ej. dónde viven los conectores o los
> subcomandos del CLI) cambiarán al ejecutarlo — cada PR del refactor actualiza esta guía.

## Recetas frecuentes

- **Añadir un MCP / skill / comando al toolbelt** → si es **del producto** (lo usa
  cualquiera que despliegue Cortex), va en `config/toolbelt.json`. Si es una herramienta
  **de tu organización**, va en su registry externo, no aquí (ADR-0026); el esquema está en
  `docs/toolbelt-registry.md`. **Nunca** metas credenciales: declara el `env` que requiere y
  se omite si falta (`--doctor` lo lista).
- **Añadir un conector de fuente** → `apps/cli/src/commands/connect-<x>.ts` (exporta
  `run(args)`). Reutiliza la capa `extract` de core (multimodal) y escribe por la API
  autenticada (`apiPost` de shared, `/capture/batch`). Incremental por
  `sourceReference`. Añade su entrada en `COMMANDS` (`apps/cli/src/index.ts`).
- **Soportar un formato de fichero nuevo** → `packages/core/src/extract.ts`
  (`SUPPORTED_EXTS` + un branch en `extractFileText`). Todos los conectores lo heredan.
- **Cambiar el esquema** → nueva migración `packages/database/migrations/NNNN_desc.sql`
  (idempotente, `IF NOT EXISTS`). El runner aplica en orden las no registradas.
- **Nuevo rol de agente LLM** → añádelo a `AgentRole` + `INSTRUCTIONS` + el registro en
  `packages/agents/src/mastra.ts` (JSON_ROLES si devuelve JSON).
- **Nuevo subcomando `cortex`** → crea `apps/cli/src/commands/<cmd>.ts` exportando
  `run(args: string[])` (sin `process.exit` ni side effects de import: el ciclo de vida
  lo gestiona el dispatcher) y añade su entrada en `COMMANDS` de `apps/cli/src/index.ts`.

## Convenciones

- **Idioma:** código y nombres en **inglés**; comentarios y docs de producto en **español**.
- **Sin secretos en el repo.** `.env` está ignorado; usa `.env.example`. Scrub de secretos
  antes de mandar contenido a un LLM o guardarlo (sesiones/ficheros).
- **Trazabilidad (§5.5):** cada unidad de conocimiento conserva fuente, fecha, autor,
  confianza, estado y vigencia. No conviertas inferencias en hechos (confianza baja para lo auto).
- **zod aislado:** `agents` usa **zod v4** (lo exige Mastra); el resto **zod v3**. No cruces schemas.
- **Calidad:** `pnpm typecheck` y `pnpm test` (Vitest) deben pasar. Tests en `tests/`:
  - **Unit** (`pnpm test`): lógica pura/determinista (auth/permisos, vínculo/slug,
    parsers de sesiones, schemas). Sin BD ni red.
  - **Integración** (`pnpm test:integration`, en `tests/integration/`): contra Postgres
    real (BD `cortex_test`, embeddings `local`, LLM `none`). Requiere `pnpm db:up`; el
    globalSetup crea+migra la BD de test. Cubre persistencia/búsqueda, jerarquía/herencia,
    permisos/cascada, captura por lotes y auth (OTP/token/ticket).

  Añade tests con tu PR cuando toques lógica testeable.

## Flujo de PR

1. Rama desde `main`; cambios enfocados.
2. `pnpm typecheck` en verde.
3. **Actualiza la documentación afectada** (ver abajo) — un PR que cambia comportamiento
   sin tocar docs está incompleto.
4. PR con: qué cambia, por qué, y cómo lo verificaste.

## Documentación (mantenerla viva)

Mantener los docs al día es parte del trabajo, no un extra:
- **`README.md`** — capacidades, arquitectura, comandos, estructura.
- **`docs/decisions.md`** — ADR ligero: cada decisión es una **hipótesis a revisar**
  (decisión, por qué, y "revisar cuando…"). Añade una entrada al tomar una decisión de calado.
- **`docs/roadmap.md`** — lo que queda / lo recién hecho.
- **`docs/research/`** — investigación que respalda decisiones (memoria, hooks, multimodal…).
- **`CLAUDE.md`** — guía para agentes de IA que trabajen el repo; mantenerla actualizada y
  podarla periódicamente para que no acumule ruido ni quede obsoleta.

## Publicar una versión

La versión es **única para todo el monorepo**. Con un solo artefacto publicable —el CLI— y
una imagen que lleva todo lo demás dentro, versionar cada paquete por su cuenta sería
ceremonia sin beneficio, y nadie sabría qué versión tiene desplegada.

```bash
pnpm version:set 0.2.0                       # raíz, paquetes, apps, plugin y CHANGELOG
git commit -am "chore(release): v0.2.0"
git tag v0.2.0 && git push origin main v0.2.0
```

El tag dispara el workflow, que verifica que el tag coincide con lo que dicen los
`package.json` y que el CHANGELOG tiene esa sección, corre todo (typecheck, tests, build),
publica la imagen en GHCR, publica `@dinacodelabs/cortex` en npm y crea la Release con las notas
del CHANGELOG.

**Cada PR añade su línea a `[Unreleased]`.** Escribe qué cambia para quien lo usa, no qué
hiciste: las notas de la versión salen de ahí, no de los commits.

Mientras estemos en `0.x`, una versión **menor** puede traer cambios incompatibles. Ya hay
dos cosas apuntadas para retirarse en la `0.2.0`: el alias `LLM_PROVIDER=nan` y la variable
`BREVO_SENDER`.

## Abrir el código

Cuando llegue el momento, el repositorio **no se abre publicando este historial**. Se abre
desde una **instantánea limpia**: un repositorio nuevo con un commit inicial del árbol actual
(ADR-0026). Reescribir la historia con `git filter-repo` rompe clones y referencias a PRs, y
no aporta nada mientras el repositorio sea privado.

Lo que hay que tener hecho antes: el README y la UI web en inglés, y una revisión de que no
queda nada corporativo (el ADR-0031 dice qué se publica y qué no).
