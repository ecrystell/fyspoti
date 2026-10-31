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
MAX_PLAYLIST_LIMIT = 200

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


# Rows use "thumbnails", except radio rows, which use "thumbnail".
def thumbnails(item):
    rows = item.get("thumbnails") or item.get("thumbnail") or []
    return [{"url": t.get("url"), "width": t.get("width"), "height": t.get("height")} for t in rows]


def artists(item):
    return [{"name": a.get("name"), "id": a.get("id")} for a in item.get("artists") or []]


# Radio rows give length as "3:00" and have no duration_seconds.
def seconds(item):
    if item.get("duration_seconds"):
        return item["duration_seconds"]
    parts = str(item.get("length") or "").split(":")
    if not all(part.isdigit() for part in parts):
        return None
    total = 0
    for part in parts:
        total = total * 60 + int(part)
    return total


def track(item, album=None):
    item_album = item.get("album")
    return {
        "videoId": item.get("videoId"),
        "title": item.get("title"),
        "videoType": item.get("videoType"),
        "artists": artists(item),
        "albumName": item_album.get("name") if isinstance(item_album, dict) else (album or item_album),
        "albumId": item_album.get("id") if isinstance(item_album, dict) else None,
        "durationSeconds": seconds(item),
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
        "isExplicit": item.get("isExplicit"),
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


def related_artists(params):
    value = client().get_artist(str(params["browseId"]))
    rows = (value.get("related") or {}).get("results") or []
    return [{"browseId": row.get("browseId"), "name": row.get("title"), "thumbnails": thumbnails(row)} for row in rows]


def radio(params):
    limit = min(int(params.get("limit", 50)), MAX_LIMIT)
    return [track(row) for row in client().get_watch_playlist(videoId=str(params["videoId"]), radio=True, limit=limit).get("tracks") or []]


def playlist_summary(item):
    return {"playlistId": item.get("playlistId"), "title": item.get("title"), "description": item.get("description"), "thumbnails": thumbnails(item)}


def home_item(item):
    if item.get("videoId"):
        return {"kind": "track", "row": track(item)}
    if str(item.get("browseId") or "").startswith("MPRE"):
        return {"kind": "album", "row": album_summary(item)}
    if item.get("playlistId"):
        return {"kind": "playlist", "row": playlist_summary(item)}
    return None


def home(params):
    shelves = []
    for shelf in client().get_home(limit=int(params.get("limit", 6))):
        items = [home_item(item) for item in shelf.get("contents") or [] if item]
        shelves.append({"title": shelf.get("title"), "items": [item for item in items if item]})
    return shelves


def moods(_params):
    return [{"group": group, "title": row.get("title"), "params": row.get("params")} for group, rows in client().get_mood_categories().items() for row in rows]


def mood_playlists(params):
    return [playlist_summary(row) for row in client().get_mood_playlists(str(params["params"]))]


def playlist(params):
    limit = min(int(params.get("limit", 100)), MAX_PLAYLIST_LIMIT)
    return [track(row) for row in client().get_playlist(str(params["playlistId"]), limit=limit).get("tracks") or []]


def suggestions(params):
    return [str(row) for row in client().get_search_suggestions(str(params["query"]))]


METHODS = {
    "search": search,
    "album": album,
    "artist": artist,
    "related": related_artists,
    "radio": radio,
    "home": home,
    "moods": moods,
    "moodPlaylists": mood_playlists,
    "playlist": playlist,
    "suggestions": suggestions,
}


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
