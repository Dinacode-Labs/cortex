# Plane API — reference

Base (project-scoped): `https://plane.dinacode.com/api/v1/workspaces/<slug>/projects/<pid>`
Header: `X-Api-Key: <personal token>`

## Endpoints used

| Method | Path (relative to project base) | Purpose |
|--------|---------------------------------|---------|
| GET | `issues/?per_page=100[&cursor=]` | List issues (paginate via `next_cursor` / `next_page_results`) |
| POST | `issues/` | Create issue (`name`,`state`,`priority`,`labels[]`,`description_html`,`parent`,`external_source`,`external_id`,…) |
| GET/PATCH/DELETE | `issues/{id}/` | Read / update / delete an issue |
| POST | `issues/{id}/comments/` | Add comment (`comment_html`) |
| POST | `issues/{id}/links/` | Add a URL link (`url`,`title`) |
| GET/POST | `states/` | List / create states (`name`,`color`,`group`) |
| GET/POST/DELETE | `labels/` (+ `labels/{id}/`) | List / create / delete labels |
| GET/POST | `work-items/{wid}/attachments/` | List / create attachment (presigned). Alias: `issues/{id}/issue-attachments/` |
| PATCH/DELETE | `work-items/{wid}/attachments/{asset_id}/` | Confirm (`is_uploaded:true`) / delete |
| GET | `cycles/`, `modules/` | List cycles / modules |

`external_source`/`external_id` give idempotency + provenance (we used source `trello`).

## Work item fields commonly patched
`name`, `description_html`, `state` (uuid), `priority` (`urgent|high|medium|low|none`),
`labels` (array of uuids — **replaces** the set), `parent` (uuid, for sub-issues),
`assignees`, `target_date`, `start_date`.

## Native attachment upload — full flow
1. `POST work-items/{wid}/attachments/` body `{"name","type","size"}` → response
   `{"upload_data":{"url","fields":{...}}, "asset_id", "asset_url"}`.
   `upload_data` is an S3-style presigned POST; `fields` includes `key`, `policy`,
   `x-amz-*`, `Content-Type`.
2. multipart `POST upload_data.url` with every `fields` entry as `-F k=v` and the file as
   the **last** `-F file=@path`. Success = HTTP 200/204.
3. `PATCH work-items/{wid}/attachments/{asset_id}/` `{"is_uploaded":true}`.

Storage notes: works against Plane's local `/uploads`. **Backblaze B2 → 501** on POST
Object (use PUT-based storage or local). Size cap → 413 (`FILE_SIZE_LIMIT` + proxy
`client_max_body_size`). `image/avif` rejected → convert.

## Downloading attachments from Trello
Trello upload URLs (`https://trello.com/1/cards/<cid>/attachments/<aid>/download/<file>`)
need OAuth:
```
curl -L -H 'Authorization: OAuth oauth_consumer_key="<KEY>", oauth_token="<TOKEN>"' -o out <url>
```
Trello creds live in `~/.trello-cli/config.json` (`ApiKey`, `Token`). Export as
`TRELLO_KEY` / `TRELLO_TOKEN` for `upload_attachment.py --from-url`.

## Gotchas
- Use **curl**, not Python `urllib` (urllib gave spurious 403/empty here).
- Reads + writes both work with the PAT. The MCP can also write (same key).
- Throttle: 429/502 under bursts → sequential + retry on 429/5xx.
- MCP `PLANE_BASE_URL` has **no** `/api`; the server appends `/api/v1`. REST callers add
  `/api/v1` themselves.
- `mcp__plane__*` feature endpoints for **epics / work-item-types / project-features**
  return 404 on this build → not available via API. Group work with a parent issue +
  sub-issues (set `parent`) instead of native Epics.
