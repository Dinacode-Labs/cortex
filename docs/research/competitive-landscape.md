# Panorama competitivo y análisis de huecos — Dinacode Cortex

> Investigación realizada con 4 agentes en paralelo (junio 2026) sobre proyectos
> de memoria/contexto para agentes de IA, comparados con Cortex. Cada afirmación
> se apoya en fuentes citadas al final; las incertidumbres se marcan como *(?)*.
>
> **Objetivo:** ver qué hacen otros que nosotros no, y proponer cómo hacerlo bien
> para nuestro nicho: **memoria de contexto para una consultora de software,
> por cliente/proyecto, con sus propias vías de comunicación, consumida por
> agentes de desarrollo (Claude Code/Codex) vía MCP.**

---

## 0. TL;DR

- **Tenemos un gemelo arquitectónico: `gbrain` (Garry Tan).** Postgres+pgvector +
  BM25 + grafo de entidades/relaciones + MCP + síntesis con citas. Es la
  referencia #1 a estudiar — valida nuestras decisiones y nos adelanta features.
- **Nuestra tesis ya tiene nombre: el "LLM Wiki" de Karpathy** (ingest → query →
  **lint**). El paso **lint** (detectar contradicciones, info obsoleta, entidades
  huérfanas, huecos) es justo el "curado" que tenemos verde y que **casi nadie
  implementa**: es un diferenciador de calidad.
- **El grafo entities/relations es ya _commodity_** (MCP oficial, basic-memory,
  Cognee, Graphiti…). Nuestro foso NO es el grafo, sino: **scoping multi-cliente +
  ingesta de calidad de Plane/Chat/repos + lint/curado + síntesis con citas**.
- **No existe un producto vertical** de "memoria para consultora de software
  multi-cliente con canales propios" → hueco de mercado real.
- **Huecos técnicos más claros frente al mercado:** (1) **híbrido + rerank** (hoy
  solo vector denso), (2) **grafo bi-temporal con invalidación** de hechos,
  (3) **resolución de entidades** robusta (tenemos un primer pase), (4) **indexar
  el código** de cada cliente (no solo el proyecto), (5) **permisos por
  cliente/usuario** (ACLs), (6) **eval de fundamentación** (anti-alucinación).

---

## 1. El mapa del panorama

Cuatro familias, con los proyectos más relevantes:

| Familia | Proyectos clave | Qué aportan |
|---|---|---|
| **Memoria de agente / KG** | **gbrain**, Zep+**Graphiti**, **Cognee**, Mem0, Letta, Memary, Memobase, txtai, MemOS | Modelo de memoria (vector/grafo/temporal), extracción de entidades/relaciones, curado, olvido |
| **Contexto de código para IDEs/agentes** | Cursor, Augment, Continue, Aider, **Serena**, Cody, Tabnine, Qodo, Greptile, Sourcebot | Indexar y razonar sobre **código** (chunking, símbolos, code-graph) |
| **Conocimiento corporativo / RAG** | **Glean**, **Onyx** (ex-Danswer), Dust, RAGFlow, Morphik, Khoj, Quivr, Verba, Elastic, Vectara, MS 365 Copilot | Conectores SaaS, **permisos/ACL**, **híbrido + rerank**, eval de calidad |
| **Docs/MCP & patrones** | **Context7**, GitMCP, DeepWiki, Memory MCP oficial, basic-memory, **LLM Wiki (Karpathy)** | Patrones de consumo (MCP), auto-wiki, conocimiento pre-compilado |

### Identificación de los que nombró el usuario
- **Context7** (Upstash, MIT): MCP que inyecta **docs de librerías** versionadas. No
  es memoria de proyecto — es contexto público efímero. Útil como **complemento**
  (Cortex = contexto privado del cliente; Context7 = docs del stack) y como patrón
  de UX (`use context7`). https://github.com/upstash/context7
- **gbrain** (Garry Tan, MIT): **el más parecido a Cortex.** pgvector + BM25 +
  grafo (edges tipados extraídos **sin LLM**) + 30+ tools MCP + `gbrain think`
  (respuesta con **citas y análisis de huecos**) + "schema packs". Doble storage
  PGLite/Postgres. https://github.com/garrytan/gbrain
- **Hermes** (Nous Research, MIT): agente autónomo multi-canal con memoria
  **auto-curada en markdown** (`user.md` + `MEMORY.md`, el agente decide qué
  guardar). *(detalles de 3 capas no 100% verificados)*
