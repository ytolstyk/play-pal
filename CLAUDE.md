# CLAUDE.md

Play Pal: an Electron app that plays a track (local file or YouTube Music) and fires MIDI cues at saved timestamps, so Neural DSP presets switch while you play along. Sibling of `../midi-controller` (keyboard-to-MIDI); the two are separate apps with separate virtual ports ("Play Pal" here), and the plugin/DAW listens to both.

## Commands

Run binaries directly; the RTK hook mangles `npm run` and `npx` in this environment.

```bash
./node_modules/.bin/electron-vite dev        # dev
./node_modules/.bin/electron-vite build && ./node_modules/.bin/electron .   # built app
./node_modules/.bin/tsc --noEmit -p tsconfig.node.json   # main/preload/shared
./node_modules/.bin/tsc --noEmit -p tsconfig.web.json    # renderer
./node_modules/.bin/vitest run
```

Install with `npm_config_arch=arm64 npm install`; if `node_modules/electron/dist` is missing run `node node_modules/electron/install.js`.

`tools/install.sh [--open]` builds, ad-hoc signs and copies the app to `/Applications` (Apple Silicon only). The installed app and dev share one userData folder and a single-instance lock. `tools/make-icon.py` regenerates `build/icon.*`.

User data (`~/Library/Application Support/play-pal/`): `library.json` (+ `.bak`), `backups/`, `waveforms/`.

## Architecture

- `src/shared/`: pure, imported by main, preload and renderer.
  - `types.ts` (data model, limits), `ipc.ts` (channel names), `api.ts` (the `window.api` contract), `validation.ts`/`payloads.ts` (IPC and library checks), `libraryImport.ts` (reads a library file of any age, repairing or dropping what it can and reporting `warnings`), `midi-encode.ts`, `url.ts`, `time.ts`, `guards.ts`.
  - `waveform.ts`: the recorded waveform format (25 bins/s, 4 frequency bands, `PPW` header with a format number: bump it whenever bands, edges or the level scale change) and `WaveRecorder`. `waveDisplay.ts` turns a recording into drawable bytes (stretch, expansion, band views).
  - `audio.ts` (analyser constants, frame shape), `audioOutput.ts` (output-device listing/matching by name), `ytAdvance.ts` (tells a queue auto-advance from the user browsing away).
- `src/main/`:
  - `cueRunner.ts`: pure scheduler. Takes position samples, extrapolates between them, fires cues. A jump (seek/loop) fires only the cue active at the new position, never the skipped ones; the same cue is not re-fired by a seek deeper into its section, but is when the seek lands just past it.
  - `index.ts`: wiring, IPC (every handler checks the sender and validates payloads), the `ppfile://t/<track id>` protocol (serves only library tracks of kind `file`), serialized library saves.
  - `ytPlayer.ts`: music.youtube.com in a `WebContentsView` with persistent partition `persist:ytmusic`, navigation allowlist, Electron stripped from the UA (Google rejects it at sign-in). `preload/yt.ts` reports the page's `<video>` position (40 ms) and applies commands.
  - `midi.ts`/`actionSender.ts`: virtual CoreMIDI port; notes get an automatic Note Off after 100 ms.
  - `store.ts`: `library.json` in userData, atomic write plus `.bak`.
  - `backups.ts`: `BackupStore`, dated copies of `library.json` in `userData/backups` (kinds `auto`, `startup`, `before-restore`, `incompatible`, `corrupt`, each with its own retention quota). A file that fails to load is copied there before anything can overwrite it. Restore and "import a library file" go through `adoptLibrary` in `index.ts`, which backs up the current library first.
  - `waveformStore.ts`: one `.wave` file per track in `userData/waveforms` (a display cache; unreadable or old-format reads as "not recorded"). Pruned against the library on a clean load.
- `src/preload/`: `index.ts` exposes `window.api`; `yt.ts` runs inside the YouTube Music page.
- `src/renderer/src/`: React UI. Local files play in an `<audio>` element and report their clock to main; YouTube Music's clock is pushed from main. Main runs the cues for both.
  - `hooks/usePlayback` (transport and clocks; the clock is read through a subscribable `Clock`, not React state), `useLibrary` (load/save/replace), `useAudioFeed` (spectrum/waveform frames: a Web Audio tap on the `<audio>` element, or frames pushed from the YT page), `useWaveform` (load, record while playing, save), `useAudioOutput`, `useLimiter`, `useSkip`/`useStepper` (debounced arrow-key seeks and volume steps), timeline hooks (`useTimelineView`, `useTimelineGestures`, `useCueDrag`, `useScrub`).
  - `components/`: `Player` (owns hotkeys and the video/visualizer/none panel), `Timeline` + `WaveCanvas` + `TimelineOverview` + `TimelineToolbar` (zoomable waveform with cue markers), `CueList`, `StartPresetEditor`, `Sidebar`, `SettingsPanel` (theme, output device, limiter, `BackupsSection`).
  - `visualizers/`: `draw.ts` registry (bars, scope, radial, sparks), `scene.ts` (shared animation state), `sparks.ts`.
  - `windowActivity.ts`: whether the window is in front, pushed from main. Everything that only animates idles while it is false.
  - UI preferences (theme, view mode, visualizer, output, limiter, waveform view, video height) live in `localStorage` via `storage.ts`; music data lives in main's files.
- `tests/`: vitest, for the pure modules (cue runner, validation/import, backups, waveform, clock tracker, timeline view, YT advance, payloads, audio output) plus `preloadChannels.test.ts`, which guards the duplicated `YT_PAGE` literals.

## Invariants

- Main owns what plays and fires. The renderer must `await` an immediate save before selecting a newly added track (main resolves tracks from its saved copy).
- The two preload bundles must not share runtime imports (sandboxed preloads can't require chunks); `YT_PAGE` channel names are duplicated as literals in `preload/yt.ts`.
- `backgroundThrottling: false` on the window and YT view: cues must keep timing when the app is behind a DAW.
- A track's optional start preset is sent by main (`player:start-preset`), which resolves after its wait; the renderer starts playback only then, and only when playing from the start (first second, or a finished track); it also resets the runner's loaded-preset memory (`presetReplaced`).
- Output device: the renderer owns the choice (remembered by device name); local audio follows it via `setSinkId` on the `<audio>` element and, once the visualizer captures it, on that `AudioContext`. YouTube Music gets the name (`output` command) and finds its own id, since ids differ per session. The YT session's permission *request* handler must stay deny-all; its *check* handler only answers audio-device-name and speaker-selection checks for music.youtube.com while a device is chosen.
- Idle when not in front: with throttling off, `document.hidden` never flips behind a DAW and `document.hasFocus()` drops when the YT view takes page focus, so "in front" comes from the native window (`getWindowActive`/`onWindowActive`). Animation loops, canvas redraws and CSS pulses (`data-playing` on the root) must check it, and the YT page's analyser frames only stream while the visualizer or waveform recorder wants them.
- The waveform is recorded from the live audio feed as a track plays (volume divided back out), saved beside the library rather than in it, and never needed for cues to fire. `wave.duration` falls back to the saved recording's length until the player reports one, so seeks wait for a real duration.
- Library writes never depend on backups: a failed backup must not stop a save. Importing or restoring replaces the whole library through main (`adoptLibrary`) and returns it, so the renderer needs no reload.
- When the YT page leaves the armed track by itself (`isAutoAdvance`), main takes the track back and tells the renderer (`onYtAdvanced`); the user browsing away is left alone until `ytReturn`.
- Cues store raw MIDI (type/channel/number/value), not references to midi-controller bindings.
