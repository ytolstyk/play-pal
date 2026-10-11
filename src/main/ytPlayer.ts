import { WebContentsView, session, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { YT_PAGE } from '../shared/ipc'
import { watchUrl } from '../shared/url'
import type { Rect, YtCommand } from '../shared/types'

const PARTITION = 'persist:ytmusic'
/** Sign-in and playback hop between exactly these hosts; user-content hosts (sites.google.com, ...) are refused. */
const ALLOWED_HOSTS = new Set([
  'music.youtube.com',
  'www.youtube.com',
  'accounts.youtube.com',
  'accounts.google.com'
])
const HIDDEN: Rect = { x: 0, y: 0, width: 0, height: 0 }

const isAllowedUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw)
    return raw === 'about:blank' || (u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname))
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

  constructor(private readonly window: () => BrowserWindow | null) {}

  /** The view's webContents, to recognise clock messages from it. */
  contents(): Electron.WebContents | null {
    return this.view?.webContents ?? null
  }

  load(videoId: string): void {
    if (this.videoId === videoId) return
    const view = this.ensureView()
    if (!view) return
    this.videoId = videoId
    this.applyBounds()
    // A navigation superseded by another one rejects; that's expected, not an error.
    void view.webContents.loadURL(watchUrl(videoId)).catch(() => undefined)
  }

  /** Stops the audio (a hidden page keeps playing) and hides the view. */
  unload(): void {
    this.videoId = null
    if (!this.view) return
    void this.view.webContents.loadURL('about:blank').catch(() => undefined)
    this.applyBounds()
  }

  setBounds(rect: Rect | null): void {
    this.bounds = rect
    this.applyBounds()
  }

  command(command: YtCommand): void {
    this.view?.webContents.send(YT_PAGE.command, command)
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
      if (!isAllowedUrl(url)) e.preventDefault()
    }
    wc.on('will-navigate', guard)
    wc.on('will-redirect', guard)
    wc.on('will-frame-navigate', (e) => guard(e, e.url))
    win.contentView.addChildView(view)
    this.view = view
    return view
  }
}
