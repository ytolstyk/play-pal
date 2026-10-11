import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { PlaybackState, Track } from '../../../shared/types'

const IDLE: PlaybackState = { t: 0, duration: 0, playing: false, rate: 1 }
const UI_INTERVAL_MS = 50
/** Main extrapolates between samples, so it only needs a periodic drift correction plus every state change. */
const CLOCK_SEND_EVERY_MS = 250
const AUDIO_EVENTS: string[] = ['play', 'pause', 'seeking', 'seeked', 'ratechange', 'loadedmetadata', 'durationchange', 'ended']

export interface Playback {
  state: PlaybackState
  /** Latest position without re-rendering, for event handlers. */
  timeRef: RefObject<number>
  audioRef: RefObject<HTMLAudioElement | null>
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
    const playing = stateRef.current.playing
    const audio = audioRef.current
    if (isFile) {
      if (!audio) return
      if (playing) audio.pause()
      else void audio.play().catch(() => undefined)
    } else window.api.ytCommand({ cmd: playing ? 'pause' : 'play' })
  }, [isFile])

  const seek = useCallback(
    (t: number) => {
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

  return { state, timeRef, audioRef, toggle, seek, setRate }
}
