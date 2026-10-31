"""Versioned, one-job-at-a-time download worker. stdout is JSON protocol only."""

import json
import mimetypes
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import wave

PROTOCOL = 1


def send(message):
    print(json.dumps(message, separators=(",", ":")), flush=True)


def fail(message):
    send({"type": "error", "message": str(message)})


def verify(file_path, ffprobe):
    if not file_path.is_file() or file_path.stat().st_size == 0:
        raise ValueError("Empty download")
    if file_path.suffix.lower() == ".wav":
        with wave.open(str(file_path), "rb") as audio:
            if audio.getnframes() <= 0:
                raise ValueError("Empty WAV audio")
        return
    result = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1", str(file_path)],
        capture_output=True, text=True, timeout=30, check=False,
    )
    if result.returncode or "codec_name=" not in result.stdout:
        raise ValueError("Output has no decodable audio stream")


def direct(request, work_dir):
    url = request["url"]
    if not url.startswith(("https://", "http://")):
        raise ValueError("Unsupported download URL")
    source = urllib.request.Request(url, headers={"User-Agent": "fyspoti-p2/1"})
    with urllib.request.urlopen(source, timeout=30) as response:
        content_type = response.headers.get_content_type()
        if not content_type.startswith("audio/") and content_type != "application/octet-stream":
            raise ValueError("Source did not return audio")
        total = int(response.headers.get("Content-Length", "0"))
        suffix = mimetypes.guess_extension(content_type) or ".audio"
        if suffix == ".jpe":
            suffix = ".jpg"
        output = work_dir / ("download" + suffix)
        done = 0
        with output.open("wb") as stream:
            while True:
                chunk = response.read(256 * 1024)
                if not chunk:
                    break
                stream.write(chunk)
                done += len(chunk)
                if done > request.get("maxBytes", 2 * 1024 * 1024 * 1024):
                    raise ValueError("Download exceeds storage limit")
                send({"type": "progress", "stage": "transferring", "bytesDone": done, "bytesTotal": total or None})
        if total and done != total:
            raise ValueError("Incomplete download")
    return output


def spotdl(request, work_dir):
    url = request["url"]
    audio_url = request.get("matchedAudioUrl", "")
    if not url.startswith("https://open.spotify.com/track/"):
        raise ValueError("spotDL requires an explicit Spotify track URL")
    if not audio_url.startswith(("https://www.youtube.com/watch?v=", "https://youtu.be/")):
        raise ValueError("spotDL requires an approved YouTube candidate URL")
    executable = request.get("spotdlExecutable")
    ffmpeg = request.get("ffmpegExecutable")
    if not executable or not ffmpeg:
        raise ValueError("Packaged spotDL and FFmpeg paths are required")
    send({"type": "progress", "stage": "processing", "bytesDone": 0})
    result = subprocess.run(
        [executable, "download", audio_url + "|" + url, "--ffmpeg", ffmpeg, "--output", str(work_dir / "download.{output-ext}")],
        cwd=work_dir, capture_output=True, text=True, timeout=900, check=False,
    )
    if result.returncode:
        raise ValueError((result.stderr or result.stdout)[-1000:] or "spotDL failed")
    files = [p for p in work_dir.iterdir() if p.is_file() and p.name.startswith("download.")]
    if len(files) != 1:
        raise ValueError("spotDL did not create exactly one audio file")
    return files[0]


def main():
    send({"type": "hello", "protocol": PROTOCOL, "capabilities": ["direct", "spotdl"]})
    line = sys.stdin.readline()
    if not line:
        return
    request = json.loads(line)
    if request.get("protocol") != PROTOCOL or request.get("type") != "download":
        raise ValueError("Unsupported worker request")
    work_dir = Path(request["workDir"]).resolve()
    if work_dir.exists():
        raise ValueError("Job directory already exists")
    work_dir.mkdir(parents=True)
    try:
        kind = request["sourceKind"]
        output = direct(request, work_dir) if kind == "direct" else spotdl(request, work_dir) if kind == "spotdl" else None
        if output is None:
            raise ValueError("Unsupported download source")
        send({"type": "progress", "stage": "verifying", "bytesDone": output.stat().st_size})
        verify(output, request["ffprobeExecutable"])
        send({"type": "complete", "fileName": output.name, "bytes": output.stat().st_size, "mimeType": mimetypes.guess_type(output.name)[0] or "application/octet-stream"})
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        fail(exc)
        sys.exit(1)
