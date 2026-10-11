# CLAUDE.md

Play-Pal: an Electron app that plays a track (local file or YouTube Music) and fires MIDI cues at saved timestamps, so Neural DSP presets switch while you play along. Sibling of `../midi-controller` (keyboard-to-MIDI); the two are separate apps with separate virtual ports ("Play-Pal" here), and the plugin/DAW listens to both.

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

## Architecture

- `src/shared/`: types, IPC channel names, `api.ts` (the `window.api` contract), validation, MIDI encoding, URL/time helpers. Pure.
- `src/main/`:
  - `cueRunner.ts`: pure scheduler. Takes position samples, extrapolates between them, fires cues. A jump (seek/loop) fires only the cue active at the new position, never the skipped ones; the same cue is never fired twice in a row.
  - `index.ts`: wiring, IPC (every handler checks the sender and validates payloads), the `ppfile://t/<track id>` protocol (serves only library tracks of kind `file`), serialized library saves.
  - `ytPlayer.ts`: music.youtube.com in a `WebContentsView` with persistent partition `persist:ytmusic`, navigation allowlist, Electron stripped from the UA (Google rejects it at sign-in). `preload/yt.ts` reports the page's `<video>` position (40 ms) and applies commands.
  - `midi.ts`/`actionSender.ts`: virtual CoreMIDI port; notes get an automatic Note Off after 100 ms.
  - `store.ts`: `library.json` in userData, atomic write plus `.bak`.
- `src/renderer/src/`: React UI. Local files play in an `<audio>` element and report their clock to main; YouTube Music's clock is pushed from main. Main runs the cues for both.

## Invariants

- Main owns what plays and fires. The renderer must `await` an immediate save before selecting a newly added track (main resolves tracks from its saved copy).
- The two preload bundles must not share runtime imports (sandboxed preloads can't require chunks); `YT_PAGE` channel names are duplicated as literals in `preload/yt.ts`.
- `backgroundThrottling: false` on the window and YT view: cues must keep timing when the app is behind a DAW.
- Cues store raw MIDI (type/channel/number/value), not references to midi-controller bindings.
