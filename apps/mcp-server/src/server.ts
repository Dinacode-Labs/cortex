import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { saveContextInput, searchContextInput } from "@cortex/shared";
import {
  checkEntryAccess,
  checkProjectAccess,
  getContextPack,
  lintProject,
  listDecisions,
  renderCodeHits,
  renderContextPack,
  renderDecisions,
  renderLintReport,
  searchProjectCode,
  renderSaveResult,
  renderSearchHits,
  saveContext,
  searchContext,
  validateEntry,
  type AuthUser,
} from "@cortex/core";
import { synthesizeContextAnswer } from "@cortex/agents";
import { z } from "zod";

/**
 * Construcción del MCP de Cortex (las 8 tools), reutilizable por cualquier transporte
 * (stdio en `index.ts`, HTTP en `http.ts`). Si se pasa `user` (transporte HTTP
 * autenticado), las tools **atribuyen** las escrituras (`created_by`=email) y **aplican
 * permisos** (acceso al proyecto); sin `user` (stdio local) se comportan como antes.
 */
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const errorText = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

export function buildMcpServer(user?: AuthUser): McpServer {
  const server = new McpServer({ name: "cortex", version: "0.0.0" });

  // Permiso de acceso al proyecto (solo si hay usuario autenticado; sin `user` — stdio
  // local — no se aplican guards). Devuelve el mensaje de denegación, o null si puede
  // continuar. En LECTURAS un proyecto inexistente se rechaza (`not_found`); las
  // ESCRITURAS por nombre pasan `allowMissing` porque el save auto-crea el proyecto (ADR).
  const guard = async (project?: string, opts?: { allowMissing?: boolean }): Promise<string | null> => {
    if (!user || !project) return null;
    const access = await checkProjectAccess(user.email, { name: project });
    if (access.status === "forbidden") return `Sin acceso al proyecto "${project}".`;
    if (access.status === "not_found" && !opts?.allowMissing) return `Proyecto no encontrado: "${project}".`;
    return null;
  };

  server.registerTool(
    "save_project_context",
    {
      title: "Guardar contexto de proyecto",
      description:
        "Guarda una pieza de conocimiento de un proyecto (decisión, restricción, " +
        "incidencia, convención, etc.) con baja fricción. Cortex la clasifica, " +
        "resume, extrae entidades, genera embedding y detecta posibles duplicados " +
        "o contradicciones. Solo 'content' es obligatorio.",
      inputSchema: saveContextInput.shape,
    },
    async (args) => {
      try {
        const denied = await guard(args.project, { allowMissing: true });
        if (denied) return errorText(denied);
        const result = await saveContext(user ? { ...args, createdBy: user.email } : args);
        return text(renderSaveResult(result));
      } catch (e) {
        return errorText(`Error al guardar contexto: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "search_project_context",
    {
      title: "Buscar contexto de proyecto",
      description:
        "Búsqueda semántica de conocimiento relevante. Devuelve las entradas más " +
        "parecidas con su puntuación, resumen y fuente. Filtrable por proyecto y tipo.",
      inputSchema: searchContextInput.shape,
    },
    async (args) => {
      try {
        const denied = await guard(args.project);
        if (denied) return errorText(denied);
        return text(renderSearchHits(await searchContext(args)));
      } catch (e) {
        return errorText(`Error en la búsqueda: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "get_project_context_pack",
    {
      title: "Obtener context pack de proyecto",
      description:
        "Genera un paquete de contexto para trabajar sobre un proyecto: decisiones " +
        "vigentes, restricciones, riesgos, deuda técnica, convenciones, módulos " +
        "sensibles y, si se indica un área, lo más relevante para ella. Úsalo antes " +
        "de tocar un módulo.",
      inputSchema: {
        project: z.string().describe("Nombre del proyecto, p.ej. 'LevelUp Pasión'"),
        area: z.string().optional().describe("Área/módulo opcional, p.ej. 'facturación'"),
        asOf: z.string().optional().describe("Fecha ISO (YYYY-MM-DD) para contexto point-in-time; por defecto, estado actual"),
      },
    },
    async ({ project, area, asOf }) => {
      try {
        const denied = await guard(project);
        if (denied) return errorText(denied);
        return text(renderContextPack(await getContextPack(project, area, asOf ? new Date(asOf) : undefined)));
      } catch (e) {
        return errorText(`Error al generar el context pack: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "list_project_decisions",
    {
      title: "Listar decisiones del proyecto",
      description: "Lista las decisiones técnicas registradas de un proyecto.",
      inputSchema: {
        project: z.string().describe("Nombre del proyecto"),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ project, limit }) => {
      try {
        const denied = await guard(project);
        if (denied) return errorText(denied);
        return text(renderDecisions(await listDecisions(project, limit ?? 20)));
      } catch (e) {
        return errorText(`Error al listar decisiones: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "validate_context_entry",
    {
      title: "Validar entrada de contexto",
      description: "Cambia el estado de validación de una entrada: validated, rejected u obsolete.",
      inputSchema: {
        id: z.string().uuid().describe("ID de la entrada de contexto"),
        status: z.enum(["validated", "rejected", "obsolete"]),
      },
    },
    async ({ id, status }) => {
      try {
        // Esta tool opera por ID de entrada, no por nombre de proyecto → el `guard` por
        // proyecto no la cubre: el acceso se comprueba vía la entrada (checkEntryAccess).
        if (user) {
          const access = await checkEntryAccess(user.email, id);
          if (access.status === "not_found") return errorText(`No existe ninguna entrada con id ${id}.`);
          if (access.status === "forbidden") return errorText(`Sin acceso a la entrada ${id}.`);
        }
        const entry = await validateEntry(id, status);
        if (!entry) return errorText(`No existe ninguna entrada con id ${id}.`);
        return text(`Entrada ${entry.id} actualizada a estado "${entry.status}".`);
      } catch (e) {
        return errorText(`Error al validar la entrada: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "ask_project_context",
    {
      title: "Preguntar al contexto del proyecto",
      description:
        "Hace una pregunta en lenguaje natural sobre un proyecto. Recupera el " +
        "contexto relevante y sintetiza una respuesta fundamentada (agente de " +
        "recuperación Mastra). Requiere LLM configurado; si no, usa la búsqueda.",
      inputSchema: {
        question: z.string().describe("Pregunta en lenguaje natural"),
        project: z.string().optional().describe("Nombre del proyecto"),
      },
    },
    async ({ question, project }) => {
      try {
        const denied = await guard(project);
        if (denied) return errorText(denied);
        const hits = await searchContext({ query: question, project, limit: 6 });
        const answer = await synthesizeContextAnswer(
          question,
          hits.map((h) => ({ title: h.entry.title, summary: h.entry.summary ?? h.entry.content, type: h.entry.type })),
        );
        return text(answer ? `${answer}\n\n---\nFuentes consultadas:\n${renderSearchHits(hits)}` : renderSearchHits(hits));
      } catch (e) {
        return errorText(`Error al responder: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "search_project_code",
    {
      title: "Buscar en el código del proyecto",
      description:
        "Búsqueda semántica + léxica (híbrida) sobre el código indexado de un " +
        "proyecto/cliente. Devuelve fragmentos con ruta y rango de líneas. Útil para " +
        "localizar dónde se implementa algo antes de tocarlo.",
      inputSchema: {
        query: z.string().describe("Qué buscar (lenguaje natural o identificador)"),
        project: z.string().describe("Nombre del proyecto"),
        limit: z.number().int().positive().max(20).optional(),
      },
    },
    async ({ query, project, limit }) => {
      try {
        const denied = await guard(project);
        if (denied) return errorText(denied);
        return text(renderCodeHits(await searchProjectCode(query, project, limit ?? 8)));
      } catch (e) {
        return errorText(`Error al buscar código: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "lint_project_context",
    {
      title: "Lint del conocimiento del proyecto",
      description:
        "Analiza la salud de la memoria de un proyecto: contradicciones, posibles " +
        "duplicados, entidades huérfanas, baja confianza, histórico y huecos (áreas " +
        "con incidencias pero sin decisiones documentadas).",
      inputSchema: { project: z.string().describe("Nombre del proyecto") },
    },
    async ({ project }) => {
      try {
        const denied = await guard(project);
        if (denied) return errorText(denied);
        return text(renderLintReport(await lintProject(project)));
      } catch (e) {
        return errorText(`Error en lint: ${(e as Error).message}`);
      }
    },
  );

  return server;
}
