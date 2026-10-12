import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ActionSender } from './actionSender'
import { CueRunner } from './cueRunner'
import { VirtualPort } from './midi'
import { LibraryStore } from './store'
import { YtPlayer } from './ytPlayer'
import { IPC, YT_PAGE } from '../shared/ipc'
import { clampInt } from '../shared/guards'
import { AUDIO_FRAME_MS, readAudioFrame } from '../shared/audio'
import { readClock, readRect, readYtCommand, readYtPageClock } from '../shared/payloads'
import {
  AUDIO_EXTENSIONS,
  MAX_LEAD_MS,
  type Cue,
  type Library,
  type LoadResult,
  type MidiAction,
  type MidiStatus,
  type SaveResult,
  type Track
} from '../shared/types'
import { emptyLibrary, sanitizeLibrary, validateAction, validateLibrary, validateTrack } from '../shared/validation'

const WINDOW = { width: 1280, height: 860, minWidth: 980, minHeight: 640, background: '#121316' }
const UNTRUSTED = 'untrusted sender'
const TICK_MS = 10
const OFF_RETRY_MS = 250
const PLAYBACK_PUSH_MS = 100
/** A sample older than this was queued behind something slow; don't trust its age beyond it. */
const MAX_SAMPLE_AGE_MS = 250
/** Frames from the page arrive every ~33 ms; anything faster is not from our preload. */
const MIN_AUDIO_PUSH_MS = AUDIO_FRAME_MS / 2
const FILE_SCHEME = 'ppfile'
const YT_ORIGIN = 'https://music.youtube.com'

