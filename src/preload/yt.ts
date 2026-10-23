// Runs inside the music.youtube.com page. Reports the <video> position to main and applies
// transport commands. Channel names are literals (see YT_PAGE in shared/ipc.ts): this bundle
// must not share runtime imports with the app preload.
import { ipcRenderer } from 'electron'

const CLOCK = 'yt:page-clock'
const COMMAND = 'yt:page-command'
const AUDIO = 'yt:page-audio'
const POLL_MS = 40
const IDLE_RESEND_MS = 1000
// Must match FFT_SIZE, ANALYSER_*_DB and AUDIO_FRAME_MS in shared/audio.ts.
const FFT_SIZE = 1024
const SMOOTHING = 0.6
const ANALYSER_MIN_DB = -100
const ANALYSER_MAX_DB = 0
const AUDIO_FRAME_MS = 33
/** Drift smaller than this is rounding, not a page reset. */
const VOLUME_EPSILON = 0.005
const MIN_RATE = 0.25
const MAX_RATE = 2
/** Only the real site may drive cues; a page reached by any other route reports nothing. */
const TRUSTED_ORIGIN = 'https://music.youtube.com'

const video = (): HTMLVideoElement | null => document.querySelector('video')

let lastSent = { t: -1, playing: false, rate: 1, at: 0 }
/** Last volume the app asked for. Applied on the gain node; only without Web Audio is it forced onto the <video>, which the page resets on its own. */
let wantedVolume: number | null = null
/** Autoplay is paused until the app's first play command; a page the user has clicked in is theirs to play. */
let holding = false

const holdsAutoplay = (): boolean => holding && !navigator.userActivation.hasBeenActive
// Catches autoplay the moment it starts; the poll below covers a swapped <video>.
document.addEventListener('play', (e) => {
  if (holdsAutoplay() && e.target instanceof HTMLVideoElement) e.target.pause()
}, true)

