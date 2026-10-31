"""Temporary P2 adapter until P4 supplies accepted SourceCandidates.

One JSON request on stdin; one JSON result on stdout. No signed URL is logged.
"""

import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import truststore

truststore.inject_into_ssl()

from ytmusicapi import YTMusic
from match import choose_video


def find_video(request):
    hits = YTMusic().search(f"{request['artist']} {request['title']}", filter="songs", limit=20)
    return choose_video(request, hits)


def wait_until_servable(url, timeout=10):
    # Freshly signed googlevideo URLs answer 403 for a second or two. The renderer's
    # audio element gives up on the first 403, so only hand over a URL that serves bytes.
    deadline = time.monotonic() + timeout
    while True:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"Range": "bytes=0-0"}), timeout=5):
                return
        except urllib.error.HTTPError as error:
            if error.code != 403 or time.monotonic() >= deadline:
                raise ValueError(f"Stream not servable (HTTP {error.code})") from None
        time.sleep(0.5)


def resolve(video_id):
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    result = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("yt_dlp_entry.py")), "--no-warnings", "--no-playlist", "--js-runtimes", "node", "-f", "bestaudio[ext=m4a]/bestaudio", "--dump-single-json", video_url],
        capture_output=True, text=True, timeout=90, check=False,
    )
    if result.returncode:
        raise ValueError("Stream resolution failed: " + result.stderr.strip()[-300:])
    data = json.loads(result.stdout)
    url = data.get("url")
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ValueError("Provider returned no playable URL")
    wait_until_servable(url)
    expiry = re.search(r"[?&]expire=(\d+)", url)
    mime = {"m4a": "audio/mp4", "webm": "audio/webm", "mp3": "audio/mpeg"}.get(data.get("ext"), "application/octet-stream")
    return {"uri": url, "mimeType": mime, "expiresAt": int(expiry.group(1)) * 1000 if expiry else int(time.time() * 1000) + 300000, "seekable": True, "local": False, "videoId": video_id}


def main():
    request = json.loads(sys.stdin.readline())
    # The catalog already chose this video; re-searching would rematch on metadata that
    # music videos and lyric uploads rarely satisfy.
    known = request.get("videoId")
    video_id = known if isinstance(known, str) and re.fullmatch(r"[A-Za-z0-9_-]{11}", known) else find_video(request)
    result = resolve(video_id) if request["type"] == "resolve" else {"videoId": video_id}
    print(json.dumps({"ok": True, "value": result}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)[:400]}), flush=True)
        sys.exit(1)
