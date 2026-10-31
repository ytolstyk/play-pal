import { WebContentsView, session, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { YT_PAGE } from '../shared/ipc'
import { originOf, watchUrl, YT_ORIGIN } from '../shared/url'
import type { Rect, YtCommand } from '../shared/types'

const PARTITION = 'persist:ytmusic'
/** Sign-in (2-factor, challenges) and playback hop across Google's and YouTube's own hosts. */
const ALLOWED_SUFFIXES = ['.google.com', '.youtube.com']
/** Google hosts that serve other people's content; never loaded in this view. */
const REFUSED_HOSTS = new Set([
  'sites.google.com',
  'docs.google.com',
  'drive.google.com',
  'script.google.com',
  'script.googleusercontent.com',
  'groups.google.com',
  'forms.google.com'
])
/** A reclaim that has not committed by now is given up, so Play is not dropped for good by a stalled load. */
const RECLAIM_TIMEOUT_MS = 10_000
const HIDDEN: Rect = { x: 0, y: 0, width: 0, height: 0 }

const isAllowedUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw)
    if (raw === 'about:blank') return true
    if (u.protocol !== 'https:' || REFUSED_HOSTS.has(u.hostname)) return false
    return ALLOWED_SUFFIXES.some((s) => u.hostname.endsWith(s) || u.hostname === s.slice(1))
  } catch {
    return false
  }
}

/**
 * music.youtube.com in its own view with a persistent session, so the user's Premium login
 * survives restarts. A preload reports the page's <video> position; we only send it commands.
 */
