import { z } from "zod";

/**
 * Modelo de dominio de Cortex.
 *
 * Refleja el modelo de datos hipotético del §14 del documento de planteamiento.
 * Es una propuesta mínima para la demo y debe cuestionarse (ver docs/decisions.md).
 *
 * Definimos los enums como esquemas zod (fuente de verdad para validación en MCP y
 * Mastra) y derivamos los tipos TypeScript con z.infer.
 */

// --- Enums del dominio -------------------------------------------------------

/** Tipo de unidad de conocimiento. §14 context_entries.type */
export const contextEntryType = z.enum([
  "decision",
  "constraint",
  "incident",
  "architecture",
  "module_note",
  "technical_debt",
  "convention",
  "business_rule",
  "integration_note",
  "risk",
  "how_to",
  "meeting_summary",
  "pr_summary",
  "ticket_resolution",
]);
export type ContextEntryType = z.infer<typeof contextEntryType>;

/** Estado del ciclo de vida de una entrada. §14 context_entries.status */
export const contextEntryStatus = z.enum([
  "draft",
  "pending_validation",
  "validated",
  "rejected",
  "obsolete",
  "superseded",
]);
export type ContextEntryStatus = z.infer<typeof contextEntryStatus>;

/** Nivel de confianza en la información. §14 confidence */
export const confidenceLevel = z.enum(["low", "medium", "high", "verified"]);
export type ConfidenceLevel = z.infer<typeof confidenceLevel>;

/**
 * Vigencia del conocimiento. El §14 lista `validity` sin enumerar valores;
 * proponemos este conjunto mínimo, a revisar.
 */
export const validity = z.enum(["current", "historical", "unknown"]);
export type Validity = z.infer<typeof validity>;

/**
 * Tipo de entidad del grafo relacional. §14 entities.type
 *
 * Una entidad es una **cosa que se nombra** —un módulo, un servicio, una tecnología, un
 * cliente—, no una afirmación sobre el proyecto. Aquí hubo `decision` e `incident`, que son
 * tipos de ENTRADA, y el resultado fue un grafo en sombra: la misma decisión guardada dos
 * veces, una como entrada y otra como nodo cuyo nombre era la frase entera. En una instalación
 * real, 222 nodos así, con nombres como «Publicar Cortex en abierto y monetizar la
 * implementación». Ensuciaban las huérfanas, el mapa y —sobre todo— las contradicciones, que
 * salían entre nombres de nodo en vez de entre entradas. Ver ADR-0055.
 */
export const entityType = z.enum([
  "client",
  "project",
  "repository",
  "module",
  "service",
  "technology",
  "person",
  "integration",
  "vendor",
]);
export type EntityType = z.infer<typeof entityType>;

/**
 * Los tipos que se le OFRECEN al extractor (clasificador y grafo). `project` no está: el
 * proyecto es el contenedor de la memoria y nace por `createProject` —con slug y dueño—, no
 * de un nombre propio que el LLM haya interpretado como proyecto. Cuando se ofrecía, cada
 * ticket, rama o microservicio mencionado acababa en `entities` con `type='project'`: la
 * misma fila que un proyecto real, y salía en `cortex link` y en la UI como tal (#135).
 * Mismo patrón que ADR-0055 con `decision`/`incident`, pero aquí el tipo sí es legítimo, así
 * que se quita de lo que se extrae, no del enum.
 */
export const extractableEntityType = z.enum(
  entityType.options.filter((t) => t !== "project") as [Exclude<EntityType, "project">, ...Exclude<EntityType, "project">[]],
);
export type ExtractableEntityType = z.infer<typeof extractableEntityType>;

/**
 * Si un nombre sirve como entidad del grafo.
 *
 * Las entidades son nombres, no frases. El extractor devolvía cosas como «opción C», «No asumir
 * rutas del origen en el destino» o «package», que luego aparecían como huérfanas y se
 * emparejaban entre sí en el informe de contradicciones. Un informe con la mitad de ruido
 * enseña a no mirarlo, así que el listón se pone aquí: si no parece un nombre propio de algo
 * del dominio, no entra.
 */
export function isUsableEntityName(name: string): boolean {
  const n = name.trim();
  if (n.length < 3 || n.length > 60) return false;
  if (n.split(/\s+/).length > 6) return false; // una frase, no un nombre
  if (/[.;]$/.test(n) || n.includes(": ")) return false;
  // Deícticos: "opción C", "la opción a", "v3", "caso 2"… no nombran nada por sí solos.
  if (/^(la |el |una? )?(opci[oó]n|alternativa|caso|punto|paso|fase|v)\s*\d*[a-z]?$/i.test(n)) return false;
  return /[a-zA-Z]/.test(n);
}

