"""Run the pinned yt-dlp CLI with the operating system's trusted CA store."""

import truststore

truststore.inject_into_ssl()

from yt_dlp import main  # noqa: E402

if __name__ == "__main__":
    main()