export class YtPlayer {
  private view: WebContentsView | null = null
  private bounds: Rect | null = null
  private videoId: string | null = null
  private analysing = false
  private limiting = false
  /** Label of the output device the page should play on; '' is the system default. */
  private outputLabel = ''
  /** The page must not start playing by itself (the track's start preset goes out first); cleared by the first play command. */
  private holding = false
  /** A reload of the track's page is under way after the page left it; repeat reclaim() calls are no-ops until the new document commits (or the load fails). */
  private reclaiming = false
  private reclaimTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly window: () => BrowserWindow | null) {}

  /** The view's webContents, to recognise clock messages from it. */
  contents(): Electron.WebContents | null {
    return this.view?.webContents ?? null
  }

  load(videoId: string, hold = false): void {
    if (this.videoId === videoId) return
    const view = this.ensureView()
    if (!view) return
    this.holding = hold
    this.videoId = videoId
    this.applyBounds()
    this.navigate(view, videoId)
  }

  private isTrackPage(url: string): boolean {
    try {
      const u = new URL(url)
      return u.pathname === '/watch' && u.searchParams.get('v') === this.videoId
    } catch {
      return false
    }
  }

  /** Back to the track's own page after the user navigated elsewhere inside the view. */
  returnToTrack(): void {
    if (!this.videoId || !this.view) return
    this.holding = false // the user is steering the view now; don't pause what they play
    // Already on the track's page: reloading would interrupt playback for nothing.
    if (this.isTrackPage(this.view.webContents.getURL())) return
    this.navigate(this.view, this.videoId)
  }

  /**
   * The page moved on to another video by itself (queue auto-advance). Loads the track's own page again, paused at
   * the start, so Restart and Play act on the right video. A no-op while that reload is already under way.
   */
  reclaim(): void {
    if (!this.videoId || !this.view || this.reclaiming) return
    this.reclaiming = true
    this.reclaimTimer = setTimeout(() => this.endReclaim(), RECLAIM_TIMEOUT_MS)
    this.holding = true
    // The old document keeps playing the other song until the reload commits.
    this.view.webContents.send(YT_PAGE.command, { cmd: 'hold', value: 1 })
    this.navigate(this.view, this.videoId)
  }

  private endReclaim(): void {
    clearTimeout(this.reclaimTimer)
    this.reclaiming = false
  }

  private navigate(view: WebContentsView, videoId: string): void {
    // A navigation superseded by another one rejects; that's expected, not an error.
    void view.webContents.loadURL(watchUrl(videoId)).catch(() => undefined)
  }

  /** Stops the audio (a hidden page keeps playing) and hides the view. */
  unload(): void {
    this.videoId = null
    this.holding = false
    this.endReclaim()
    if (!this.view) return
    void this.view.webContents.loadURL('about:blank').catch(() => undefined)
    this.applyBounds()
  }

  setBounds(rect: Rect | null): void {
    this.bounds = rect
    this.applyBounds()
  }

  command(command: YtCommand): void {
    if (command.cmd === 'analyse') this.analysing = command.value === 1
    if (command.cmd === 'limiter') this.limiting = command.value === 1
    if (command.cmd === 'output') this.outputLabel = command.value
    // The old document still holds the other song until the reload commits; playing it would start that song again.
    if (command.cmd === 'play' && this.reclaiming) return
    if (command.cmd === 'play' && this.holding) {
      this.holding = false
      this.view?.webContents.send(YT_PAGE.command, { cmd: 'hold', value: 0 })
    }
    this.view?.webContents.send(YT_PAGE.command, command)
  }

  /**
   * While a device is chosen the page may list audio device names and route to one (Chromium asks 'media' for the
   * names, 'speaker-selection' for the routing). This is a *check* only: the request handler stays deny-all, so
   * nothing can be captured, and camera labels are never offered.
   */
  private allowsOutputProbe(permission: string, origin: string, details: { mediaType?: string; isMainFrame?: boolean }): boolean {
    if (this.outputLabel === '' || originOf(origin) !== YT_ORIGIN) return false
    if (permission === 'speaker-selection') return true
    return permission === 'media' && details.mediaType === 'audio' && details.isMainFrame === true
  }

  /** Whether the visualizer wants frames; main owns this so it survives page loads. */
  isAnalysing(): boolean {
    return this.analysing
  }

  destroy(): void {
    if (!this.view) return
    const win = this.window()
    if (win && !win.isDestroyed()) win.contentView.removeChildView(this.view)
    this.view.webContents.close()
    this.view = null
    this.videoId = null
    this.endReclaim()
  }

  private applyBounds(): void {
    if (!this.view) return
    const visible = this.videoId !== null && this.bounds !== null
    this.view.setVisible(visible)
    this.view.setBounds(visible && this.bounds ? this.bounds : HIDDEN)
  }

  private ensureView(): WebContentsView | null {
    if (this.view) return this.view
    const win = this.window()
    if (!win || win.isDestroyed()) return null
    const ses = session.fromPartition(PARTITION)
    ses.setPermissionRequestHandler((_wc, _perm, deny) => deny(false))
    ses.setPermissionCheckHandler((wc, permission, origin, details) =>
      wc === this.view?.webContents && this.allowsOutputProbe(permission, origin, details)
    )
    ses.on('will-download', (e) => e.preventDefault())
    // Google refuses sign-in from user agents that announce Electron.
    ses.setUserAgent(ses.getUserAgent().replace(/\sElectron\/\S+/, ''))
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        preload: join(__dirname, '../preload/yt.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        // Cues must keep firing when the window is behind a DAW, and playback must start without a click.
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    })
    const wc = view.webContents
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    // Redirects and subframes bypass will-navigate, so guard all three.
    const guard = (e: Electron.Event, url: string): void => {
      if (isAllowedUrl(url)) return
      console.warn(`[ytmusic] blocked navigation to ${url}`)
      e.preventDefault()
    }
    // A new page starts without the analysis tap; replay what the visualizer wants.
    wc.on('dom-ready', () => {
      if (this.holding) wc.send(YT_PAGE.command, { cmd: 'hold', value: 1 })
      // Before the page builds its audio graph, so that starts on the chosen device.
      if (this.outputLabel) wc.send(YT_PAGE.command, { cmd: 'output', value: this.outputLabel })
    })
    wc.on('did-finish-load', () => {
      if (this.holding) wc.send(YT_PAGE.command, { cmd: 'hold', value: 1 })
      if (this.analysing) wc.send(YT_PAGE.command, { cmd: 'analyse', value: 1 })
      if (this.limiting) wc.send(YT_PAGE.command, { cmd: 'limiter', value: 1 })
      if (this.outputLabel) wc.send(YT_PAGE.command, { cmd: 'output', value: this.outputLabel })
    })
    // The old document, whose clocks still name the other song, is gone once a main-frame navigation commits or fails.
    wc.on('did-navigate', (_e, url) => {
      if (this.isTrackPage(url)) this.endReclaim()
    })
    wc.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
      if (isMainFrame) this.endReclaim()
    })
    wc.on('will-navigate', guard)
    wc.on('will-redirect', guard)
    wc.on('will-frame-navigate', (e) => guard(e, e.url))
    win.contentView.addChildView(view)
    this.view = view
    return view
  }
}
