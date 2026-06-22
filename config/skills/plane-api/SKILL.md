---
name: plane-api
description: |
  Plane (self-hosted) REST helpers for what the Plane MCP can't do: upload native
  file/image attachments to work items, bulk read/patch issues efficiently, and
  convert Markdown descriptions to the HTML Plane renders. Use when working with
  Plane and you need to attach files, do bulk task edits, fix markdown-in-descriptions,
  or hit the Plane REST API directly. Complements the `mcp__plane__*` tools.
---

# Plane API helpers

The Plane **MCP** (`mcp__plane__*`) covers CRUD on work items, comments, labels, states,
relations, etc. — prefer it for one-off operations. This skill covers the **gaps**:

| Need | Use |
|------|-----|
| Create/update/list a few work items, comments, labels, states | **MCP** (`mcp__plane__*`) |
| **Attach a file/image** to a work item | `scripts/upload_attachment.py` (MCP has no attachment tool) |
| **Bulk** read or patch many issues fast | `scripts/plane.py` (REST + curl; far cheaper than N tool calls) |
| **Markdown → HTML** for a description | `scripts/md2html.py` (Plane renders HTML, not markdown) |

## Config (auto-resolved)

Scripts resolve `PLANE_BASE_URL`, `PLANE_WORKSPACE_SLUG`, `PLANE_API_KEY` from env, or
from the `plane` MCP server block in `~/.claude.json`. So normally **no setup needed**.
Env vars take precedence over the `~/.claude.json` block, so to target a specific
workspace/project prefix the command with the slug, e.g.
`PLANE_WORKSPACE_SLUG=<slug> python plane.py list --project <project-id>`.
Token is the user's **personal** Plane PAT (works across their workspaces) — it lives
only in env / `~/.claude.json`, **never commit it**.

## How we hit Plane by API (the important bits)

- **Base**: MCP `PLANE_BASE_URL` is the ROOT `https://plane.dinacode.com` (no `/api`).
  The REST API is at `{root}/api/v1/workspaces/{slug}/projects/{pid}/...`.
- **Auth header**: `X-Api-Key: <PAT>`.
- **Reads and writes both work** with the PAT over REST. The "403 code 1010" seen once
  was a **bug in a `urllib` test**, NOT a restriction — always use **curl** (these
  scripts do). `urllib` has misbehaved (spurious 403/empty); avoid it.
- **Throttle**: the self-hosted box returns `429`/`502` under bursts. Go sequential with
  small sleeps + retries (the scripts retry on 429/5xx).
- Useful endpoints (under the project base): `issues/` (list/create, paginated via
  `next_cursor`), `issues/{id}/` (PATCH state/labels/priority/name/description_html),
  `issues/{id}/comments/`, `issues/{id}/links/`, `states/`, `labels/`,
  `work-items/{id}/attachments/` (also `issues/{id}/issue-attachments/`).

## How file/image upload works (native, 3 steps)

The MCP exposes no attachment tool. Native upload is a presigned flow:

1. `POST {base}/work-items/{wid}/attachments/` with `{name, type(mime), size}` →
   returns `upload_data {url, fields}` (an S3-style presigned POST) + `asset_id`.
2. **multipart POST** the binary to `upload_data.url` with all `upload_data.fields` plus
   `file=@<path>` (file field last).
3. `PATCH {base}/work-items/{wid}/attachments/{asset_id}/` with `{is_uploaded: true}`.

`scripts/upload_attachment.py` does all three. Examples:

```bash
# local file
python scripts/upload_attachment.py --project <pid> --work-item <wid> --file ./shot.png

# download from a URL first (Trello needs TRELLO_KEY + TRELLO_TOKEN env for OAuth)
python scripts/upload_attachment.py --project <pid> --work-item <wid> \
  --from-url "https://trello.com/1/cards/.../download/x.jpg" --skip-existing
```

**Gotchas learned the hard way:**
- The storage backend matters. **Backblaze B2 returns `501 NotImplemented`** for the
  presigned *POST Object* (B2 only supports PUT). With Plane's **local `/uploads`** store
  the POST works (204). If you ever see 501, the bucket is the problem, not the code.
- **`413 Payload Too Large`** = server upload-size cap (~4–5 MB by default). Raise
  `client_max_body_size` (nginx/Caddy proxy) and Plane `FILE_SIZE_LIMIT`.
- **`image/avif` is rejected** ("Invalid file type"). Convert first
  (`--convert-avif` uses macOS `sips`), or send another image mime.

## Bulk read / patch

```bash
python scripts/plane.py states  --project <pid>          # name -> uuid map
python scripts/plane.py labels  --project <pid>
python scripts/plane.py list    --project <pid> --state "In Progress"
python scripts/plane.py patch   --project <pid> --issue <id> --json '{"priority":"high"}'
python scripts/plane.py comment --project <pid> --issue <id> --html '<p>nota</p>'
```

For large edits, build the changes in a JSON file and loop `patch` (sequential, throttled).

## Descriptions: Markdown → HTML

Plane renders **HTML** (`description_html`); raw markdown shows literally. Convert before
PATCHing a description:

```bash
python scripts/md2html.py < input.md        # prints HTML
```

Or import `md2html(text)` from `scripts/md2html.py`. Handles headings, bold, italic,
inline code, `[text](url)` links, and `-`/`1.` lists. It runs `html.unescape` first so
already-encoded text isn't double-escaped.

See `REFERENCE.md` for the full endpoint list and the migration context.
