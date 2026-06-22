"""Resolve Plane connection config (base_url, workspace_slug, api_key).

Order of resolution:
1. Env vars PLANE_BASE_URL / PLANE_WORKSPACE_SLUG / PLANE_API_KEY.
2. The Plane MCP server config inside ~/.claude.json (any object that carries a
   PLANE_API_KEY env, as written by `claude mcp add plane ...`).

Note: PLANE_BASE_URL for the MCP is the ROOT (no /api). The REST API lives at
{root}/api/v1/... — `api_base()` returns the project-scoped REST prefix.
"""
import os, json


def _scan_for_plane(obj):
    """Recursively find an env dict that contains PLANE_API_KEY."""
    if isinstance(obj, dict):
        env = obj.get("env")
        if isinstance(env, dict) and env.get("PLANE_API_KEY"):
            return env
        for v in obj.values():
            r = _scan_for_plane(v)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _scan_for_plane(v)
            if r:
                return r
    return None


def resolve():
    base = os.environ.get("PLANE_BASE_URL")
    slug = os.environ.get("PLANE_WORKSPACE_SLUG")
    key = os.environ.get("PLANE_API_KEY")
    if not (base and slug and key):
        try:
            cfg = json.load(open(os.path.expanduser("~/.claude.json")))
            # Prefer the GLOBAL (top-level) mcpServers.plane block as the default —
            # project-scoped blocks must not win the global default. Claude Code
            # rewrites ~/.claude.json on restart and restores project blocks, so a
            # deterministic preference is required.
            top = (((cfg.get("mcpServers") or {}).get("plane") or {}).get("env")) or {}
            env = top if top.get("PLANE_API_KEY") else (_scan_for_plane(cfg) or {})
            base = base or env.get("PLANE_BASE_URL")
            slug = slug or env.get("PLANE_WORKSPACE_SLUG")
            key = key or env.get("PLANE_API_KEY")
        except Exception:
            pass
    if not (base and slug and key):
        raise SystemExit(
            "No Plane config. Set PLANE_BASE_URL / PLANE_WORKSPACE_SLUG / "
            "PLANE_API_KEY or configure the `plane` MCP server in ~/.claude.json."
        )
    return base.rstrip("/"), slug, key


def api_base(project_id):
    base, slug, _ = resolve()
    return f"{base}/api/v1/workspaces/{slug}/projects/{project_id}"


def headers():
    _, _, key = resolve()
    return {"X-Api-Key": key, "Content-Type": "application/json"}
