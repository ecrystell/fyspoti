"""Live probe of YouTube Music candidate search and yt-dlp stream resolution.

Candidate search reads metadata only; no copyrighted audio is fetched. Stream
resolution runs against one Creative Commons video and requests 1 KiB of it.
No cookies, account, or bot-check workaround is used: if YouTube refuses a
request, that refusal is the result.

results/ is committed to a public repo, so it holds measurements only: no
third-party titles and no signed URLs.

Not a CI test. Run: python spikes/m0-providers/probe_youtube.py
"""

import json
import re
import statistics
import subprocess
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

from ytmusicapi import YTMusic

HERE = Path(__file__).parent
# Big Buck Bunny, Blender Foundation, published on YouTube under CC BY.
RIGHTS_CLEARED_VIDEO = "aqz-KE-bpKQ"
REJECT_WORDS = ["cover", "karaoke", "tribute", "instrumental", "remix", "acoustic", "piano", "lullaby", "taylor s version", "made famous", "originally performed", "in the style of"]


def normalize(text):
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()
    return " ".join(re.sub(r"[^\w ]", " ", stripped).split())


def to_row(result):
    return {
        "title": result.get("title") or "",
        "artists": [artist["name"] for artist in result.get("artists") or []],
        "album": (result.get("album") or {}).get("name"),
        "durationS": result.get("duration_seconds"),
        "explicit": result.get("isExplicit"),
        "videoType": result.get("videoType"),
    }


def accepts(label, row):
    haystack = normalize(row["title"])
    if normalize(label["title"]) not in haystack:
        return False
    if not any(normalize(name) in normalize(artist) for artist in row["artists"] for name in label["artists"]):
        return False
    if row["durationS"] is None or abs(row["durationS"] - label["durationS"]) > 5:
        return False
    if not all(word in haystack for word in label.get("requireWords", [])):
        return False
    if label["variant"] in ("studio", "remaster", "radio-edit"):
        if any(word in haystack for word in REJECT_WORDS) or re.search(r"\blive\b", haystack):
            return False
    return True


def probe_search(labels):
    client = YTMusic()
    rows = []
    for label in labels:
        query = label.get("query") or f"{label['artists'][0]} {label['title']}"
        started = time.perf_counter()
        try:
            hits = [to_row(result) for result in client.search(query, filter="songs", limit=25)]
            error = None
        except Exception as exc:  # The probe reports every provider failure as data.
            hits, error = [], f"{type(exc).__name__}: {exc}"
        elapsed = round((time.perf_counter() - started) * 1000)
        rank = next((index + 1 for index, row in enumerate(hits) if accepts(label, row)), None)
        match = hits[rank - 1] if rank else None
        # The trap: same title and close duration, but not the labeled recording.
        traps = [row for row in hits if normalize(label["title"]) in normalize(row["title"]) and row["durationS"] is not None and abs(row["durationS"] - label["durationS"]) <= 5 and not accepts(label, row)]
        rows.append({
            "id": label["id"],
            "tier": label["tier"],
            "ms": elapsed,
            "error": error,
            "returned": len(hits),
            "rank": rank,
            "matchType": match["videoType"] if match else None,
            "matchExplicit": match["explicit"] if match else None,
            "matchHasAlbum": bool(match["album"]) if match else None,
            "sameTitleAndDurationTraps": len(traps),
        })
        time.sleep(0.5)
    return rows


def probe_browse():
    client = YTMusic()
    out = {}
    calls = {
        "charts": lambda: client.get_charts(country="US"),
        "moodCategories": lambda: client.get_mood_categories(),
        "radioFromTrack": lambda: client.get_watch_playlist(videoId="BSTsnWoslP4", radio=True, limit=10),
    }
    for name, call in calls.items():
        try:
            value = call()
            size = len(value.get("tracks") or value) if isinstance(value, dict) else len(value)
            out[name] = {"ok": True, "items": size}
        except Exception as exc:  # The probe reports every provider failure as data.
            out[name] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:200]}
        time.sleep(0.5)
    return out


def probe_resolution():
    command = [sys.executable, "-m", "yt_dlp", "--no-warnings", "--no-playlist", "--js-runtimes", "node", "-f", "bestaudio", "--print", "%(license)s|%(acodec)s|%(abr)s|%(ext)s|%(duration)s", "--print", "urls", f"https://www.youtube.com/watch?v={RIGHTS_CLEARED_VIDEO}"]
    started = time.perf_counter()
    done = subprocess.run(command, capture_output=True, text=True, timeout=120)
    elapsed = round((time.perf_counter() - started) * 1000)
    if done.returncode != 0:
        return {"resolved": False, "ms": elapsed, "stderr": done.stderr.strip()[-400:]}
    lines = done.stdout.splitlines()
    license_name, codec, bitrate, ext, duration = lines[0].split("|")
    url = lines[1]
    expiry = re.search(r"expire=(\d+)", url)
    request = urllib.request.Request(url, headers={"Range": "bytes=1000000-1000999", "User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        range_status, range_type = response.status, response.headers.get("Content-Type")
    # The URL is signed and short-lived, so only facts about it are recorded.
    return {
        "resolved": True,
        "ms": elapsed,
        "license": license_name,
        "codec": codec,
        "abrKbps": bitrate,
        "container": ext,
        "durationS": duration,
        "urlLifetimeHours": round((int(expiry.group(1)) - time.time()) / 3600, 1) if expiry else None,
        "rangeStatus": range_status,
        "rangeType": range_type,
    }


def main():
    labels = json.loads((HERE / "recordings.json").read_text(encoding="utf-8"))
    rows = probe_search(labels)
    found = [row for row in rows if row["rank"]]
    report = {
        "ranAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "summary": {
            "total": len(rows),
            "foundInResults": len(found),
            "top1": sum(row["rank"] == 1 for row in found),
            "top5": sum(row["rank"] <= 5 for row in found),
            "officialAudioTracks": sum(row["matchType"] == "MUSIC_VIDEO_TYPE_ATV" for row in found),
            "explicitFlagged": sum(bool(row["matchExplicit"]) for row in found),
            "labelsWithTraps": sum(row["sameTitleAndDurationTraps"] > 0 for row in rows),
            "medianMs": statistics.median(row["ms"] for row in rows),
            "maxMs": max(row["ms"] for row in rows),
            "errors": sum(row["error"] is not None for row in rows),
        },
        "browse": probe_browse(),
        "resolution": probe_resolution(),
        "search": rows,
    }
    results = HERE / "results"
    results.mkdir(exist_ok=True)
    (results / "youtube.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"summary": report["summary"], "browse": report["browse"], "resolution": report["resolution"]}, indent=2))


if __name__ == "__main__":
    main()
