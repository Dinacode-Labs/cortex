#!/usr/bin/env python3
"""Thin Plane REST CLI for bulk/scripted ops the MCP is clumsy at.

Auth/config auto-resolved from env or the `plane` MCP server in ~/.claude.json.
Reads work fine via REST; WRITES also work with the personal token (the early
"403 code 1010" was a urllib bug — always use this curl-based client).

Examples:
  python plane.py states   --project <pid>
  python plane.py labels   --project <pid>
  python plane.py list     --project <pid> [--state Done] [--fields id,seq,name,state,priority,labels]
  python plane.py get      --project <pid> --issue <id>
  python plane.py patch    --project <pid> --issue <id> --json '{"state":"<uuid>","priority":"high"}'
  python plane.py create   --project <pid> --json '{"name":"X","state":"<uuid>"}'
  python plane.py comment  --project <pid> --issue <id> --html '<p>hola</p>'
"""
import argparse, json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from _config import api_base, resolve  # noqa


def cj(method, url, body=None, retries=4):
    _, _, key = resolve()
    a = ["curl", "-s", "-w", "\n%{http_code}", "-X", method,
         "-H", f"X-Api-Key: {key}", "-H", "Content-Type: application/json"]
    if body is not None:
        a += ["-d", json.dumps(body)]
    for n in range(retries):
        out = subprocess.run(a + [url], capture_output=True, text=True).stdout
        i = out.rfind("\n"); code, body_txt = out[i + 1:].strip(), out[:i]
        if code and code[0] == "2":
            return code, body_txt
        if code in ("429", "502", "503", "500"):
            time.sleep(2 * (n + 1)); continue
        return code, body_txt
    return code, body_txt


def paginate(B):
    items, cur = [], ""
    while True:
        c, b = cj("GET", f"{B}/issues/?per_page=100" + (f"&cursor={cur}" if cur else ""))
        d = json.loads(b); items += d.get("results", [])
        if d.get("next_page_results") and d.get("next_cursor"):
            cur = d["next_cursor"]; time.sleep(0.2)
        else:
            return items


def name_map(B, kind):
    c, b = cj("GET", f"{B}/{kind}/")
    d = json.loads(b); r = d.get("results", d) if isinstance(d, dict) else d
    return {x["name"]: x["id"] for x in r}, {x["id"]: x["name"] for x in r}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["states", "labels", "list", "get", "patch", "create", "comment"])
    ap.add_argument("--project", required=True)
    ap.add_argument("--issue")
    ap.add_argument("--json")
    ap.add_argument("--html")
    ap.add_argument("--state")
    ap.add_argument("--fields", default="seq,name,state,priority,labels")
    args = ap.parse_args()
    B = api_base(args.project)

    if args.cmd in ("states", "labels"):
        n2i, _ = name_map(B, args.cmd)
        print(json.dumps(n2i, ensure_ascii=False, indent=1)); return

    if args.cmd == "list":
        _, sid2n = name_map(B, "states")
        _, lid2n = name_map(B, "labels")
        rows = paginate(B)
        if args.state:
            rows = [r for r in rows if sid2n.get(r.get("state")) == args.state]
        flds = args.fields.split(",")
        for r in rows:
            o = {}
            for f in flds:
                if f == "seq": o["seq"] = r.get("sequence_id")
                elif f == "state": o["state"] = sid2n.get(r.get("state"))
                elif f == "labels": o["labels"] = [lid2n.get(x) for x in r.get("labels", [])]
                else: o[f] = r.get(f)
            print(json.dumps(o, ensure_ascii=False))
        return

    if args.cmd == "get":
        c, b = cj("GET", f"{B}/issues/{args.issue}/"); print(b); return

    if args.cmd == "patch":
        c, b = cj("PATCH", f"{B}/issues/{args.issue}/", json.loads(args.json))
        print(c, b[:300]); return

    if args.cmd == "create":
        c, b = cj("POST", f"{B}/issues/", json.loads(args.json))
        d = json.loads(b) if b.startswith("{") else {}
        print(c, "#%s" % d.get("sequence_id"), d.get("id", b[:200])); return

    if args.cmd == "comment":
        c, b = cj("POST", f"{B}/issues/{args.issue}/comments/", {"comment_html": args.html})
        print(c); return


if __name__ == "__main__":
    main()
