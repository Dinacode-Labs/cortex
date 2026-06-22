# Decisiones técnicas (ADR ligero)

> Cada decisión aquí es una **hipótesis de trabajo para la demo**, no una elección
> definitiva. El documento de planteamiento
> (`dinacode-cortex-contexto-y-plan-demo.md`) insiste en cuestionar y validar todo.
> Este fichero registra qué hemos elegido *de momento*, por qué, y qué alternativas
> quedan pendientes de evaluar.

Formato: estado · contexto · decisión · alternativas · cuándo revisar.

---

## ADR-0001 · Monorepo con pnpm workspaces

- **Estado:** aceptada (demo).
- **Contexto:** §17 del plan propone monorepo para la demo. Varias piezas (shared,
  database, embeddings, agents, mcp-server, web) comparten tipos del dominio.
- **Decisión:** monorepo pnpm. Estructura `packages/*` (librerías) + `apps/*`
  (procesos ejecutables: mcp-server, api, web).
- **Alternativas:** repos separados (`cortex-api`, `cortex-mcp`, ...). Más overhead
  de versionado para una demo.
- **Revisar cuando:** la demo se convierta en producto multi-equipo.

## ADR-0002 · TypeScript en todo el stack

- **Estado:** aceptada (demo).
- **Contexto:** Mastra es TS-first (§9.1) y el MCP SDK oficial tiene buen soporte TS.
- **Decisión:** TS + ESM (`NodeNext`), ejecución con `tsx`, Node ≥ 20.
- **Revisar cuando:** aparezca una pieza con mejor encaje en otro runtime.

## ADR-0003 · Postgres + pgvector como base única (documental + vectorial)

- **Estado:** aceptada (demo).
- **Contexto:** §9.2/§9.4 recomiendan Postgres como centro y pgvector para
  simplicidad en la demo. Riesgo 1: no sobrediseñar.
- **Decisión:** una sola instancia Postgres 16 (imagen `pgvector/pgvector:pg16`) que
  almacena metadatos, entidades, relaciones, fuentes **y** embeddings (columna
  `vector`). Búsqueda por similitud con SQL (`<=>`, distancia coseno).
- **Alternativas:** Qdrant / Weaviate / Pinecone (vector DB dedicada). Aportan
  filtrado/escala pero añaden una pieza más a operar.
- **Revisar cuando:** el volumen o el rendimiento de búsqueda lo justifiquen.

## ADR-0004 · Grafo de conocimiento como modelo relacional (de momento)

- **Estado:** aceptada (demo).
- **Contexto:** §6/§9.3. El plan sugiere que para la demo no hace falta Neo4j.
- **Decisión:** representar el "grafo" con tablas `entities` + `relations` en
  Postgres. Las consultas relacionales (expansión por entidades) se hacen con SQL.
- **Alternativas:** Neo4j / Memgraph / ArangoDB. Útiles para travesías profundas.
- **Revisar cuando:** necesitemos consultas de grafo multi-salto frecuentes.

## ADR-0005 · Embeddings y LLM enchufables, con fallback local sin claves

- **Estado:** aceptada (demo).
- **Contexto:** el entorno de desarrollo puede no tener API keys. Queremos que la
  demo arranque sin configurar nada y que conectar un proveedor real sea trivial.
- **Decisión:** interfaz de proveedor de embeddings con tres implementaciones:
  `local` (determinista, por defecto, NO semántica — solo para probar el cableado),
  `openai` y `voyage`. El LLM (agentes Mastra) será igualmente configurable; sin
  clave se usan heurísticas locales donde sea posible.
- **Riesgo conocido:** los embeddings `local` no dan relevancia semántica real; la
  calidad de búsqueda solo se ve con un proveedor real. Documentado para la demo.
- **Revisar cuando:** fijemos proveedor oficial (coste/calidad multilingüe ES/EN).

## ADR-0006 · Mastra como runtime de agentes — validación parcial

- **Estado:** parcialmente validada. En uso para generación de texto; para salida
  estructurada usamos un cliente directo (ver ADR-0008).
- **Contexto:** decisión inicial del plan (§9.1). A validar: estructurado, MCP,
  workflows, observabilidad.
- **Decisión:** `@cortex/agents` usa el `Agent` de Mastra (`@mastra/core`) para el
  agente de **recuperación** (síntesis de respuesta en prosa), que funciona bien
  con DeepSeek vía OpenRouter.
- **Hallazgo:** la **salida estructurada** de Mastra (`structuredOutput`) se
  **colgaba** con DeepSeek V4 Pro vía OpenRouter (probablemente intenta modo
  `json_schema`, no soportado por el modelo). La generación de texto plano sí va.
- **Workflows:** `captureContextWorkflow` (§20.4) implementado con
  `createWorkflow`/`createStep` (classify → persist) y verificado. Demuestra el
  motor de workflows de Mastra con pasos observables. Ejecutable:
  `pnpm workflow:capture "<texto>" "<proyecto>"`.
- **Alternativas:** LangGraph, LlamaIndex Workflows, CrewAI, orquestación ad hoc.
- **Revisar cuando:** probemos otro modelo/proveedor o nuevas versiones de Mastra;
  ampliar a los demás workflows del §20.4 (context pack, dedup/contradicción batch).

## ADR-0007 · MCP como interfaz estándar hacia las herramientas de IA

- **Estado:** aceptada (demo).
- **Contexto:** §8. Claude Code primero, Codex/ChatGPT después, sin acoplar.
- **Decisión:** servidor MCP (TypeScript SDK oficial) que expone tools neutras:
  `save_project_context`, `search_project_context`, `get_project_context_pack`,
  `list_project_decisions`, `validate_context_entry`, `ask_project_context`.
- **Revisar cuando:** definamos auth/permisos por developer y proyecto.

## ADR-0008 · LLM vía OpenRouter (DeepSeek V4 Pro); estructurado por cliente directo

- **Estado:** aceptada (demo, de prueba).
- **Contexto:** necesitábamos un LLM para enriquecer captura y sintetizar
  respuestas. Disponible una key de OpenRouter.
- **Decisión:** `LLM_PROVIDER=openrouter` con `OPENROUTER_MODEL=deepseek/deepseek-v4-pro`.
  - **Clasificación/extracción (estructurada):** llamada directa a
    `chat/completions` con `response_format: json_object` + validación zod + 1
    reintento (DeepSeek es modelo de razonamiento: `max_tokens` amplio para que
    quede espacio al JSON tras el razonamiento).
  - **Síntesis de retrieval (texto):** `Agent` de Mastra.
- **Acoplamiento:** `@cortex/core` no depende de `@cortex/agents`; los entrypoints
  registran el clasificador con `setClassifier(...)` cuando hay LLM. Sin LLM, todo
  cae a heurísticas. Precedencia: input explícito > LLM > heurística.
- **Nota de versiones:** `@cortex/agents` usa zod v4 / AI SDK v6 (los exige Mastra),
  aislado del resto del repo que usa zod v3 (MCP SDK). No se cruzan schemas.
- **Revisar cuando:** fijemos proveedor/modelo definitivo (coste/calidad/latencia;
  DeepSeek razona y añade latencia).
