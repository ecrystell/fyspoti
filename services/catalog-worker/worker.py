"""Long-lived YouTube Music metadata worker. stdout is JSON protocol only.

One JSON message per line. Requests may overlap, so replies carry the request ID.
It only reads metadata: no audio, cookies, accounts or bot-check workarounds. A
refusal from YouTube is reported to the caller as the result.
"""

from concurrent.futures import ThreadPoolExecutor
import json
import sys
import threading

import requests
from ytmusicapi import YTMusic

PROTOCOL = 1
SEARCH_FILTERS = {"songs", "videos", "albums", "artists"}
MAX_LIMIT = 50

write_lock = threading.Lock()
clients = threading.local()


def send(message):
    with write_lock:
        print(json.dumps(message, separators=(",", ":"), ensure_ascii=False), flush=True)


# ytmusicapi shares a requests session per client, which is not safe across threads.
def client():
    if not hasattr(clients, "ytmusic"):
        clients.ytmusic = YTMusic()
    return clients.ytmusic


def thumbnails(item):
    return [{"url": t.get("url"), "width": t.get("width"), "height": t.get("height")} for t in item.get("thumbnails") or []]


def artists(item):
    return [{"name": a.get("name"), "id": a.get("id")} for a in item.get("artists") or []]


def track(item, album=None):
    item_album = item.get("album")
    return {
        "videoId": item.get("videoId"),
        "title": item.get("title"),
        "videoType": item.get("videoType"),
        "artists": artists(item),
        "albumName": item_album.get("name") if isinstance(item_album, dict) else (album or item_album),
        "albumId": item_album.get("id") if isinstance(item_album, dict) else None,
        "durationSeconds": item.get("duration_seconds"),
        "isExplicit": item.get("isExplicit"),
        "thumbnails": thumbnails(item),
    }


def album_summary(item):
    return {
        "browseId": item.get("browseId"),
        "title": item.get("title"),
        "type": item.get("type"),
        "year": item.get("year"),
        "artists": artists(item),
        "thumbnails": thumbnails(item),
    }


def artist_summary(item):
    return {"browseId": item.get("browseId"), "name": item.get("artist"), "thumbnails": thumbnails(item)}


def search(params):
    search_filter = params["filter"]
    if search_filter not in SEARCH_FILTERS:
        raise ValueError("Unsupported search filter")
    limit = min(int(params.get("limit", 20)), MAX_LIMIT)
    rows = client().search(str(params["query"]), filter=search_filter, limit=limit)
    if search_filter in ("songs", "videos"):
        return [track(row) for row in rows]
    return [album_summary(row) if search_filter == "albums" else artist_summary(row) for row in rows]


def album(params):
    value = client().get_album(str(params["browseId"]))
    summary = album_summary({**value, "browseId": params["browseId"]})
    summary["tracks"] = [track(row, value.get("title")) for row in value.get("tracks") or []]
    return summary


def artist(params):
    value = client().get_artist(str(params["browseId"]))
    return {"browseId": params["browseId"], "name": value.get("name"), "thumbnails": thumbnails(value)}


METHODS = {"search": search, "album": album, "artist": artist}


def classify(exc):
    if "429" in str(exc):
        return "rate-limited"
    if isinstance(exc, requests.exceptions.RequestException):
        return "network"
    return "provider"


def handle(line):
    request_id = None
    try:
        request = json.loads(line)
        request_id = request["id"]
        send({"id": request_id, "ok": True, "value": METHODS[request["method"]](request.get("params") or {})})
    except Exception as exc:  # A failed request must not take down the others.
        send({"id": request_id, "ok": False, "kind": classify(exc), "message": f"{type(exc).__name__}: {exc}"[:300]})


def main():
    # Windows pipes default to a legacy code page, which cannot carry most titles.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    send({"type": "hello", "protocol": PROTOCOL})
    with ThreadPoolExecutor(max_workers=4) as pool:
        for line in sys.stdin:
            if line.strip():
                pool.submit(handle, line)


if __name__ == "__main__":
    main()
