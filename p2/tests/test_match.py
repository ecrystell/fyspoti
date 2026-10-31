import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
from match import choose_video


class MatchTests(unittest.TestCase):
    def test_rejects_live_cover_and_wrong_artist(self):
        request = {"title": "Example Song", "artist": "Example Artist", "durationMs": 200000}
        hits = [
            {"videoId": "aaaaaaaaaaa", "title": "Example Song Live", "artists": [{"name": "Example Artist"}], "duration_seconds": 200},
            {"videoId": "bbbbbbbbbbb", "title": "Example Song", "artists": [{"name": "Example Artist Tribute"}], "duration_seconds": 200},
            {"videoId": "ccccccccccc", "title": "Example Song Official Audio", "artists": [{"name": "Example Artist"}], "duration_seconds": 200},
        ]
        self.assertEqual(choose_video(request, hits), "ccccccccccc")

    def test_no_confident_match(self):
        with self.assertRaisesRegex(ValueError, "NO_MATCH"):
            choose_video({"title": "Example Song", "artist": "Example Artist", "durationMs": 200000}, [
                {"videoId": "aaaaaaaaaaa", "title": "Example Song", "artists": [{"name": "Other"}], "duration_seconds": 200},
            ])


if __name__ == "__main__":
    unittest.main()
