import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { bandLevels, binCount, binTotalOf, SAVED_LENGTH_TOLERANCE_BINS, WAVE_BANDS, WAVE_BINS_PER_SECOND, WaveRecorder } from '../../../shared/waveform'
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
  /**
   * The track's length in seconds: the real duration once the player reports it, until then the saved recording's length
   * (known as soon as the file is read, long before a YouTube Music page loads), 0 if neither is known.
   */
  duration: number
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
 * A track's waveform: loaded from disk at once (a duration is not needed to read it), then filled in by
 * `useWaveRecorder` as the track plays, and saved back while playing, on pause and on unmount.
 * Redraws are announced through `subscribe`, like the clock, so the player itself doesn't re-render.
 */
export function useWaveform(trackId: string, duration: number, playing: boolean): Waveform {
  /** The saved recording (null: none) once read; undefined while the read is under way. */
  const [saved, setSaved] = useState<Uint8Array | null | undefined>(undefined)
  const [wantsFrames, setWantsFrames] = useState(false)
  const revisionRef = useRef(0)
  const listeners = useRef(new Set<() => void>())
  const dirty = useRef(false)
  const redrawTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saving = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    setSaved(undefined)
    let cancelled = false
    void window.api
      .loadWaveform(trackId)
      .catch(() => null)
      .then((bins) => {
        if (!cancelled) setSaved(bins)
      })
    return () => {
      cancelled = true
    }
  }, [trackId])

  const savedBinTotal = saved ? binTotalOf(saved) : 0
  const savedDuration = savedBinTotal / WAVE_BINS_PER_SECOND
  // Until the real duration is known the saved recording's length stands in for it. Once it is, a length the
  // recording still fits (the recorder's own tolerance) keeps the recorder as it is, so nothing recorded is thrown away
  // by a rebuild; a different length is a different track body and starts over.
  const realBinTotal = duration > 0 ? binCount(duration) : 0
  const keepSaved = savedBinTotal > 0 && (realBinTotal === 0 || Math.abs(realBinTotal - savedBinTotal) <= SAVED_LENGTH_TOLERANCE_BINS)
  const binTotal = keepSaved ? savedBinTotal : realBinTotal
  const recorder = useMemo(
    () => (saved !== undefined && binTotal > 0 ? new WaveRecorder(keepSaved ? savedDuration : duration, saved, binTotal) : null),
    [saved, binTotal] // the rest only matters through `binTotal`
  )
  const shownDuration = duration > 0 ? duration : savedDuration

  useEffect(() => {
    setWantsFrames(recorder !== null && !recorder.complete)
  }, [recorder])

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
    () => ({ recorder, duration: shownDuration, subscribe, revision, wantsFrames, markChanged, setWantsFrames }),
    [recorder, shownDuration, subscribe, revision, wantsFrames, markChanged]
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
