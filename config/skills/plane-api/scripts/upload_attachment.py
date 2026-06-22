#!/usr/bin/env python3
"""Upload a file as a NATIVE attachment to a Plane work item.

The Plane MCP server has no attachment tool, so this fills that gap using the
REST asset flow (3 steps):
  1. POST .../work-items/<wid>/attachments/  {name,type,size} -> presigned POST + asset_id
  2. multipart POST the binary to upload_data.url (S3-compatible storage)
  3. PATCH .../attachments/<asset_id>/  {is_uploaded: true}

Usage:
  python upload_attachment.py --project <pid> --work-item <wid> --file path/to/img.png
  python upload_attachment.py --project <pid> --work-item <wid> --from-url <URL> [--name NAME]

Notes:
  - --from-url with a trello.com download URL needs TRELLO_KEY + TRELLO_TOKEN env
    (sent as `Authorization: OAuth ...`).
  - Plane rejects mime `image/avif` ("Invalid file type"). With --convert-avif and
    macOS `sips` present, .avif is converted to .jpg before upload.
  - --skip-existing avoids duplicates (matches by attachment name).
"""
import argparse, json, mimetypes, os, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
from _config import api_base, resolve  # noqa


def curl(args):
    return subprocess.run(["curl", "-s"] + args, capture_output=True, text=True).stdout


def cj(method, url, body=None):
    base, slug, key = resolve()
    a = ["-w", "\n%{http_code}", "-X", method, "-H", f"X-Api-Key: {key}",
         "-H", "Content-Type: application/json"]
    if body is not None:
        a += ["-d", json.dumps(body)]
    out = curl(a + [url])
    i = out.rfind("\n")
    return out[i + 1:].strip(), out[:i]


def download(url, dest):
    a = ["-L", "-o", dest, "-w", "%{http_code}"]
    tk, tt = os.environ.get("TRELLO_KEY"), os.environ.get("TRELLO_TOKEN")
    if "trello.com" in url and tk and tt:
        a += ["-H", f'Authorization: OAuth oauth_consumer_key="{tk}", oauth_token="{tt}"']
    return curl(a + [url]).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True)
    ap.add_argument("--work-item", required=True)
    ap.add_argument("--file")
    ap.add_argument("--from-url")
    ap.add_argument("--name")
    ap.add_argument("--skip-existing", action="store_true")
    ap.add_argument("--convert-avif", action="store_true")
    args = ap.parse_args()
    B = api_base(args.project)
    wid = args.work_item

    tmp = None
    if args.from_url:
        name = args.name or os.path.basename(args.from_url.split("?")[0]) or "file"
        tmp = os.path.join(tempfile.gettempdir(), f"_plane_up_{os.getpid()}_{name}")
        code = download(args.from_url, tmp)
        if not code.startswith("2"):
            print(f"ERROR descargando ({code})"); sys.exit(1)
        path = tmp
    else:
        if not args.file:
            print("Da --file o --from-url"); sys.exit(2)
        path = args.file
        name = args.name or os.path.basename(path)

    # avif handling (Plane rejects image/avif)
    if name.lower().endswith(".avif") and args.convert_avif:
        jpg = path + ".jpg"
        subprocess.run(["sips", "-s", "format", "jpeg", path, "--out", jpg],
                       capture_output=True)
        if os.path.exists(jpg):
            path = jpg
            name = name[:-5] + ".jpg" if name.lower().endswith(".jpg.avif") else name[:-5] + ".jpg"

    if args.skip_existing:
        code, resp = cj("GET", f"{B}/work-items/{wid}/attachments/")
        try:
            ex = json.loads(resp); ex = ex if isinstance(ex, list) else ex.get("results", [])
            if any(e.get("attributes", {}).get("name") == name for e in ex):
                print(f"SKIP (ya existe): {name}")
                if tmp and os.path.exists(tmp):
                    os.remove(tmp)
                return
        except Exception:
            pass

    if not os.path.exists(path):
        print(f"ERROR: fichero no encontrado: {path}"); sys.exit(2)
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    size = os.path.getsize(path)

    # 1) create
    code, resp = cj("POST", f"{B}/work-items/{wid}/attachments/",
                    {"name": name, "type": mime, "size": size})
    if not code.startswith("2"):
        print(f"ERROR create ({code}): {resp[:200]}"); sys.exit(1)
    j = json.loads(resp); ud = j["upload_data"]; aid = j["asset_id"]

    # 2) upload binary to presigned POST
    fields = []
    for k, v in ud["fields"].items():
        fields += ["-F", f"{k}={v}"]
    fields += ["-F", f"file=@{path}"]
    up = curl(["-o", "/dev/null", "-w", "%{http_code}", "-X", "POST"] + fields + [ud["url"]]).strip()
    if up not in ("200", "204"):
        cj("DELETE", f"{B}/work-items/{wid}/attachments/{aid}/")
        print(f"ERROR upload S3 ({up}) — registro borrado. "
              f"Si es 413, subir client_max_body_size/FILE_SIZE_LIMIT en el server."); sys.exit(1)

    # 3) confirm
    cj("PATCH", f"{B}/work-items/{wid}/attachments/{aid}/", {"is_uploaded": True})
    print(f"OK: {name} ({size//1024} KB, {mime}) -> asset {aid}")
    if tmp and os.path.exists(tmp):
        os.remove(tmp)


if __name__ == "__main__":
    main()
