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

## ADR-0006 · Mastra como runtime de agentes y workflows

- **Estado:** aceptada como hipótesis de partida (§9.1); pendiente de validar en código.
- **Contexto:** decisión inicial del plan. A validar: soporte MCP, workflows largos,
  testing, observabilidad, versionado de agents/tools.
- **Decisión:** usar Mastra para ingestion/classification/retrieval/context-pack.
- **Alternativas:** LangGraph, LlamaIndex Workflows, CrewAI, o orquestación ad hoc.
- **Revisar cuando:** tengamos 2-3 workflows reales y podamos medir el encaje.

## ADR-0007 · MCP como interfaz estándar hacia las herramientas de IA

- **Estado:** aceptada (demo).
- **Contexto:** §8. Claude Code primero, Codex/ChatGPT después, sin acoplar.
- **Decisión:** servidor MCP (TypeScript SDK oficial) que expone tools neutras:
  `save_project_context`, `search_project_context`, `get_project_context_pack`,
  `list_project_decisions`, `validate_context_entry`.
- **Revisar cuando:** definamos auth/permisos por developer y proyecto.
