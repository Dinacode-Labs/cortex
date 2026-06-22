#!/usr/bin/env -S npx tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeSql } from "@cortex/database";
import { loadEnv, saveContextInput, searchContextInput } from "@cortex/shared";
import {
  getContextPack,
  listDecisions,
  renderContextPack,
  renderDecisions,
  renderSaveResult,
  renderSearchHits,
  saveContext,
  searchContext,
  setClassifier,
  validateEntry,
} from "@cortex/core";
import { classifyEntry, isLlmEnabled, synthesizeContextAnswer } from "@cortex/agents";
import { z } from "zod";

/**
 * Cortex Knowledge MCP — interfaz estándar y neutral hacia herramientas de IA
 * (Claude Code, y en el futuro Codex/ChatGPT). §8 y §16 del plan.
 *
 * Transporte stdio: stdout es el canal del protocolo, así que todo log va a
 * stderr. Las tools delegan en @cortex/core (operaciones deterministas); Mastra
 * se superpondrá como capa de inteligencia en una fase posterior.
 */

loadEnv();

// Capa de inteligencia (Mastra/LLM) opcional: si hay LLM, enriquece la captura.
if (isLlmEnabled()) setClassifier(classifyEntry);

const server = new McpServer({ name: "cortex", version: "0.0.0" });

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const errorText = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

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
      const result = await saveContext(args);
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
      const hits = await searchContext(args);
      return text(renderSearchHits(hits));
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
      project: z.string().describe("Nombre del proyecto, p.ej. 'Acme Portal'"),
      area: z.string().optional().describe("Área/módulo opcional, p.ej. 'facturación'"),
    },
  },
  async ({ project, area }) => {
    try {
      const pack = await getContextPack(project, area);
      return text(renderContextPack(pack));
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
      const decisions = await listDecisions(project, limit ?? 20);
      return text(renderDecisions(decisions));
    } catch (e) {
      return errorText(`Error al listar decisiones: ${(e as Error).message}`);
    }
  },
);

server.registerTool(
  "validate_context_entry",
  {
    title: "Validar entrada de contexto",
    description:
      "Cambia el estado de validación de una entrada: validated, rejected u obsolete.",
    inputSchema: {
      id: z.string().uuid().describe("ID de la entrada de contexto"),
      status: z.enum(["validated", "rejected", "obsolete"]),
    },
  },
  async ({ id, status }) => {
    try {
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
      const hits = await searchContext({ query: question, project, limit: 6 });
      const answer = await synthesizeContextAnswer(
        question,
        hits.map((h) => ({
          title: h.entry.title,
          summary: h.entry.summary ?? h.entry.content,
          type: h.entry.type,
        })),
      );
      if (answer) {
        return text(`${answer}\n\n---\nFuentes consultadas:\n${renderSearchHits(hits)}`);
      }
      // Sin LLM: devolvemos los resultados de búsqueda.
      return text(renderSearchHits(hits));
    } catch (e) {
      return errorText(`Error al responder: ${(e as Error).message}`);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[cortex-mcp] servidor MCP listo (stdio). LLM: ${isLlmEnabled() ? "on" : "off"}.`);
}

const shutdown = async () => {
  await closeSql().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((e) => {
  console.error("[cortex-mcp] fallo al arrancar:", e);
  process.exit(1);
});
