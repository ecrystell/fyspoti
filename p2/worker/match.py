"""Conservative temporary match until P4 supplies accepted candidates."""

import re
import unicodedata


def normalized(value):
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join(re.sub(r"[^\w ]", " ", text.lower()).split())


def choose_video(request, hits):
    title = normalized(request["title"])
    artist = normalized(request["artist"].split(",")[0])
    duration = request["durationMs"] / 1000
    if not title or not artist or duration <= 0:
        raise ValueError("Track metadata is incomplete")
    allowed_extra = {"official", "audio"}
    for hit in hits:
        video_id = hit.get("videoId")
        hit_title = normalized(hit.get("title"))
        hit_artists = [normalized(value.get("name")) for value in hit.get("artists") or []]
        hit_duration = hit.get("duration_seconds")
        if not video_id or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            continue
        if not hit_title.startswith(title) or not any(name == artist for name in hit_artists):
            continue
        if not isinstance(hit_duration, (int, float)) or abs(hit_duration - duration) > 5:
            continue
        if set(hit_title.split()) - set(title.split()) - allowed_extra:
            continue
        return video_id
    raise ValueError("NO_MATCH: No confident recording match")
