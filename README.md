# Play-Pal

Play along with a track while the app switches your Neural DSP presets for you.

1. Add a track: **+ Local file**, or paste a YouTube Music link (sign in once in the embedded page; the session is remembered).
2. Play it and press **M** (or "Add cue here") where a preset should change. Set the MIDI CC/Note each cue sends. **Test** sends it now.
3. Next time, open the track from the list and hit Play. Cues fire on their own, also after seeking or looping.

The app opens a virtual MIDI port named **Play-Pal**. In your DAW or standalone plugin, enable it as a MIDI input next to the midi-controller's port.

Tips: "Fire cues N ms early" covers preset load time. Put cues in gaps between phrases; some presets glitch while loading. Slowing a track down keeps cues aligned to track time.

Keys: **Space** play/pause, **M** add cue (when no field is focused).

Data lives in `~/Library/Application Support/play-pal/library.json` (local file tracks store their path, so moving the file breaks that track).

## Install as an app

```bash
tools/install.sh --open     # builds, ad-hoc signs, copies Play-Pal.app to /Applications, opens it
```

Apple Silicon only. Re-run it after code changes to update the installed copy. The icon lives in `build/` (regenerate with `python3 tools/make-icon.py`). The installed app and the dev version share one data folder and a single-instance lock, so quit one before starting the other.

Development: see `CLAUDE.md`.
