# M0 provider probes

Live checks behind [docs/16-provider-spike.md](../../docs/16-provider-spike.md). They call real services, so they stay out of CI. A failure here is a provider failure, not an app bug.

```sh
node spikes/m0-providers/probe_catalog.mjs

python -m venv .venv
.venv/Scripts/python -m pip install -r spikes/m0-providers/requirements.txt
.venv/Scripts/python spikes/m0-providers/probe_youtube.py
```

Each script overwrites a file in `results/`. Those files are committed, so they must hold measurements only: no lyrics, no third-party titles and no signed URLs.

`recordings.json` is the labeled set. Song names and durations are facts about the recordings; no audio or lyrics are included.

The YouTube probe uses an unofficial client. See the exception in the spike report before relying on it. It reads search metadata only, plus 1 KiB from one Creative Commons video, and uses no cookies, accounts or bot-check workarounds.
