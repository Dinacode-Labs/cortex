# The toolbelt registry (schema)

Cortex distributes two different things to each developer's agents, and it is worth not
confusing them:

1. **Its own** — Cortex's MCP, the `cortex-capture` skill and the `/cortex-save` command.
   `cortex setup` installs those, in Claude Code through the `plugin/claude-code/` plugin,
   without anything having to be declared in any registry.
2. **Your organisation's toolbelt** — the MCPs and skills of the tools your team uses (ticket
   tracker, chat, repository, whatever). That does **not** live in this repo: it is declared in
   a registry of its own, usually in a private repo, and installed with
   `cortex toolbelt sync --registry <path-or-url>`.

The separation is set out in [ADR-0014](./decisions.md) (revised), [ADR-0026](./decisions.md)
and [ADR-0032](./decisions.md).

## Format

A single JSON with three lists. A complete example:

```jsonc
{
  "$comment": "<your organisation>'s toolbelt. It distributes CONFIGURATION, never credentials.",

  // MCPs registered into every detected agent.
  "mcpServers": {
    // stdio: a local process is launched.
    "tickets": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["my-mcp-server", "stdio"],
      "env": ["TICKETS_API_KEY", "TICKETS_BASE_URL"],  // read from the dev's environment
      "auth": "a personal token in TICKETS_API_KEY",   // text for `cortex toolbelt doctor`
      "agents": ["claude", "codex", "opencode", "hermes"]
    },
    // http: a remote server (OAuth or a header). Codex does not support this transport.
    "docs": {
      "transport": "http",
      "url": "https://mcp.example.com/mcp",
      "auth": "OAuth in the browser the first time",
      "agents": ["claude", "opencode", "hermes"]
    }
  },

  // Skills (Claude Code only): folders with a SKILL.md inside the registry's repo.
  "skills": [
    { "name": "my-skill", "auth": "none" }
  ],

  // Slash commands (Claude Code, Codex, OpenCode): .md files from the registry's repo.
  "commands": [
    { "name": "my-command", "file": "my-command.md" }
  ]
}
```

## Rules worth respecting

- **Configuration, never credentials.** The `env` field names variables; it does not set
  values. An entry whose variables are not exported is skipped with a warning, not a failure.
- **`{REPO}`** is replaced by the checkout's path when the registry is local. An entry using it
  cannot be installed from a remote URL: it is skipped with a warning.
- **`agents`** narrows which agents each entry goes to. Useful because they do not all support
  the same things (Codex does not accept MCP over HTTP, and today only Claude Code consumes
  skills).
- The registry is **idempotent**: `cortex toolbelt sync` without `--apply` shows the plan, and
  applying it respects whatever is already configured by hand (it does not overwrite existing
  auth).
