import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { bandLevels, binCount, WAVE_BANDS, WaveRecorder } from '../../../shared/waveform'
import { ClockTracker } from '../clockTracker'
import type { AudioFeed } from './useAudioFeed'
import type { Clock } from './usePlayback'

/** How often the waveform on screen catches up with what has been recorded. */
const REDRAW_MS = 200
const SAVE_EVERY_MS = 10_000
const SAMPLE_EVERY_MS = 20
/** Right after playback starts or jumps, the analyser still holds older (or no) sound. */
const WARMUP_MS = 150
/** Frames are switched on this far (in track seconds) before playback reaches an unrecorded stretch. */
const LOOKAHEAD_S = 1.5
/** Too quiet to tell how loud the track is once the volume is divided out. */
const MIN_VOLUME = 0.05

export interface Waveform {
  recorder: WaveRecorder | null
  /** Changes whenever recorded bins changed, so a canvas can redraw on it; read it with useSyncExternalStore. */
  subscribe(listener: () => void): () => void
  revision(): number
  /** True while the audio feed is needed to fill in unrecorded stretches near the playhead. */
  wantsFrames: boolean
  /** Tells the hook that bins changed (to redraw them and save them). */
  markChanged(): void
  setWantsFrames(on: boolean): void
}

/**
 * A track's waveform: loaded from disk once the duration is known, then filled in by
 * `useWaveRecorder` as the track plays, and saved back while playing, on pause and on unmount.
 * Redraws are announced through `subscribe`, like the clock, so the player itself doesn't re-render.
 */
export function useWaveform(trackId: string, duration: number, playing: boolean): Waveform {
  const [recorder, setRecorder] = useState<WaveRecorder | null>(null)
  const [wantsFrames, setWantsFrames] = useState(false)
  const revisionRef = useRef(0)
  const listeners = useRef(new Set<() => void>())
  const dirty = useRef(false)
  const redrawTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saving = useRef<Promise<unknown>>(Promise.resolve())
  const binTotal = binCount(duration)

  useEffect(() => {
    setRecorder(null)
    setWantsFrames(false)
    if (binTotal === 0) return
    let cancelled = false
    void window.api
      .loadWaveform(trackId)
      .catch(() => null)
      .then((saved) => {
        if (cancelled) return
        const loaded = new WaveRecorder(duration, saved)
        setRecorder(loaded)
        setWantsFrames(!loaded.complete)
      })
    return () => {
      cancelled = true
    }
    // `binTotal` stands for `duration`: a changed length is a different track body.
  }, [trackId, binTotal])

  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener)
    return () => void listeners.current.delete(listener)
  }, [])
  const revision = useCallback(() => revisionRef.current, [])

  const markChanged = useCallback(() => {
    dirty.current = true
    if (redrawTimer.current !== undefined) return
    redrawTimer.current = setTimeout(() => {
      redrawTimer.current = undefined
      revisionRef.current++
      for (const l of listeners.current) l()
    }, REDRAW_MS)
  }, [])

  useEffect(() => () => clearTimeout(redrawTimer.current), [])

  useEffect(() => {
    if (!recorder) return
    const flush = (): void => {
      if (!dirty.current) return
      dirty.current = false
      // One write at a time, so an older snapshot can't land after a newer one.
      saving.current = saving.current.then(() =>
        window.api
          .saveWaveform(trackId, recorder.bins)
          .catch(() => false)
          .then((ok) => {
            if (!ok) dirty.current = true
          })
      )
    }
    const timer = playing ? setInterval(flush, SAVE_EVERY_MS) : undefined
    window.addEventListener('beforeunload', flush)
    return () => {
      clearInterval(timer)
      window.removeEventListener('beforeunload', flush)
      flush() // pause, end of track or leaving it
    }
  }, [recorder, trackId, playing])

  return useMemo(
    () => ({ recorder, subscribe, revision, wantsFrames, markChanged, setWantsFrames }),
    [recorder, subscribe, revision, wantsFrames, markChanged]
  )
}

interface RecorderInput {
  wave: Waveform
  feed: AudioFeed
  clock: Clock
  playing: boolean
  rate: number
  /** 0-1; the analyser hears the track after the volume, so it is divided back out. */
  volume: number
}

/** While playing, samples the loudness of each frequency band from the feed into the waveform at the track's current position. */
export function useWaveRecorder({ wave, feed, clock, playing, rate, volume }: RecorderInput): void {
  const live = useRef({ rate, volume })
  useEffect(() => {
    live.current = { rate, volume }
  }, [rate, volume])
  const { recorder, markChanged, setWantsFrames } = wave

  useEffect(() => {
    if (!recorder || !playing || recorder.complete) return
    const tracker = new ClockTracker(clock.get(), performance.now())
    // Where a stretch of continuous playback began and until when its first sound is not trusted (see WARMUP_MS).
    let stretchStart: number | null = null
    let warmUntil = performance.now() + WARMUP_MS
    let framesWanted = true
    const loudness = new Float64Array(WAVE_BANDS)
    recorder.startNewStretch()

    const startNewStretch = (now: number): void => {
      recorder.startNewStretch()
      stretchStart = null
      warmUntil = now + WARMUP_MS
    }

    const sample = (): void => {
      const now = performance.now()
      const { rate: playbackRate, volume: level } = live.current
      const reading = tracker.read(clock.get(), now, playbackRate)
      if (reading.jumped || reading.stale || level < MIN_VOLUME) return startNewStretch(now)

      // Frames cost (YouTube Music relays them through main), so they are asked for only while the stretch ahead has gaps.
      const needed = recorder.hasGap(reading.t, reading.t + LOOKAHEAD_S * playbackRate)
      if (needed !== framesWanted) {
        framesWanted = needed
        setWantsFrames(needed)
      }
      if (!needed) return startNewStretch(now) // nothing to fill here: don't even read the analyser
      if (now < warmUntil) {
        stretchStart ??= reading.t
        return
      }
      const frame = feed.read()
      if (!frame) return startNewStretch(now)

      bandLevels(frame.freq, level, loudness)
      // The first sound of a stretch also stands for the warm-up before it, so no hole is left there.
      const backfilled = stretchStart !== null && recorder.recordLevels(stretchStart, loudness)
      const recordedNow = recorder.recordLevels(reading.t, loudness)
      stretchStart = null
      if (backfilled || recordedNow) markChanged()
    }

    const timer = setInterval(() => {
      if (!recorder.complete) return sample()
      setWantsFrames(false)
      clearInterval(timer)
    }, SAMPLE_EVERY_MS)
    return () => clearInterval(timer)
  }, [recorder, playing, feed, clock, markChanged, setWantsFrames])
}
