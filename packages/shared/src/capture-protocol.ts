/**
 * The capture protocol: the sentences that make an agent write to the memory **at the moment it
 * learns something**, rather than at the end of the session or never.
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

const MEMORY_IS = "Living project memory: the decisions, constraints and risks in force.";

export interface SessionMemoryHeaderOptions {
  /** Add the pointer to the `cortex-capture` skill. Only true for whoever has the plugin. Default: false. */
  skill?: boolean;
}

/**
 * The three lines above the context pack at session start: what this is, read it first, and when
 * to write back. Under 300 characters on purpose — every character here is one the pack does not
 * get (`CORTEX_HOOK_CTX_CHARS`).
 */
export function sessionMemoryHeader(brand: string, project: string, opts: SessionMemoryHeaderOptions = {}): string {
  return [
    `## ${brand} context — project "${project}"`,
    MEMORY_IS,
    `${CAPTURE_READ_FIRST}.`,
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
  captureTrigger(),
  CAPTURE_DO_NOT_SAVE,
].join(" ");
