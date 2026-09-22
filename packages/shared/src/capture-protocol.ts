/**
 * The agent protocol: the sentences that make an agent **read** the memory before it answers and
 * **write** to it at the moment it learns something, rather than at the end of the session or
 * never.
 *
 * They live in `shared` because five entrypoints say the same thing to five different agents —
 * the session-start header, the MCP server's instructions, the Claude Code plugin's skill, the
 * OpenCode command and Pi's memory tool — and a wording that drifts between them is a protocol
 * nobody follows. Whoever carries this text is checked by `tests/capture-protocol.test.ts`.
 *
 * The lengths are deliberate: the header competes with the context pack for the session's budget,
 * and instructions the agent skims are instructions it does not apply.
 */

/** The MCP tool that saves. Pi renames it (`cortex.mem_save`), so the trigger takes it as an argument. */
export const SAVE_TOOL = "save_project_context";

/**
 * What makes an agent save, in one sentence, naming the tool **that** agent has. Deciding,
 * confirming and correcting are the three moments the user is present and the reason is still
 * known; a summary written later has the what and has lost the why.
 */
export function captureTrigger(tool: string = SAVE_TOOL): string {
  return `When the user decides, confirms or corrects you, save it with \`${tool}\`.`;
}

/**
 * The question the agent asks itself when it finishes a task. It is quoted verbatim in every
 * carrier so it can be repeated as-is: a self-check the agent has to paraphrase is one it skips.
 */
export const CAPTURE_SELF_CHECK =
  "Did the user just decide, confirm, reject or correct me, or did I fix something with a root cause? If yes, save it now.";

/** A memory full of noise is worse than an empty one, because people stop reading it. */
export const CAPTURE_DO_NOT_SAVE =
  "Do not save task progress, tool or environment hiccups, open questions, what the repository already documents, or secrets.";

/**
 * Where the long form lives. Only for the agents that install the plugin (Claude Code, Codex):
 * pointing Pi at a skill it does not have is how an agent learns to skim the rest of the header.
 */
export const CAPTURE_SKILL_POINTER = "See the cortex-capture skill.";

/**
 * Reading is the other half of the loop, and the half an agent skips when nothing asks for it.
 * No full stop: each carrier continues the sentence its own way.
 */
export const CAPTURE_READ_FIRST = "Read it before touching a module";

/** The MCP tool that searches. Pi renames its tools, so the trigger takes the name as an argument. */
export const SEARCH_TOOL = "search_project_context";

/**
 * What makes an agent ask the memory instead of answering from the tree.
 *
 * The second half is the one that does the work. An agent asked something about the project
 * recognises it as a question about the repository, finds a rule in `.claude/` or a README that
 * answers it coherently, and stops there — it never asks what the project knows from experience,
 * which is the one thing the files do not hold. Naming that difference is what makes the lookup
 * happen; "read the memory first" on its own reads as advice and loses to an answer already found.
 */
export function lookupTrigger(tool: string = SEARCH_TOOL): string {
  return `Before answering from the repository alone, ask it with \`${tool}\`: the files hold the rules, the memory holds what the project learned the hard way.`;
}

/**
 * When to call the search tool, for the carriers that have room to say more than the trigger: the
 * tool's own description and the lookup skill. Phrased as the shapes a question arrives in,
 * because that is what an agent can match against the message in front of it.
 */
export const LOOKUP_WHEN =
  "Call it when the question is about how this project does something, why it is the way it is, whether it was already decided, tried or broken before, or what to watch out for in a module.";

/**
 * The question the agent asks itself before answering. Quoted verbatim by every carrier, like
 * `CAPTURE_SELF_CHECK`: a self-check the agent has to paraphrase is one it skips.
 */
export const LOOKUP_SELF_CHECK =
  "Am I about to answer something about this project out of the repository alone? If yes, ask the memory first.";

/** Where the long form of the lookup half lives. Only for whoever installs the plugin. */
export const LOOKUP_SKILL_POINTER = "See the cortex-recall skill.";

/**
 * The two numbers that stop a pack being mistaken for the memory. They cost nothing — the line
 * they go on was already being spent on a count — so they are never dropped, whatever the budget.
 */
export function packShowing(shown: number, total: number): string {
  return `Showing ${shown} of ${total} ${total === 1 ? "entry" : "entries"}`;
}

/**
 * What a rendered context pack is, said in the pack itself.
 *
 * It travels with the pack rather than with the session header because the header is not always
 * there: `get_project_context_pack` hands the same text to an agent that never saw one.
 *
 * "What is not here is not absent" is the sentence doing the work. The pack reads like a complete
 * briefing — eleven titled sections, every kind of knowledge present — and an agent that takes it
 * for the memory concludes from a section it has fully read that the project has nothing more to
 * say on it. It has; it did not fit.
 */
export function packIsASample(tool: string = SEARCH_TOOL): string {
  return [
    "A sample of the memory, not the memory: what is not here is not absent, it did not fit.",
    lookupTrigger(tool),
    "A section ending in **+N more** has N entries recorded and not shown; pass that section's `type` to read them.",
  ].join(" ");
}

const MEMORY_IS = "Living project memory: the decisions, constraints and risks in force.";

export interface SessionMemoryHeaderOptions {
  /** Add the pointer to the `cortex-capture` skill. Only true for whoever has the plugin. Default: false. */
  skill?: boolean;
}

/**
 * The four lines above the context pack at session start: what this is, when to read it, when to
 * write back, and where the long form of each half lives. Under 450 characters on purpose — every
 * character here is one the pack does not get (`CORTEX_HOOK_CTX_CHARS`).
 *
 * The lookup line is worth about one pack entry and is spent anyway: an agent that has the whole
 * pack and does not know to ask for the rest answers from the tree, which is the failure the pack
 * was already losing to.
 */
export function sessionMemoryHeader(brand: string, project: string, opts: SessionMemoryHeaderOptions = {}): string {
  const read = `${CAPTURE_READ_FIRST}. ${lookupTrigger()}`;
  return [
    `## ${brand} context — project "${project}"`,
    MEMORY_IS,
    opts.skill ? `${read} ${LOOKUP_SKILL_POINTER}` : read,
    opts.skill ? `${captureTrigger()} ${CAPTURE_SKILL_POINTER}` : captureTrigger(),
  ].join("\n");
}

/**
 * The MCP server's `instructions`: what a client puts in front of the model when it connects,
 * which for Hermes and for any agent with no plugin is the only place the protocol reaches.
 */
export const MCP_INSTRUCTIONS = [
  "This server is the project's memory.",
  `${CAPTURE_READ_FIRST} (get_project_context_pack, ask_project_context).`,
  lookupTrigger(),
  captureTrigger(),
  CAPTURE_DO_NOT_SAVE,
].join(" ");
