# Research — hooks (Claude Code and others) for Cortex

How to use the agent's **hooks** to automate Cortex's loop ("you work → Cortex remembers and
learns") without the dev having to invoke anything, how other projects do it, and the
**friction** of not every platform having them in the same shape. It complements the plugin
(`cortex setup`) and the `cortex-capture` skill.

## What hooks would gain us (the 2 key loops)

1. **Injecting context automatically (pull).** On `SessionStart` and/or `UserPromptSubmit`, a
   hook calls Cortex and **injects** the project's context pack (decisions in force,
   constraints, risks) into the model's window through `additionalContext`. The agent starts
   already "knowing" the project, without anybody asking for `get_project_context_pack`.
   Transparent per-prompt RAG.
2. **Capturing the work automatically (push).** On `Stop`/`SessionEnd` (and `PreCompact`), a
   hook summarises the session and calls `save_project_context`. It closes the loop **without**
   depending on the dev running `/cortex-save`.

Extras: **observability** (PostToolUse/PreToolUse → record usage, which fits our AI tracing),
**policies** (PreToolUse blocks editing a module Cortex marked sensitive), **lint on edit**
(PostToolUse).

## Claude Code's hooks (summary)
The relevant events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
`Stop`/`SubagentStop`, `PreCompact`, `SessionEnd`. They are configured in `settings.json`
(`hooks → Event → matcher → command`), with user/project/local scope. The hook receives JSON on
stdin (`session_id`, `cwd`, `transcript_path`, `tool_name`/`tool_input`...) and can:
- **Inject context** (`additionalContext`) on **SessionStart, UserPromptSubmit, PreToolUse,
  PostToolUse**.
- **Block or decide** (PreToolUse `allow/deny/ask`; UserPromptSubmit/PostToolUse `block`);
  `exit 2` = blocking.
- Run an arbitrary command / (depending on the version) call an MCP or HTTP.

**Gotchas:** they run **synchronously** → mind the latency (UserPromptSubmit taxes every
prompt; keep it under ~2-5s, use async where possible). On **SessionStart the MCP may not be
connected yet** → the hook must call Cortex over **CLI/HTTP** (not through mcp_tool). An
arbitrary command means being careful about security. There is a practical limit on the
injected context (a few KB).

## How others do it (verified)
- **Auto-capture into memory:** `claude-mem` (Stop → compresses the session into SQLite;
  PostToolUse queues tool calls; UserPromptSubmit indexes prompts), `claude-memory-compiler`
  (SessionEnd/PreCompact → flush with the Agent SDK), **mem0** (PreCompact stores a summary;
  SessionStart/UserPromptSubmit load memories). **This is exactly our loop.**
- **Context injection (RAG):** SessionStart/UserPromptSubmit → `additionalContext` (claude-mem,
  mem0; per-package rules in PreToolUse).
- **Observability:** `disler/claude-code-hooks-multi-agent-observability` (each hook POSTs to a
  server → SQLite → dashboard) -- **a mirror of our AI tracing into Postgres**.
- **Policies / lint:** blocking `rm -rf` or reading `.env` (exit 2), TDD-guard,
  Prettier/ESLint/tsc on PostToolUse.

## Friction: portability between agents (the important part)
The good news: **hooks are NO longer a Claude Code exclusive.**

| Capability | Claude Code | Codex CLI | OpenCode | Hermes (Nous) |
|---|---|---|---|---|
| Lifecycle hooks | Yes (settings.json, shell) | **Yes** (`hooks` in config.toml; names like SessionStart/PreToolUse/Stop…) | **Yes** (an event bus through **TS plugins**: `tool.execute.before/after`, `session.*`, `file.edited`…) | **Yes** (`~/.hermes/config.yaml`: `pre/post_tool_call`, `on_session_start/end`, `pre/post_llm_call`…) |
| Context injection | `additionalContext` | partial/different | no identical stdout convention | different |
| MCP | Yes | Yes | Yes | Yes |
| Context file | CLAUDE.md | AGENTS.md | AGENTS.md | AGENTS.md/.hermes |

**Conclusion:** the friction is one of **shape, not of absence** -- what changes is the format
(JSON/TOML/YAML), the event names, the payload schema and the injection mechanism. A Claude
shell hook does **not** run in OpenCode (it needs a TS plugin) and does not use the same
contract in Codex. **MCP plus AGENTS.md are what is genuinely portable** (all four support
them, and it is how Cortex already exposes its 8 tools).

## Recommended strategy for Cortex
**A portable baseline plus hooks as a progressive enhancement:**
1. **The `cortex` MCP (already done) = the portable core.** All the logic (capturing, fetching
   the context pack) lives in the MCP tools; any agent can use them.
2. **Thin per-agent hook adapters**, all calling the SAME thing (Cortex's tools/CLI): shell for
   Claude/Codex/Hermes, **a TS plugin for OpenCode**. The adapter only wires "event → call
   Cortex"; zero duplicated logic.
3. **Distribute them with `cortex sync`** (extend the toolbelt with a per-agent `hooks` section;
   it installs the adapter in the right place for each).
4. **For SessionStart with no MCP connected** → the adapter calls Cortex over **HTTP** (see the
   roadmap: the MCP's HTTP transport) or through a mini-CLI that reads the local database.
5. **Graceful degradation:** with no hooks, the `cortex-capture` skill plus invoking the tools
   by hand remains. Hooks only make it *automatic*.

**A risk to watch:** do not build features that work ONLY with Claude's hooks (it breaks the
multi-agent promise). Keep parity through the MCP tools; hooks accelerate, they do not
exclusively enable.

## Sources
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- claude-mem, claude-memory-compiler, mem0 (Claude Code integration):
  https://github.com/thedotmack/claude-mem · https://github.com/coleam00/claude-memory-compiler · https://docs.mem0.ai/integrations/claude-code
- Observability through hooks: https://github.com/disler/claude-code-hooks-multi-agent-observability
- Codex hooks: https://developers.openai.com/codex/hooks
- OpenCode plugins/events: https://opencode.ai/docs/plugins/
- Hermes hooks: https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks
- awesome-claude-code: https://github.com/hesreallyhim/awesome-claude-code
