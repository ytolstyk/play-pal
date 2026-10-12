import { WebContentsView, session, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { YT_PAGE } from '../shared/ipc'
import { watchUrl } from '../shared/url'
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
  /** The page must not start playing by itself (the track's start preset goes out first); cleared by the first play command. */
  private holding = false

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

  /** Back to the track's own page after the user navigated elsewhere inside the view. */
  returnToTrack(): void {
    if (!this.videoId || !this.view) return
    this.holding = false // the user is steering the view now; don't pause what they play
    // Already on the track's page: reloading would interrupt playback for nothing.
    try {
      const here = new URL(this.view.webContents.getURL())
      if (here.pathname === '/watch' && here.searchParams.get('v') === this.videoId) return
    } catch {
      // unparsable URL (e.g. about:blank): fall through and navigate
    }
    this.navigate(this.view, this.videoId)
  }

  private navigate(view: WebContentsView, videoId: string): void {
    // A navigation superseded by another one rejects; that's expected, not an error.
    void view.webContents.loadURL(watchUrl(videoId)).catch(() => undefined)
  }

  /** Stops the audio (a hidden page keeps playing) and hides the view. */
  unload(): void {
    this.videoId = null
    this.holding = false
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
    if (command.cmd === 'play' && this.holding) {
      this.holding = false
      this.view?.webContents.send(YT_PAGE.command, { cmd: 'hold', value: 0 })
    }
    this.view?.webContents.send(YT_PAGE.command, command)
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
    ses.setPermissionCheckHandler(() => false)
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
    })
    wc.on('did-finish-load', () => {
      if (this.holding) wc.send(YT_PAGE.command, { cmd: 'hold', value: 1 })
      if (this.analysing) wc.send(YT_PAGE.command, { cmd: 'analyse', value: 1 })
    })
    wc.on('will-navigate', guard)
    wc.on('will-redirect', guard)
    wc.on('will-frame-navigate', (e) => guard(e, e.url))
    win.contentView.addChildView(view)
    this.view = view
    return view
  }
}
