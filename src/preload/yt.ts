// Runs inside the music.youtube.com page. Reports the <video> position to main and applies
// transport commands. Channel names are literals (see YT_PAGE in shared/ipc.ts): this bundle
// must not share runtime imports with the app preload.
import { ipcRenderer } from 'electron'

const CLOCK = 'yt:page-clock'
const COMMAND = 'yt:page-command'
const POLL_MS = 40
const IDLE_RESEND_MS = 1000
const MIN_RATE = 0.25
const MAX_RATE = 2
/** Only the real site may drive cues; a page reached by any other route reports nothing. */
const TRUSTED_ORIGIN = 'https://music.youtube.com'

const video = (): HTMLVideoElement | null => document.querySelector('video')

let lastSent = { t: -1, playing: false, rate: 1, at: 0 }

setInterval(() => {
  const v = video()
  if (!v || location.origin !== TRUSTED_ORIGIN) return
  const now = Date.now()
  const playing = !v.paused && !v.ended
  const unchanged = v.currentTime === lastSent.t && playing === lastSent.playing && v.playbackRate === lastSent.rate
  // While paused and untouched there's nothing new to say; a slow heartbeat keeps main's view fresh.
  if (unchanged && now - lastSent.at < IDLE_RESEND_MS) return
  lastSent = { t: v.currentTime, playing, rate: v.playbackRate, at: now }
  ipcRenderer.send(CLOCK, {
    t: v.currentTime,
    duration: v.duration,
    playing,
    rate: v.playbackRate,
    videoId: new URLSearchParams(location.search).get('v'),
    sentAt: now
  })
}, POLL_MS)

ipcRenderer.on(COMMAND, (_e, command: { cmd?: string; value?: number }) => {
  const v = video()
  if (!v || typeof command !== 'object' || command === null) return
  switch (command.cmd) {
    case 'play':
      void v.play().catch(() => undefined)
      break
    case 'pause':
      v.pause()
      break
    case 'seek':
      if (typeof command.value === 'number' && Number.isFinite(command.value)) v.currentTime = command.value
      break
    case 'rate':
      if (typeof command.value === 'number') v.playbackRate = Math.min(MAX_RATE, Math.max(MIN_RATE, command.value))
      break
  }
})
