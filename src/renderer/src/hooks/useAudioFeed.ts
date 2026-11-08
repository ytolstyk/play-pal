import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { routeTo } from '../audioSink'
import { isWindowActive, subscribeWindowActive } from '../windowActivity'
import {
  ANALYSER_MAX_DB,
  ANALYSER_MIN_DB,
  FFT_SIZE,
  FREQ_BINS,
  SMOOTHING,
  WAVE_SAMPLES,
  type AudioFrame
} from '../../../shared/audio'

/** A frame older than this is treated as silence (the page stopped sending, e.g. it navigated). */
const STALE_MS = 250

/** Pull-style source of the latest spectrum/waveform; read it from an animation frame, not React state. */
export interface AudioFeed {
  read(): AudioFrame | null
}

export type FeedSource = 'file' | 'yt'

export interface FeedWants {
  /** A visualizer is showing. */
  draw: boolean
  /** The waveform recorder has gaps to fill. */
  record: boolean
}

const SILENT: AudioFeed = { read: () => null }

/**
 * Taps the <audio> element. Once an element is routed through Web Audio its sound comes only
 * from this graph, so the context is resumed on every `play` and the graph stays connected
 * to the output for the element's life.
 */
function createFileFeed(audio: HTMLAudioElement, sinkId: string): { feed: AudioFeed; setSink(id: string): void; close(): void } | null {
  try {
    const ctx = new AudioContext({ sinkId }) // on the chosen device from the start, so nothing is heard on the default one
    const analyser = ctx.createAnalyser()
    analyser.fftSize = FFT_SIZE
    analyser.smoothingTimeConstant = SMOOTHING
    analyser.minDecibels = ANALYSER_MIN_DB
    analyser.maxDecibels = ANALYSER_MAX_DB
    ctx.createMediaElementSource(audio).connect(analyser)
    analyser.connect(ctx.destination)
    const resume = (): void => void ctx.resume().catch((err) => console.warn('[visualizer] resume failed', err))
    resume()
    audio.addEventListener('play', resume)
    const freq = new Uint8Array(FREQ_BINS)
    const wave = new Uint8Array(FFT_SIZE) // time-domain data is FFT_SIZE long; the frame carries the first half
    return {
      feed: {
        read: () => {
          analyser.getByteFrequencyData(freq)
          analyser.getByteTimeDomainData(wave)
          return { freq, wave: wave.subarray(0, WAVE_SAMPLES) }
        }
      },
      setSink: (id) => routeTo(ctx, id),
      close: () => {
        audio.removeEventListener('play', resume)
        void ctx.close().catch(() => undefined)
      }
    }
  } catch (err) {
    console.warn('[visualizer] Web Audio unavailable; the visualizer stays flat', err)
    return null
  }
}

/**
 * Where the visualizer gets its audio. A local file is analysed here, on the <audio> element; a
 * YouTube Music track is analysed inside its page and the frames are relayed through main.
 * `wants` says why frames are needed: `draw` (a visualizer is showing) or `record` (the waveform has gaps to fill).
 * The YouTube stream additionally waits for `playing`, and streams for drawing only while the window is in front;
 * for recording it streams regardless, since that is the point of using the app behind a DAW.
 * (document.hidden is no help behind a DAW: background throttling is off, so the page never reads as hidden;
 * the window's focus, reported by main, is what says nothing is looking.)
 */
export function useAudioFeed(
  source: FeedSource,
  audioRef: RefObject<HTMLAudioElement | null>,
  wants: FeedWants,
  playing: boolean,
  sinkId: string
): AudioFeed {
  const active = wants.draw || wants.record
  const { draw, record } = wants
  const file = useRef<{ el: HTMLAudioElement; feed: AudioFeed; setSink(id: string): void; close(): void } | null>(null)
  const sinkRef = useRef(sinkId)
  useEffect(() => {
    sinkRef.current = sinkId
  }, [sinkId])
  const alive = useRef(true)
  const remote = useRef<{ frame: AudioFrame; at: number } | null>(null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      // StrictMode re-runs effects at once; only a real unmount (alive stays false) tears the graph down.
      queueMicrotask(() => {
        if (alive.current) return
        file.current?.close()
        file.current = null
      })
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!active || source !== 'file' || !audio || file.current?.el === audio) return
    // An element can be captured once, so a different element needs a fresh graph.
    file.current?.close()
    const made = createFileFeed(audio, sinkRef.current)
    file.current = made && { el: audio, ...made }
  }, [active, source, audioRef])

  // Once the element is captured its sound comes only from this context, so the context follows the chosen device.
  // Declared after the effect that creates the graph so a new graph is routed in the same pass.
  useEffect(() => {
    file.current?.setSink(sinkId)
  }, [sinkId, active, source])

  // Read through a ref so a change of reason (drawing vs recording) re-syncs without restarting the stream below.
  const wantsRef = useRef({ draw, record })
  const streaming = source === 'yt' && active && playing
  const syncAnalysis = useCallback((): void => {
    const { draw: drawing, record: recording } = wantsRef.current
    // Nothing is drawn while the window is not in front (the app often sits behind a DAW), so drawing alone doesn't stream then.
    window.api.ytCommand({ cmd: 'analyse', value: recording || (drawing && isWindowActive()) ? 1 : 0 })
  }, [])
  useEffect(() => {
    wantsRef.current = { draw, record }
    if (streaming) syncAnalysis()
  }, [draw, record, streaming, syncAnalysis])

  useEffect(() => {
    // Streaming costs the YouTube page, main and this window, so only while something is moving.
    if (!streaming) return
    const sync = syncAnalysis
    sync()
    const unsubscribe = subscribeWindowActive(sync)
    const off = window.api.onAudioFrame((frame) => {
      remote.current = { frame, at: performance.now() }
    })
    return () => {
      unsubscribe()
      off()
      remote.current = null
      window.api.ytCommand({ cmd: 'analyse', value: 0 })
    }
  }, [streaming, syncAnalysis])

  return useMemo<AudioFeed>(() => {
    if (source === 'file') return { read: () => (file.current?.feed ?? SILENT).read() }
    return {
      read: () => {
        const r = remote.current
        return r && performance.now() - r.at < STALE_MS ? r.frame : null
      }
    }
  }, [source])
}