- **OpenClaw** (OSS): asistente personal multi-canal con memoria persistente
  (vía **Hindsight** de Vectorize: extracción de hechos estructurados + retrieval
  semántico, y el plugin **Claude-Mem**). Ojo: "OpenClaude" ≠ "OpenClaw" (el
  primero es un tutorial de memoria para Claude Code, no el agente).

---

## 2. Las dos referencias que más nos importan

### 2.1. `gbrain` — el gemelo arquitectónico (estudiar a fondo)
Confirma casi todas nuestras decisiones y nos marca el siguiente nivel:
- **Grafo auto-cableado en ingesta sin llamadas a LLM** (extrae edges tipados del
  contenido) → barato y rápido; combinado con pgvector. *Nosotros usamos LLM para
  el grafo: más rico pero más caro/frágil (lo hemos sufrido con los 429/cortes).*
- **Retrieval híbrido vector + BM25 + traversal de grafo** (nosotros: solo vector).
- **`think`: síntesis con citas + "lo que NO sé aún"** (gap analysis). Para una
  consultora, respuestas auditables (ticket Plane X, mensaje Chat Y) son oro.
- **"Schema packs"** = ontologías por dominio (en Cortex: por tipo de cliente).

### 2.2. El "LLM Wiki" de Karpathy — nuestra tesis, nombrada
Patrón en 3 capas + 3 operaciones (gist real, abr 2026):
- Capas: **Raw sources** (inmutable) → **Wiki** (markdown generado por el LLM:
  páginas de entidad, resúmenes, cross-refs) → **Schema** (un `CLAUDE.md` que
  explica al LLM cómo está organizada).
- Operaciones: **Ingest** (fuente → toca 10-15 páginas), **Query** (responde
  leyendo la wiki, no los raw), **Lint** (health-check: contradicciones, stale,
  huérfanas, cross-refs faltantes, huecos).
- **Cortex ≈ "LLM Wiki + Postgres/pgvector + grafo + multi-cliente + ingesta
  automática (Plane/Chat)".** El **Lint** es la pieza diferencial que debemos
  formalizar (es nuestro "curado" del §12).

---

## 3. Qué hacen que Cortex NO hace (análisis de huecos)

Cortex ya acierta en: **organización por proyecto/cliente, capa
documental+vectorial+relacional en Postgres, MCP propio (save/search/context-pack/
ask), agentes de clasificación/síntesis/grafo, ingesta de Plane y Google Chat, y
primeros loops (dedup, contradicciones, resolución de entidades)**. Eso último es
genuinamente más avanzado que la mayoría de RAG del mercado. Huecos:

### A. Retrieval: híbrido + rerank (alto impacto, bajo coste)
- **Búsqueda híbrida (BM25 + vector con RRF).** Glean, Onyx (Vespa), RAGFlow,
  Elastic (BM25+ELSER+RRF), gbrain. El léxico gana con **nombres propios, IDs,
  códigos de ticket, jerga** — frecuentísimos en consultoría. Hoy usamos solo
  pgvector denso.
- **Reranking de 2ª etapa** (cross-encoder / Cohere Rerank / Vectara Slingshot):
  casi todos lo añaden tras el retrieval. Nosotros no.
- **Query understanding / expansion** (Glean, Onyx).

### B. Grafo de conocimiento bi-temporal (Zep/Graphiti, Cognee)
- **4 timestamps por hecho/edge**: `valid_from`, `valid_to`, `observed_at`,
  `recorded_at`. Consultas point-in-time ("¿qué sabíamos del cliente X en marzo?").
- **Invalidar, no borrar**: al detectar contradicción, cerrar la ventana de
  validez del hecho viejo. Crítico en consultoría (decisiones que se revierten).
- **Provenance por episodio**: cada hecho ligado a su fuente (ticket/mensaje).

### C. Resolución de entidades robusta (Cognee) — lo tenemos a medias
- **Fast path determinista MinHash+LSH** antes del LLM (barato/escalable) con
  **fallback LLM** solo en ambigüedad. Nuestro pase actual es normalización +
  LLM en ingesta.
- **Dedup de _edges_ + resolución de contradicciones como paso explícito**.
- **Ontología/tipos prescritos** del dominio (Cliente, Proyecto, Decisión,
  Requisito, Riesgo, Incidencia, Tecnología…) → mejora precisión de extracción.

### D. Curado / olvido / "lint" (Karpathy + Cognee `memify()`)
- **Operación de Lint periódica** per-cliente: contradicciones, info obsoleta,
  entidades huérfanas, cross-refs/huecos. Formaliza nuestros "loops de mejora".
