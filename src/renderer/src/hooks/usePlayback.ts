import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { PlaybackState, Track } from '../../../shared/types'

const IDLE: PlaybackState = { t: 0, duration: 0, playing: false, rate: 1 }
const UI_INTERVAL_MS = 50
/** Main extrapolates between samples, so it only needs a periodic drift correction plus every state change. */
const CLOCK_SEND_EVERY_MS = 250
/** Playing from within this of the start (or from a finished track) counts as starting the song over. */
const START_WINDOW_S = 1
const ENDED_EPSILON_S = 0.1
const AUDIO_EVENTS: string[] = ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'loadedmetadata', 'durationchange', 'ended']

export interface Playback {
  state: PlaybackState
  /** Latest position without re-rendering, for event handlers. */
  timeRef: RefObject<number>
  audioRef: RefObject<HTMLAudioElement | null>
  /** True while the track's start preset is loading, before playback begins. */
  starting: boolean
  toggle(): void
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
  const [state, setState] = useState<PlaybackState>(IDLE)
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

  const apply = useCallback((s: PlaybackState) => {
    stateRef.current = s
    timeRef.current = s.t
    setState(s)
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

  const toggle = useCallback(() => {
    if (startingRef.current) return
    const { playing, t, duration } = stateRef.current
    const audio = audioRef.current
    const play = (): void => {
      if (isFile) void audio?.play().catch(() => undefined)
      else window.api.ytCommand({ cmd: 'play' })
    }
    if (playing) {
      if (isFile) audio?.pause()
      else window.api.ytCommand({ cmd: 'pause' })
      return
    }
    const fromStart = t < START_WINDOW_S || (duration > 0 && t >= duration - ENDED_EPSILON_S)
    if (!hasStart || !fromStart) return play()
    // Main sends the preset and resolves after its wait; a failed send still starts the song.
    startingRef.current = true
    setStarting(true)
    void window.api.sendStartPreset(track.id).catch(() => false).then(() => {
      startingRef.current = false
      if (!aliveRef.current) return
      setStarting(false)
      play()
    })
  }, [isFile, hasStart, track.id])

  const seek = useCallback(
    (t: number) => {
      if (startingRef.current) return // the start preset is for the beginning; don't play from elsewhere
      const audio = audioRef.current
      if (isFile) {
        if (audio) audio.currentTime = t
      } else window.api.ytCommand({ cmd: 'seek', value: t })
    },
    [isFile]
  )

  const setRate = useCallback(
    (rate: number) => {
      const audio = audioRef.current
      if (isFile) {
        if (audio) audio.playbackRate = rate
      } else window.api.ytCommand({ cmd: 'rate', value: rate })
    },
    [isFile]
  )

  return { state, timeRef, audioRef, starting, toggle, seek, setRate }
}
