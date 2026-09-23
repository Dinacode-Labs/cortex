# `config/` — the third-party toolbelt registry

**Nothing of Cortex lives here any more.** Its MCP, the `cortex-capture` skill and the
`/cortex-save` command are shipped in the Claude Code plugin (`plugin/claude-code/`) and
installed by `cortex setup` (ADR-0014 revised, and ADR-0032). What remains is the schema of the
registry an organisation uses to distribute **its own** tools.

```
config/
  toolbelt.json   # an empty registry: the schema's template
  README.md       # this
```

## What it is for

A registry declares which MCPs, skills and commands a dev should have, and the CLI installs
them idempotently into every detected agent. Your organisation's registry lives in a repo of
its own -- usually private -- because it is not product, it is one company's configuration
(ADR-0026):

```bash
cortex toolbelt sync https://…/toolbelt.json     # arrives with the `cortex toolbelt` PR
```

The file's schema is in [`docs/toolbelt-registry.md`](../docs/toolbelt-registry.md).

What is distributed is **configuration, never credentials**: each entry documents in `auth`
what the dev has to configure themselves, and an entry whose variables are not exported is
skipped with a warning rather than breaking the installation.

## And where is Cortex's own, then?

```bash
cortex setup --all        # configures every detected agent
cortex setup --status     # what is installed and where
```

In Claude Code that installs the `cortex@dinacode-cortex` plugin, which brings the hooks
(context at the start, capture at the end), the MCP (`cortex mcp`, which talks to the server
and respects your permissions), the capture skill and `/cortex-save`. When the plugin cannot be
installed -- with no access to the repo, for instance -- it falls back to hooks in
`~/.claude/settings.json` and works just the same.

**Cortex is opt-in per repo**: the hooks live at user level, but they only act where there is a
`.cortex.json`, which `cortex link` creates. With no link, nothing is injected and nothing is
captured.