- **Ranking de entidades por frecuencia+recencia** (Memary): señal barata de
  relevancia para el context-pack.
- **Decay adaptativo** (por *velocity*/*volatility*): un riesgo caduca antes que
  el nombre de un cliente.

### E. Indexación del CÓDIGO de cada cliente (el mayor hueco vertical)
Todos los líderes de código (Cursor, Augment, Continue, Cody, Tabnine, Qodo)
**indexan el repo**; Aider/Serena/Greptile añaden estructura simbólica.
- **`search_project_code`** sobre los repos del cliente: chunking sintáctico
  (Tree-sitter) + embeddings en pgvector.
- **Code-graph / LSP** (Serena, Aider PageRank): "¿qué rompe este cambio?", no solo
  "¿qué se decidió?".
- **Sync incremental** estilo Merkle (Cursor) y **branch-aware** (Augment).
> Para una consultora de software, el contexto de código por cliente debería vivir
> junto al de proyecto. Es el complemento natural a lo que ya tenemos.

### F. Conectores de fuentes (Glean 100+, Onyx ~31, MS Copilot 100+)
Hoy: Plane + Google Chat. Prioridad para el nicho:
- **GitHub/GitLab/Bitbucket** (repos, PRs, issues, commits) — clave en software.
- **Confluence/Notion/Drive** (docs de cliente), **Jira** (clientes sin Plane),
  **Slack/Teams**, **Gmail**.
- **Parsing profundo de documentos** (RAGFlow DeepDoc, Morphik ColPali): PDFs,
  tablas, diagramas, specs/diseños — vía Unstructured.io o similar.
- **Sync incremental** con detección de borrados/cambios.

### G. Permisos / multi-tenant fuerte (Onyx, Glean, Elastic DLS, MS Copilot)
Aislamos por proyecto/cliente, pero **dentro de un cliente no hay ACL por
documento/usuario**. Para una consultora donde no todos ven todo de cada cliente:
- **Permission-aware sync**: capturar ACLs de la fuente (GitHub/Confluence/Drive)
  y filtrar en `search`/`ask` por identidad del usuario MCP.
- **RLS en Postgres por `client_id`** + scoping de tools MCP por cliente +
  verificación de pertenencia antes de servir contexto (que un agente nunca filtre
  contexto de otro cliente).
- **RBAC / SSO / audit log** para clientes empresariales.
- Patrón **Collaborative Memory** (arXiv): memoria *private* por cliente + *shared*
  (conocimiento reutilizable de la consultora) con control de acceso explícito.

### H. Evaluación de calidad (Vectara HHEM, Glean AI Evaluator)
- **Grounding/faithfulness check**: ¿la respuesta está fundamentada en el contexto
  recuperado? (HHEM de Vectara es open-source) + **citas obligatorias verificables**.
- **Feedback loop (👍/👎)** desde Claude Code que mejore ranking/curación.
- **"Verified Answers" / document boosting** (Glean, Onyx): marcar contenido
  autoritativo por proyecto — encaja con memoria curada.

### I. Producto / UX
- **Trigger natural** tipo `use context7` → `use cortex` o auto-inyección del
  contexto del cliente activo (sin fricción desde Claude Code).
- **Memoria auto-curada por el agente** (Hermes/Claude-Mem): que decida qué
  persistir según patrones, no solo por comando. Separar "ficha del cliente"
  (preferencias/restricciones) de "notas de trabajo".
- **Doble capa markdown + Postgres** (gbrain): markdown legible/auditable por la
  consultora (transparencia con el cliente) + pgvector para retrieval.
- **Cortex también como _cliente_ MCP** (no solo servidor): consumir MCPs de Plane,
  GitHub, Confluence… para ingerir sin integraciones a medida una a una.

---

## 4. Propuestas priorizadas (qué haría yo, y en qué orden)

Ordenado por **impacto/esfuerzo** para la demo y el producto:

### Ahora (alto impacto, bajo coste — encajan en lo que ya hay)
1. **Híbrido BM25 + vector con RRF** usando el FTS de Postgres (`tsvector`/`ts_rank`
   o ParadeDB `pg_search`) fusionado con pgvector. Gran salto de precisión en
   IDs/nombres/jerga.
2. **Rerank de 2ª etapa** (cross-encoder local o Cohere Rerank) + recorte por
   presupuesto de tokens en `search`/`ask` → context-packs pequeños y de alta señal
   (patrón Context7: ~9.7k→3.3k tokens).
3. **Síntesis con citas verificables + "lo que no sabemos"** (patrón gbrain `think`):
   ya casi lo tenemos en `ask`; añadir citas a fuente (PUBLI-x / hilo de chat) y un
   apartado de huecos.
4. **Operación de Lint** (Karpathy) como job/loop: contradicciones, obsoletos,
   entidades huérfanas, huecos — per-cliente. Formaliza el §12.

### Siguiente (diferenciadores del nicho)
5. **Grafo bi-temporal**: añadir `valid_from/valid_to/observed_at/recorded_at` a
   hechos/relaciones e **invalidar en vez de borrar**; consultas point-in-time.
6. **Resolución de entidades 2 fases** (MinHash+LSH determinista → LLM solo en
   ambigüedad) + **ontología prescrita** del dominio consultoría.
7. **Indexación de código por cliente** (`search_project_code` con Tree-sitter +
   pgvector; opcional code-graph/LSP estilo Serena) — el complemento vertical clave.
8. **Permisos multi-tenant**: RLS por `client_id`, scoping de tools MCP por
   cliente, y (fase 2) ACLs por documento heredadas de la fuente.

### Más adelante (cobertura y robustez)
9. **Más conectores** (GitHub/PRs primero; luego Confluence/Notion/Jira/Drive) y
   **parsing profundo** de documentos (Unstructured/DeepDoc).
10. **Eval de fundamentación** (HHEM) + **feedback 👍/👎** desde Claude Code.
11. **Memoria private/shared** (consultora) + **versionado tipo Git** para auditoría.
12. **Cortex como cliente MCP** para ingesta federada.

> **Lo que NO deberíamos hacer:** reinventar el motor de grafo genérico (commodity).
> El esfuerzo diferencial va en ingesta de calidad multi-fuente, scoping
> multi-cliente, lint/curado y síntesis con citas.

---

## 5. Tabla rápida memoria/grafo (foco temporal/entidades)

| Framework | Grafo | Bi-temporal/invalidación | Resolución entidades | Curado/olvido | Licencia |
|---|---|---|---|---|---|
| **gbrain** | Sí (sin LLM) | No | Sí (schema packs) | — | MIT |
| **Zep+Graphiti** | Sí | **Sí (4 ts, invalida edge)** | Sí *(detalle ?)* | Vía invalidación | Apache-2.0 |
| **Cognee** | Sí | Sí (Temporal Cognify) | **Sí (MinHash+LSH+LLM)** | **`memify()`** | Apache-2.0 |
| **Mem0** | Opcional | Razonamiento temporal; sin invalidación (ADD-only) | Merge coseno | No | Apache-2.0 |
| **Letta** | No | No | No | Reescritura bloques | Apache-2.0 |
| **Memary** | Sí | No (recencia+freq) | Débil | Ranking recencia | MIT |
| **Cortex (hoy)** | Sí (LLM) | No | Parcial (norm+LLM) | Loops dedup/contra | — |

---

## 6. Fuentes (selección)
- gbrain: https://github.com/garrytan/gbrain
- LLM Wiki (Karpathy): https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- Context7: https://github.com/upstash/context7 · GitMCP: https://github.com/idosal/git-mcp
- Zep/Graphiti: https://github.com/getzep/graphiti · paper https://arxiv.org/abs/2501.13956
- Cognee: https://github.com/topoteretes/cognee · Mem0: https://github.com/mem0ai/mem0 · Letta: https://github.com/letta-ai/letta
- Onyx: https://docs.onyx.app/admins/connectors/overview · Glean: https://docs.glean.com/connectors/
- RAGFlow: https://ragflow.io · Morphik: https://github.com/morphik-org/morphik-core · Elastic DLS: https://www.elastic.co/docs/reference/search-connectors/es-dls-e2e-guide
- Cursor indexing, Augment Context Engine, Continue, Aider, Serena (LSP/MCP): https://github.com/oraios/serena
- MCP memory oficial: https://github.com/modelcontextprotocol/servers/tree/main/src/memory · basic-memory: https://github.com/basicmachines-co/basic-memory
- Collaborative Memory: https://arxiv.org/abs/2505.18279

> Incertidumbres marcadas en el texto. Algunos detalles internos (Cursor/Turbopuffer,
> resolución de entidades de Graphiti, 3 capas de Hermes) provienen de fuentes
> secundarias. Varios repos quedaron archivados en 2026 (OpenCtx, Verba, Roo Code).
