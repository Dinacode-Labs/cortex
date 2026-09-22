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

export const SEARCH_TOOL = "search_project_context";

export function lookupTrigger(tool: string = SEARCH_TOOL): string {
  return `Before answering from the repository alone, ask it with \`${tool}\`: the files hold the rules, the memory holds what the project learned the hard way.`;
}

export const LOOKUP_WHEN =
  "Call it when the question is about how this project does something, why it is the way it is, whether it was already decided, tried or broken before, or what to watch out for in a module.";

export const LOOKUP_SELF_CHECK =
  "Am I about to answer something about this project out of the repository alone? If yes, ask the memory first.";

export const LOOKUP_SKILL_POINTER = "See the cortex-recall skill.";

export function packShowing(shown: number, total: number): string {
  return `Showing ${shown} of ${total} ${total === 1 ? "entry" : "entries"}`;
}

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