/** Tipo de relación entre entidades o entradas. §14 relations.relation_type */
export const relationType = z.enum([
  "belongs_to",
  "affects",
  "depends_on",
  "contradicts",
  "supersedes",
  "related_to",
  "implemented_by",
  "discussed_in",
  "caused_by",
  "resolved_by",
]);
export type RelationType = z.infer<typeof relationType>;

/** Origen de una pieza de conocimiento. §14 sources.source_type */
export const sourceType = z.enum([
  "manual",
  "claude_code",
  "github_pr",
  "github_issue",
  "jira_ticket",
  "notion_doc",
  "email",
  "chat",
  "meeting_transcript",
  "codex",
  "agent_session",
  "document",
]);
export type SourceType = z.infer<typeof sourceType>;

// --- Entidades persistidas ---------------------------------------------------

/** Una unidad de conocimiento. §14 context_entries */
export const contextEntry = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  clientId: z.string().uuid().nullable(),
  title: z.string(),
  content: z.string(),
  summary: z.string().nullable(),
  type: contextEntryType,
  status: contextEntryStatus,
  confidence: confidenceLevel,
  validity: validity,
  sourceType: sourceType,
  sourceReference: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  supersededBy: z.string().uuid().nullable(),
  metadata: z.record(z.unknown()),
  // Bi-temporalidad: ventana de validez del hecho. validTo null = vigente.
  validFrom: z.date(),
  validTo: z.date().nullable(),
  observedAt: z.date(),
});
export type ContextEntry = z.infer<typeof contextEntry>;

/** Una entidad del grafo relacional. §14 entities */
export const entity = z.object({
  id: z.string().uuid(),
  name: z.string(),
  canonicalName: z.string(),
  type: entityType,
  metadata: z.record(z.unknown()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Entity = z.infer<typeof entity>;

/** Una relación entre entidades/entradas. §14 relations */
export const relation = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceType: z.string(),
  targetId: z.string().uuid(),
  targetType: z.string(),
  relationType: relationType,
  confidence: confidenceLevel,
  metadata: z.record(z.unknown()),
  createdAt: z.date(),
});
export type Relation = z.infer<typeof relation>;

/** La fuente original de una entrada. §14 sources */
export const source = z.object({
  id: z.string().uuid(),
  sourceType: sourceType,
  externalId: z.string().nullable(),
  url: z.string().nullable(),
  rawContent: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.date(),
});
export type Source = z.infer<typeof source>;

// --- DTOs de entrada (compartidos por ingesta y tools MCP) -------------------

/**
 * Entrada mínima para guardar contexto. La usan tanto la captura manual como
 * Claude Code (tool MCP save_project_context). Pensada para baja fricción: solo
 * `content` es obligatorio; Cortex completa/clasifica el resto (§5.2).
 */
export const saveContextInput = z.object({
  /** Texto libre del conocimiento a guardar. */
  content: z.string().min(1, "content no puede estar vacío"),
  /** Slug o nombre del proyecto. Se resuelve a entidad de tipo `project`; si no existe, se crea. */
  project: z.string().min(1).optional().describe("Project slug (what `cortex link` shows) or name; a new project is created if neither matches"),
  /** Título corto opcional; si falta, se deriva del contenido. */
  title: z.string().optional(),
  /** Tipo de conocimiento; si falta, lo propone el agente de clasificación. */
  type: contextEntryType.optional(),
  /** Resumen opcional precalculado (p.ej. por un workflow); si falta, se deriva. */
  summary: z.string().optional(),
  confidence: confidenceLevel.optional(),
  /** De dónde viene. Por defecto "manual". */
  sourceType: sourceType.optional(),
  sourceReference: z.string().optional(),
  createdBy: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type SaveContextInput = z.infer<typeof saveContextInput>;

/** Parámetros de búsqueda de contexto (tool MCP search_project_context). */
export const searchContextInput = z.object({
  query: z.string().min(1),
  project: z.string().optional().describe("Project slug (what `cortex link` shows) or name"),
  type: contextEntryType.optional(),
  limit: z.number().int().positive().max(50).default(10),
});
export type SearchContextInput = z.infer<typeof searchContextInput>;
