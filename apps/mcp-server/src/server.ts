import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_INSTRUCTIONS, saveContextInput, searchContextInput } from "@cortex/shared";
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
import { askProjectContext } from "@cortex/agents";
import { z } from "zod";
import { createRequire } from "node:module";

/**
 * Construction of Cortex's MCP (the 8 tools), reusable by any transport (stdio in `index.ts`,
 * HTTP in `http.ts`). When `user` is passed (the authenticated HTTP transport), the tools
 * **attribute** writes (`created_by`=email) and **apply permissions** (project access);
 * without `user` (local stdio) they behave as before.
 */
/** The version the MCP announces comes from its own package.json: lying about it confuses the client. */
const VERSION: string = (() => {
  try {
    return (createRequire(import.meta.url)("../package.json") as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const errorText = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

export function buildMcpServer(user?: AuthUser): McpServer {
  // `instructions` is what the client puts in front of the model on connecting. For an agent with
  // no plugin — Hermes, an editor speaking MCP — it is the only place the capture protocol reaches,
  // which is why the wording is the shared one and not a second version of it.
  const server = new McpServer({ name: "cortex", version: VERSION }, { instructions: MCP_INSTRUCTIONS });

  // Project access permission (only when there is an authenticated user; without `user` --
  // local stdio -- no guards apply). It returns the denial message, or null when the call may
  // proceed. On READS a non-existent project is rejected (`not_found`); WRITES by name pass
  // `allowMissing` because save auto-creates the project (see the ADR).
  const guard = async (project?: string, opts?: { allowMissing?: boolean }): Promise<string | null> => {
    if (!user || !project) return null;
    const access = await checkProjectAccess(user.email, { name: project });
    if (access.status === "forbidden") return `No access to project "${project}".`;
    if (access.status === "not_found" && !opts?.allowMissing) return `Project not found: "${project}".`;
    return null;
  };

  server.registerTool(
    "save_project_context",
    {
      title: "Save project context",
      description:
        "Save one piece of project knowledge (a decision, constraint, incident, " +
        "convention, and so on). Cortex classifies it, summarises it, extracts entities, " +
        "embeds it and flags likely duplicates or contradictions. Only 'content' is required.",
      inputSchema: saveContextInput.shape,
    },
    async (args) => {
      try {
        const denied = await guard(args.project, { allowMissing: true });
        if (denied) return errorText(denied);
        const result = await saveContext(user ? { ...args, createdBy: user.email } : args);
        return text(renderSaveResult(result));
      } catch (e) {
        return errorText(`Could not save the entry: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "search_project_context",
    {
      title: "Search project context",
      description:
        "Hybrid search (semantic plus keyword) over the project knowledge base. Returns the " +
        "closest entries with their score, summary and source. Can be filtered by project and type.",
      inputSchema: searchContextInput.shape,
    },
    async (args) => {
      try {
        const denied = await guard(args.project);
        if (denied) return errorText(denied);
        // With a user (authenticated HTTP) and no concrete project, the search is restricted
        // to accessible projects (so other people's private ones do not leak). Without `user`
        // (trusted local stdio) it searches everything, as before.
        const hits = user ? await searchContext(args, { restrictToAccessibleOf: user.email }) : await searchContext(args);
        return text(renderSearchHits(hits));
      } catch (e) {
        return errorText(`Search failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "get_project_context_pack",
    {
      title: "Get project context pack",
      description:
        "Build a briefing for working on a project: current decisions, constraints, risks, " +
        "technical debt, conventions and sensitive modules, plus whatever is most relevant to " +
        "an area if you name one. Read this before touching a module.",
      inputSchema: {
        project: z.string().describe("Project slug (what `cortex link` shows) or name, e.g. 'acme-portal' or 'Acme Portal'"),
        area: z.string().optional().describe("Optional area or module, e.g. 'billing'"),
        asOf: z.string().optional().describe("ISO date (YYYY-MM-DD) to see the project as it was known then; defaults to now"),
      },
    },
    async ({ project, area, asOf }) => {
      try {
        const denied = await guard(project);
        if (denied) return errorText(denied);
        return text(renderContextPack(await getContextPack(project, area, asOf ? new Date(asOf) : undefined)));
      } catch (e) {
        return errorText(`Could not build the context pack: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "list_project_decisions",
    {
      title: "List project decisions",
      description: "List the technical decisions recorded for a project, most recent first.",
      inputSchema: {
        project: z.string().describe("Project slug or name"),
        limit: z.number().int().positive().max(50).optional(),
      },
    },
    async ({ project, limit }) => {
      try {
        const denied = await guard(project);
        if (denied) return errorText(denied);
        return text(renderDecisions(await listDecisions(project, limit ?? 20)));
      } catch (e) {
        return errorText(`Could not list decisions: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "validate_context_entry",
    {
      title: "Validate a context entry",
      description: "Change the validation state of an entry: validated, rejected or obsolete.",
      inputSchema: {
        id: z.string().uuid().describe("Id of the context entry"),
        status: z.enum(["validated", "rejected", "obsolete"]),
      },
    },
    async ({ id, status }) => {
      try {
        // This tool works by entry id, not by project name -> the per-project `guard` does not
        // cover it: access is checked through the entry (checkEntryAccess).
        if (user) {
          const access = await checkEntryAccess(user.email, id);
          if (access.status === "not_found") return errorText(`No entry with id ${id}.`);
          if (access.status === "forbidden") return errorText(`No access to entry ${id}.`);
        }
        const entry = await validateEntry(id, status);
        if (!entry) return errorText(`No entry with id ${id}.`);
        return text(`Entry ${entry.id} is now "${entry.status}".`);
      } catch (e) {
        return errorText(`Could not validate the entry: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "ask_project_context",
    {
      title: "Ask the project context",
      description:
        "Ask a question about a project in plain language. Retrieves the relevant context and " +
        "writes an answer grounded in it, citing the entries it used. Needs an LLM configured; " +
        "without one it falls back to search results.",
      inputSchema: {
        question: z.string().describe("The question, in plain language"),
        project: z.string().optional().describe("Project slug or name"),
      },
    },
    async ({ question, project }) => {
      try {
        const denied = await guard(project);
        if (denied) return errorText(denied);
        // Orchestration shared with the web (/ask): retrieve plus synthesise (@cortex/agents).
        // With a user and no concrete project it restricts to accessible projects (P0);
        // `undefined` as the limit keeps the default (6). Without `user` (stdio), unchanged.
        const { answer, hits } = await askProjectContext(
          question,
          project,
          undefined,
          user ? { restrictToAccessibleOf: user.email } : undefined,
        );
        return text(answer ? `${answer}\n\n---\nSources:\n${renderSearchHits(hits)}` : renderSearchHits(hits));
      } catch (e) {
        return errorText(`Could not answer: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "search_project_code",
    {
      title: "Search project code",
      description:
        "Hybrid search over the project's indexed code. Returns snippets with their file path " +
        "and line range. Use it to find where something is implemented before you change it.",
      inputSchema: {
        query: z.string().describe("What to look for: plain language or an identifier"),
        project: z.string().describe("Project slug or name"),
        limit: z.number().int().positive().max(20).optional(),
      },
    },
    async ({ query, project, limit }) => {
      try {
        const denied = await guard(project);
        if (denied) return errorText(denied);
        return text(renderCodeHits(await searchProjectCode(query, project, limit ?? 8)));
      } catch (e) {
        return errorText(`Code search failed: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "lint_project_context",
    {
      title: "Lint the project knowledge",
      description:
        "Report on the health of a project's memory: contradictions, likely duplicates, orphan " +
        "entities, low-confidence entries, superseded history, and gaps (areas with incidents " +
        "but no documented decisions).",
      inputSchema: { project: z.string().describe("Project slug or name") },
    },
    async ({ project }) => {
      try {
        const denied = await guard(project);
        if (denied) return errorText(denied);
        return text(renderLintReport(await lintProject(project)));
      } catch (e) {
        return errorText(`Lint failed: ${(e as Error).message}`);
      }
    },
  );

  return server;
}
