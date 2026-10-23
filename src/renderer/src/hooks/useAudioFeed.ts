import { useEffect, useMemo, useRef, type RefObject } from 'react'
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

const SILENT: AudioFeed = { read: () => null }

/**
 * Taps the <audio> element. Once an element is routed through Web Audio its sound comes only
 * from this graph, so the context is resumed on every `play` and the graph stays connected
 * to the output for the element's life.
 */
function createFileFeed(audio: HTMLAudioElement): { feed: AudioFeed; close(): void } | null {
  try {
    const ctx = new AudioContext()
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
 * `active` is whether anything is looking; the YouTube stream additionally waits for `playing`.
 * (document.hidden is no help behind a DAW: background throttling is off, so the page never reads as hidden.)
 */
export function useAudioFeed(
  source: FeedSource,
  audioRef: RefObject<HTMLAudioElement | null>,
  active: boolean,
  playing: boolean
): AudioFeed {
  const file = useRef<{ el: HTMLAudioElement; feed: AudioFeed; close(): void } | null>(null)
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
    const made = createFileFeed(audio)
    file.current = made && { el: audio, ...made }
  }, [active, source, audioRef])

  useEffect(() => {
    // Streaming costs the YouTube page, main and this window, so only while something is moving.
    if (source !== 'yt' || !active || !playing) return
    // Nothing is drawn while the window is hidden (the app often sits behind a DAW), so don't stream then.
    const sync = (): void => window.api.ytCommand({ cmd: 'analyse', value: document.hidden ? 0 : 1 })
    sync()
    document.addEventListener('visibilitychange', sync)
    const off = window.api.onAudioFrame((frame) => {
      remote.current = { frame, at: performance.now() }
    })
    return () => {
      document.removeEventListener('visibilitychange', sync)
      off()
      remote.current = null
      window.api.ytCommand({ cmd: 'analyse', value: 0 })
    }
  }, [source, active, playing])

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
