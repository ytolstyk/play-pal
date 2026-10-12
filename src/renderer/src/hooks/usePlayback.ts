import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import type { PlaybackState, Track } from '../../../shared/types'

const IDLE: PlaybackState = { t: 0, duration: 0, playing: false, rate: 1 }
const UI_INTERVAL_MS = 50
/** Main extrapolates between samples, so it only needs a periodic drift correction plus every state change. */
const CLOCK_SEND_EVERY_MS = 250
/** Playing from within this of the start (or from a finished track) counts as starting the song over. */
const START_WINDOW_S = 1
const ENDED_EPSILON_S = 0.1
const AUDIO_EVENTS: string[] = ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'loadedmetadata', 'durationchange', 'ended']

/** Everything but the position: changes rarely, so it can live in React state. */
export type Transport = Omit<PlaybackState, 't'>

/** The playback position as an external store, so only components that show it re-render at clock rate. */
export interface Clock {
  subscribe(listener: () => void): () => void
  get(): number
}

/** Current playback position; re-renders the calling component on every clock update. */
export const useClockTime = (clock: Clock): number => useSyncExternalStore(clock.subscribe, clock.get)

export interface Playback {
  state: Transport
  clock: Clock
  /** Latest position without re-rendering, for event handlers. */
  timeRef: RefObject<number>
  audioRef: RefObject<HTMLAudioElement | null>
  /** True while the track's start preset is loading, before playback begins. */
  starting: boolean
  toggle(): void
  /** Plays the track again from the beginning (sending the start preset, if any). */
  restart(): void
  seek(t: number): void
  setRate(rate: number): void
}

/**
 * One transport over both sources. Local files play in an <audio> element here and report their
 * clock to main; YouTube Music plays in a main-owned view and its clock is pushed back.
 * Main runs the cues either way.
 */
export function usePlayback(track: Track): Playback {
  const isFile = track.source.kind === 'file'
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [state, setState] = useState<Transport>(IDLE)
  const timeRef = useRef(0)
  const stateRef = useRef(IDLE)
  const [starting, setStarting] = useState(false)
  const startingRef = useRef(false)
  const aliveRef = useRef(true)
  const hasStart = track.start !== undefined

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const listeners = useRef(new Set<() => void>())
  const clock = useMemo<Clock>(
    () => ({
      subscribe: (l) => {
        listeners.current.add(l)
        return () => void listeners.current.delete(l)
      },
      get: () => timeRef.current
    }),
    []
  )

  const apply = useCallback((s: PlaybackState) => {
    stateRef.current = s
    timeRef.current = s.t
    // Position goes to the clock subscribers; React state changes only with the transport.
    setState((prev) =>
      prev.duration === s.duration && prev.playing === s.playing && prev.rate === s.rate
        ? prev
        : { duration: s.duration, playing: s.playing, rate: s.rate }
    )
    for (const l of listeners.current) l()
  }, [])

  useEffect(() => {
    if (isFile) return
    return window.api.onPlayback(apply)
  }, [isFile, apply])

  useEffect(() => {
    const audio = audioRef.current
    if (!isFile || !audio) return
    let lastSent = 0
    const report = (forceSend = true): void => {
      const s: PlaybackState = {
        t: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        playing: !audio.paused && !audio.ended,
        rate: audio.playbackRate
      }
      apply(s)
      const now = performance.now()
      if (forceSend || now - lastSent >= CLOCK_SEND_EVERY_MS) {
        lastSent = now
        window.api.sendClock({ trackId: track.id, ...s })
      }
    }
    const onEvent = (): void => report(true)
    for (const e of AUDIO_EVENTS) audio.addEventListener(e, onEvent)
    const timer = setInterval(() => {
      if (!audio.paused) report(false)
    }, UI_INTERVAL_MS)
    report(true)
    return () => {
      for (const e of AUDIO_EVENTS) audio.removeEventListener(e, onEvent)
      clearInterval(timer)
    }
  }, [isFile, track.id, apply])

  /** The single file-vs-YouTube dispatch point for transport commands. */
  const command = useCallback(
    (c: { cmd: 'play' | 'pause' } | { cmd: 'seek' | 'rate'; value: number }): void => {
      const audio = audioRef.current
      if (!isFile) return window.api.ytCommand(c)
      if (!audio) return
      if (!('value' in c)) {
        if (c.cmd === 'play') void audio.play().catch(() => undefined)
        else audio.pause()
      } else if (c.cmd === 'seek') audio.currentTime = c.value
      else audio.playbackRate = c.value
    },
    [isFile]
  )

  /** Plays; from the start it first sends the track's start preset (a failed send still starts the song). */
  const play = useCallback(
    (fromStart: boolean, rewind = false): void => {
      const begin = (): void => {
        if (rewind) command({ cmd: 'seek', value: 0 })
        command({ cmd: 'play' })
      }
      if (!hasStart || !fromStart) return begin()
      // Main sends the preset and resolves after its wait.
      startingRef.current = true
      setStarting(true)
      void window.api.sendStartPreset(track.id).catch(() => false).then(() => {
        startingRef.current = false
        if (!aliveRef.current) return
        setStarting(false)
        begin()
      })
    },
    [hasStart, track.id, command]
  )

  const toggle = useCallback(() => {
    if (startingRef.current) return
    const { playing, t, duration } = stateRef.current
    if (playing) return command({ cmd: 'pause' })
    play(t < START_WINDOW_S || (duration > 0 && t >= duration - ENDED_EPSILON_S))
  }, [command, play])

  const restart = useCallback(() => {
    if (startingRef.current) return
    // With a start preset, stop now and rewind only once it has been sent, so a cue at 0 can't fire ahead of it.
    if (hasStart) command({ cmd: 'pause' })
    play(true, true)
  }, [hasStart, command, play])

  const seek = useCallback(
    (t: number) => {
      if (startingRef.current) return // the start preset is for the beginning; don't play from elsewhere
      command({ cmd: 'seek', value: t })
    },
    [command]
  )

  const setRate = useCallback((rate: number) => command({ cmd: 'rate', value: rate }), [command])

  return { state, clock, timeRef, audioRef, starting, toggle, restart, seek, setRate }
}