setInterval(() => {
  const v = video()
  if (!v || location.origin !== TRUSTED_ORIGIN) return
  if (holdsAutoplay() && !v.paused) v.pause()
  const usingWebAudio = ensureChain(v) !== null
  if (usingWebAudio) {
    // The page's own volume multiplies into the graph's input; the app's level is the gain node alone.
    pinElementVolume(v, UNITY_GAIN)
    if (!v.paused) resumeContext()
  } else if (wantedVolume !== null) {
    pinElementVolume(v, wantedVolume)
  }
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

// Output graph: <video> -> gain (the app's volume) -> [limiter, when on] -> analyser (visualizer) -> speakers.
// The page resets video.volume on its own (track change, loudness normalisation); a gain node is out of its reach.
// Routing a <video> through Web Audio is permanent for that element, so the graph is built as soon as one
// appears and always stays connected to the output. The nodes live as long as the context; only the source swaps.
const UNITY_GAIN = 1
const GAIN_SMOOTHING_S = 0.01
/** Keys are the compressor's AudioParams: dB for threshold/knee/ratio, seconds for attack/release. */
const LIMITER = { threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.1 }

interface Graph {
  gain: GainNode
  limiter: DynamicsCompressorNode
  analyser: AnalyserNode
  /** The element currently feeding the graph. */
  el: HTMLVideoElement
}
let graph: Graph | null = null
let audioCtx: AudioContext | null = null
let limiterOn = false
let resuming = false
// An element can be captured only once, ever, so its source node is kept for reuse if the page swaps back to it.
const sources = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>()
const failed = new WeakSet<HTMLVideoElement>()

let analyseTimer: ReturnType<typeof setInterval> | null = null

const freqBuf = new Uint8Array(FFT_SIZE / 2)
const waveBuf = new Uint8Array(FFT_SIZE)

/** A suspended context would mute the video. */
const resumeContext = (): void => {
  if (resuming || !audioCtx || audioCtx.state === 'running') return
  resuming = true
  void audioCtx.resume().catch(() => undefined).finally(() => { resuming = false })
}

const pinElementVolume = (v: HTMLVideoElement, volume: number): void => {
  if (Math.abs(v.volume - volume) > VOLUME_EPSILON) v.volume = volume
}

const applyGain = (): void => {
  if (!graph || !audioCtx) return
  const target = wantedVolume ?? UNITY_GAIN
  const param = graph.gain.gain
  param.cancelScheduledValues(audioCtx.currentTime)
  // The smoothing curve only approaches its target, so silence is set outright.
  if (target === 0) param.value = 0
  else param.setTargetAtTime(target, audioCtx.currentTime, GAIN_SMOOTHING_S)
}

const createLimiter = (ctx: AudioContext): DynamicsCompressorNode => {
  const node = ctx.createDynamicsCompressor()
  for (const [param, value] of Object.entries(LIMITER)) node[param as keyof typeof LIMITER].value = value
  return node
}

/** (Re)wires gain -> analyser, through the limiter when it is on. */
const routeLimiter = (g: Graph): void => {
  g.gain.disconnect()
  g.limiter.disconnect()
  if (limiterOn) {
    g.gain.connect(g.limiter)
    g.limiter.connect(g.analyser)
  } else {
    g.gain.connect(g.analyser)
  }
}

const buildGraph = (ctx: AudioContext, el: HTMLVideoElement): Graph => {
  const analyser = ctx.createAnalyser()
  analyser.fftSize = FFT_SIZE
  analyser.smoothingTimeConstant = SMOOTHING
  analyser.minDecibels = ANALYSER_MIN_DB
  analyser.maxDecibels = ANALYSER_MAX_DB
  analyser.connect(ctx.destination)
  const gain = ctx.createGain()
  gain.gain.value = wantedVolume ?? UNITY_GAIN
  const g: Graph = { gain, limiter: createLimiter(ctx), analyser, el }
  routeLimiter(g)
  return g
}

const ensureChain = (v: HTMLVideoElement): Graph | null => {
  if (graph?.el === v) return graph
  if (failed.has(v)) return null
  try {
    const ctx = audioCtx ?? new AudioContext()
    audioCtx = ctx
    // The graph is complete before any source is attached, and the old source is released only as the new one connects.
    const g = graph ?? buildGraph(ctx, v)
    let source = sources.get(v)
    if (!source) {
      source = ctx.createMediaElementSource(v)
      sources.set(v, source) // remembered at once: a capture is permanent even if wiring below throws
    }
    const previous = graph ? sources.get(graph.el) : undefined
    source.connect(g.gain)
    previous?.disconnect() // only once the new source is attached, so a throw above leaves the old one playing
    g.el = v
    graph = g
    v.addEventListener('play', resumeContext)
    // Pins the element the moment the page resets it, instead of waiting for the next poll.
    v.addEventListener('volumechange', () => pinElementVolume(v, UNITY_GAIN))
    return g
  } catch (error) {
    console.warn('[ytmusic] Web Audio graph failed, using the element volume', error)
    failed.add(v)
    // A captured element has no output of its own any more; never leave it silent.
    const captured = sources.get(v)
    if (captured && audioCtx) {
      try { captured.connect(audioCtx.destination) } catch { /* already connected */ }
    }
    return null
  }
}

const sendAudioFrame = (): void => {
  const v = video()
  if (!v || location.origin !== TRUSTED_ORIGIN) return
  const g = ensureChain(v)
  if (!g) return
  g.analyser.getByteFrequencyData(freqBuf)
  g.analyser.getByteTimeDomainData(waveBuf)
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
  if (typeof command !== 'object' || command === null) return
  if (command.cmd === 'hold') {
    holding = command.value === 1
    if (holding) video()?.pause()
    return
  }
  if (command.cmd === 'limiter') {
    limiterOn = command.value === 1
    if (graph) routeLimiter(graph)
    return
  }
  // Recorded even before a <video> exists; the poll applies it once one appears.
  if (command.cmd === 'volume' && typeof command.value === 'number' && Number.isFinite(command.value)) {
    wantedVolume = Math.min(1, Math.max(0, command.value))
    applyGain()
    return
  }
  if (command.cmd === 'release-volume') {
    wantedVolume = null
    applyGain()
    return
  }
  const v = video()
  if (!v) return
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
