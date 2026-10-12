// Runs inside the music.youtube.com page. Reports the <video> position to main and applies
// transport commands. Channel names are literals (see YT_PAGE in shared/ipc.ts): this bundle
// must not share runtime imports with the app preload.
import { ipcRenderer } from 'electron'

const CLOCK = 'yt:page-clock'
const COMMAND = 'yt:page-command'
const AUDIO = 'yt:page-audio'
const POLL_MS = 40
const IDLE_RESEND_MS = 1000
// Must match FFT_SIZE and AUDIO_FRAME_MS in shared/audio.ts.
const FFT_SIZE = 1024
const SMOOTHING = 0.6
const AUDIO_FRAME_MS = 33
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

// Spectrum tap for the visualizer. Routing a <video> through Web Audio is permanent for that element,
// so it is only set up the first time the visualizer asks, and always stays connected to the output.
let analysis: { analyser: AnalyserNode; el: HTMLVideoElement } | null = null
let audioCtx: AudioContext | null = null
// An element can be captured only once, ever, so its source node is kept for reuse if the page swaps back to it.
const sources = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>()
const failed = new WeakSet<HTMLVideoElement>()

let analyseTimer: ReturnType<typeof setInterval> | null = null

const freqBuf = new Uint8Array(FFT_SIZE / 2)
const waveBuf = new Uint8Array(FFT_SIZE)

const resumeContext = (): void => void audioCtx?.resume().catch(() => undefined)

const ensureAnalysis = (v: HTMLVideoElement): NonNullable<typeof analysis> | null => {
  if (analysis?.el === v) return analysis
  if (failed.has(v)) return null
  try {
    const ctx = audioCtx ?? new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = SMOOTHING
    let source = sources.get(v)
    if (!source) {
      source = ctx.createMediaElementSource(v)
      sources.set(v, source) // remembered at once: a capture is permanent even if wiring below throws
    }
    // Build the new tap first; release the old one only once this one exists, so a failure never mutes the video.
    analysis?.analyser.disconnect()
    source.disconnect()
    source.connect(analyser)
    analyser.connect(ctx.destination)
    audioCtx = ctx
    // A suspended context would mute the video, and the frame timer is off while the visualizer is hidden.
    v.addEventListener('play', resumeContext)
    analysis = { analyser, el: v }
    return analysis
  } catch {
    failed.add(v) // Web Audio unavailable or the element was captured elsewhere: stay flat, don't retry every tick
    return null
  }
}

const sendAudioFrame = (): void => {
  const v = video()
  if (!v || location.origin !== TRUSTED_ORIGIN) return
  const a = ensureAnalysis(v)
  if (!a) return
  if (audioCtx?.state === 'suspended') resumeContext()
  a.analyser.getByteFrequencyData(freqBuf)
  a.analyser.getByteTimeDomainData(waveBuf)
  // IPC copies the data, so the buffers are safe to reuse.
  ipcRenderer.send(AUDIO, { freq: freqBuf, wave: waveBuf.subarray(0, FFT_SIZE / 2) })
}

const setAnalysis = (on: boolean): void => {
  if (analyseTimer !== null) clearInterval(analyseTimer)
  analyseTimer = on ? setInterval(sendAudioFrame, AUDIO_FRAME_MS) : null
}

ipcRenderer.on(COMMAND, (_e, command: { cmd?: string; value?: number }) => {
  if (typeof command === 'object' && command !== null && command.cmd === 'analyse') {
    setAnalysis(command.value === 1)
    return
  }
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
    case 'volume':
      if (typeof command.value === 'number' && Number.isFinite(command.value)) v.volume = Math.min(1, Math.max(0, command.value))
      break
  }
})