protocol.registerSchemesAsPrivileged([
  { scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let win: BrowserWindow | null = null
/** What was last saved. Used to serve media and to persist; not what fires cues (see `armed`). */
let library: Library = emptyLibrary()
/** The open track exactly as the renderer shows it, so firing never waits on or depends on a save. */
let armed: Track | null = null
let keepAwakeId: number | null = null

const port = new VirtualPort(() => pushMidiStatus())
const sender = new ActionSender(port)
const runner = new CueRunner((cue: Cue) => {
  const sent = sender.send(cue.action)
  if (sent) pushToWindow(IPC.cueFired, cue.id)
  return sent
})
const yt = new YtPlayer(() => win)
// Same data folder whether run from source or installed (the installed app's name is "Play Pal").
app.setPath('userData', join(app.getPath('appData'), 'play-pal'))
const store = new LibraryStore(join(app.getPath('userData'), 'library.json'))

function pushToWindow(channel: string, payload: unknown): void {
  // The window can be gone mid-quit; pushes must never throw.
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}
const midiStatus = (): MidiStatus => ({ state: port.state(), name: port.name() })
const pushMidiStatus = (): void => {
  if (port.state() === 'open') sender.retryOffs()
  pushToWindow(IPC.midiStatus, midiStatus())
}

function createWindow(): void {
  win = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    title: 'Play Pal',
    backgroundColor: WINDOW.background,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // The window is usually behind a DAW or the plugin while playing; timers must keep their pace.
      backgroundThrottling: false
    }
  })
  win.on('closed', () => {
    win = null
    disarm()
    yt.destroy()
  })
  // A dead renderer can't report its clock; stop extrapolating at once instead of waiting for the watchdog.
  // A reloaded renderer has no visualizer yet; stop the page's frame stream until it asks again.
  win.webContents.on('did-start-loading', () => yt.command({ cmd: 'analyse', value: 0 }))
  win.webContents.on('render-process-gone', () => {
    runner.halt()
    yt.command({ cmd: 'analyse', value: 0 }) // its visualizer is gone, so nothing wants frames
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Serves `ppfile://t/<track id>` for local-file tracks only; the renderer can't name arbitrary paths. */
function registerFileProtocol(): void {
  protocol.handle(FILE_SCHEME, async (request) => {
    let id: string
    try {
      id = decodeURIComponent(new URL(request.url).pathname.slice(1))
    } catch {
      return new Response('bad request', { status: 400 })
    }
    const track = armed?.id === id ? armed : library.tracks.find((t) => t.id === id)
    if (!track || track.source.kind !== 'file') return new Response('not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(track.source.path).toString(), {
      headers: request.headers,
      bypassCustomProtocolHandlers: true
    })
    // The visualizer analyses the <audio> element; a cross-origin source with no CORS grant would read as silence.
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  })
}

/** Only our own window may drive playback, MIDI or the library. */
const trusted = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => win !== null && e.sender === win.webContents

const originOf = (url: string | undefined): string | null => {
  try {
    return url ? new URL(url).origin : null
  } catch {
    return null
  }
}

let lastPlaybackPush = { at: 0, playing: false, rate: 1 }
function onYtClock(e: IpcMainEvent, raw: unknown): void {
  const contents = yt.contents()
  if (!contents || e.sender !== contents || !armed || armed.source.kind !== 'ytmusic') return
  // The page is third-party content: only the real site, and only the video we opened, may drive cues.
  if (originOf(e.senderFrame?.url) !== YT_ORIGIN) return
  const clock = readYtPageClock(raw)
  if (!clock) return
  if (clock.videoId !== armed.source.videoId) {
    runner.halt() // YouTube Music auto-advanced; this track's cues must not run against another song
    return
  }
  const now = performance.now()
  const age = Math.min(MAX_SAMPLE_AGE_MS, Math.max(0, Date.now() - clock.sentAt))
  const state = { t: clock.t, duration: clock.duration, playing: clock.playing, rate: clock.rate }
  runner.sample({ trackId: armed.id, ...state }, now - age)
  const changed = state.playing !== lastPlaybackPush.playing || state.rate !== lastPlaybackPush.rate
  if (changed || now - lastPlaybackPush.at >= PLAYBACK_PUSH_MS) {
    lastPlaybackPush = { at: now, playing: state.playing, rate: state.rate }
    pushToWindow(IPC.playback, state)
  }
}

let lastAudioPush = 0
/** Spectrum frames from the YouTube Music page, relayed to the visualizer. */
function onYtAudio(e: IpcMainEvent, raw: unknown): void {
  const contents = yt.contents()
  if (!yt.isAnalysing() || !contents || e.sender !== contents) return
  const now = performance.now()
  if (now - lastAudioPush < MIN_AUDIO_PUSH_MS) return
  if (originOf(e.senderFrame?.url) !== YT_ORIGIN) return
  lastAudioPush = now
  const frame = readAudioFrame(raw)
  if (frame) pushToWindow(IPC.audioFrame, frame)
}

function setKeepAwake(on: boolean): void {
  if (on && keepAwakeId === null) keepAwakeId = powerSaveBlocker.start('prevent-app-suspension')
  else if (!on && keepAwakeId !== null) {
    powerSaveBlocker.stop(keepAwakeId)
    keepAwakeId = null
  }
}

function disarm(): void {
  armed = null
  runner.select(null, [])
  yt.unload()
  setKeepAwake(false)
}

/** An edit that fails validation leaves the previous good state armed rather than silencing the track. */
function armTrack(raw: unknown): void {
  if (raw === null || raw === undefined) return disarm()
  if (validateTrack(raw).length > 0) {
    if (armed?.id !== (raw as { id?: unknown }).id) disarm()
    return
  }
  const track = sanitizeLibrary({ tracks: [raw as Track], leadMs: 0 }).tracks[0]
  const sameSource = armed?.id === track.id && JSON.stringify(armed.source) === JSON.stringify(track.source)
  armed = track
  if (sameSource) {
    runner.setCues(track.cues, track.start?.action ?? null)
    return
  }
  runner.select(track.id, track.cues, track.start?.action ?? null)
  if (track.source.kind === 'ytmusic') yt.load(track.source.videoId, track.start !== undefined)
  else yt.unload()
  setKeepAwake(true)
}

async function saveLibrary(raw: unknown): Promise<SaveResult> {
  const errors = validateLibrary(raw)
  if (errors.length > 0) return { ok: false, errors }
  const next = sanitizeLibrary(raw as Library)
  try {
    await store.save(next)
  } catch (err) {
    return { ok: false, errors: [`could not save: ${err instanceof Error ? err.message : String(err)}`] }
  }
  library = next
  return { ok: true, errors: [] }
}

/** Saves run one at a time so a slow write can't overwrite a newer one. */
let saveChain: Promise<unknown> = Promise.resolve()
const saveInOrder = (raw: unknown): Promise<SaveResult> => {
  const run = saveChain.then(() => saveLibrary(raw))
  saveChain = run.catch(() => undefined)
  return run
}

async function loadLibrary(): Promise<LoadResult> {
  const result = await store.load()
  library = { tracks: result.tracks, leadMs: result.leadMs }
  runner.setLeadMs(library.leadMs)
  return result
}

function registerIpc(): void {
  ipcMain.handle(IPC.libraryLoad, (e) => (trusted(e) ? loadLibrary() : { ...emptyLibrary(), warnings: [UNTRUSTED] }))
  ipcMain.handle(IPC.librarySave, (e, raw: unknown) =>
    trusted(e) ? saveInOrder(raw) : { ok: false, errors: [UNTRUSTED] }
  )
  ipcMain.handle(IPC.pickAudio, async (e): Promise<string | null> => {
    if (!trusted(e) || !win) return null
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: AUDIO_EXTENSIONS }]
    })
    return canceled ? null : (filePaths[0] ?? null)
  })
  ipcMain.on(IPC.arm, (e, raw: unknown) => trusted(e) && armTrack(raw))
  ipcMain.handle(IPC.startPreset, async (e, trackId: unknown): Promise<boolean> => {
    const start = trusted(e) && armed !== null && armed.id === trackId ? armed.start : undefined
    if (!start || !sender.send(start.action)) return false
    runner.presetReplaced()
    await new Promise((resolve) => setTimeout(resolve, start.waitMs))
    return armed?.id === trackId // the track may have been switched during the wait
  })
  ipcMain.on(IPC.lead, (e, ms: unknown) => {
    if (trusted(e) && typeof ms === 'number') runner.setLeadMs(clampInt(ms, 0, MAX_LEAD_MS))
  })
  ipcMain.on(IPC.fileClock, (e, raw: unknown) => {
    const clock = readClock(raw)
    if (trusted(e) && clock) runner.sample(clock, performance.now())
  })
  ipcMain.on(YT_PAGE.clock, onYtClock)
  ipcMain.on(YT_PAGE.audio, onYtAudio)
  ipcMain.on(IPC.ytBounds, (e, raw: unknown) => trusted(e) && yt.setBounds(readRect(raw)))
  ipcMain.on(IPC.ytCommand, (e, raw: unknown) => {
    const command = readYtCommand(raw)
    if (trusted(e) && command) yt.command(command)
  })
  ipcMain.on(IPC.ytReturn, (e) => trusted(e) && yt.returnToTrack())
  ipcMain.handle(IPC.midiTest, (e, raw: unknown) => {
    if (trusted(e) && validateAction(raw).length === 0) sender.send(raw as MidiAction)
  })
  ipcMain.handle(IPC.midiStatus, (e) => (trusted(e) ? midiStatus() : null))
  ipcMain.handle(IPC.midiReconnect, async (e) => {
    if (trusted(e)) await port.reconnect()
  })
}

function main(): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => win?.focus())
  app.on('window-all-closed', () => app.quit())
  app.on('activate', () => {
    if (!win) createWindow()
  })
  app.on('before-quit', () => {
    sender.flush()
    port.close()
  })

  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, deny) => deny(false))
    registerFileProtocol()
    registerIpc()
    void port.reconnect()
    createWindow()
    setInterval(() => runner.tick(performance.now()), TICK_MS)
    setInterval(() => sender.retryOffs(), OFF_RETRY_MS)
    powerMonitor.on('resume', () => void port.reconnect())
  })
}

main()
