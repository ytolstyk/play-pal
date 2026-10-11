import { useCallback, useEffect, useRef, useState } from 'react'
import type { Cue, Track } from '../../../shared/types'
import { DEFAULT_CUE_ACTION, sortedByTime } from '../../../shared/cues'
import { formatTime } from '../../../shared/time'
import { MAX_TITLE } from '../../../shared/types'
import { usePlayback } from '../hooks/usePlayback'
import { CueList } from './CueList'

interface Props {
  track: Track
  onChange(change: (t: Track) => Track): void
}

const RATES = [0.5, 0.75, 0.9, 1]
const YT_BOUNDS_POLL_MS = 250
const YT_HEIGHT = { min: 160, max: 900, default: 340, step: 20, storageKey: 'ytSlotHeight' }

const loadYtHeight = (): number => {
  try {
    const n = Number(localStorage.getItem(YT_HEIGHT.storageKey))
    if (n >= YT_HEIGHT.min && n <= YT_HEIGHT.max) return n
  } catch {
    // storage unavailable: use the default
  }
  return YT_HEIGHT.default
}

const isTypingTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(t.tagName)

export function Player({ track, onChange }: Props): React.JSX.Element {
  const { state, timeRef, audioRef, toggle, seek, setRate } = usePlayback(track)
  const [firedId, setFiredId] = useState<string | null>(null)
  const [ytHeight, setYtHeight] = useState(loadYtHeight)
  const slotRef = useRef<HTMLDivElement>(null)
  const isYt = track.source.kind === 'ytmusic'

  const changeYtHeight = (h: number): void => {
    setYtHeight(h)
    try {
      localStorage.setItem(YT_HEIGHT.storageKey, String(h))
    } catch {
      // not persisted; the size still applies for this session
    }
  }

  useEffect(() => window.api.onCueFired(setFiredId), [])

  // The YouTube Music view is a native overlay; keep it glued to the slot's rectangle.
  useEffect(() => {
    const slot = slotRef.current
    if (!isYt || !slot) return
    let last = ''
    const report = (): void => {
      const r = slot.getBoundingClientRect()
      const rect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
      const key = JSON.stringify(rect)
      if (key === last) return
      last = key
      window.api.setYtBounds(rect)
    }
    report()
    const timer = setInterval(report, YT_BOUNDS_POLL_MS)
    window.addEventListener('resize', report)
    // The slider resizes the slot; follow it live instead of waiting for the next poll.
    const observer = new ResizeObserver(report)
    observer.observe(slot)
    return () => {
      observer.disconnect()
      clearInterval(timer)
      window.removeEventListener('resize', report)
      window.api.setYtBounds(null)
    }
  }, [isYt])

  const addCue = useCallback(() => {
    onChange((t) => {
      const previous = sortedByTime(t.cues).pop()
      const cue: Cue = {
        id: crypto.randomUUID(),
        time: Math.round(timeRef.current * 1000) / 1000,
        label: `Cue ${t.cues.length + 1}`,
        action: previous?.action ?? DEFAULT_CUE_ACTION
      }
      return { ...t, cues: [...t.cues, cue] }
    })
  }, [onChange, timeRef])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.code === 'KeyM') addCue()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, addCue])

  const changeCue = useCallback(
    (id: string, change: Partial<Cue>) =>
      onChange((t) => ({ ...t, cues: t.cues.map((c) => (c.id === id ? { ...c, ...change } : c)) })),
    [onChange]
  )
  const deleteCue = useCallback(
    (id: string) => onChange((t) => ({ ...t, cues: t.cues.filter((c) => c.id !== id) })),
    [onChange]
  )

  const duration = state.duration
  const pct = (t: number): string => `${duration > 0 ? Math.min(100, (t / duration) * 100) : 0}%`

  return (
    <section className="player">
      <input
        className="title-input"
        value={track.title}
        maxLength={MAX_TITLE}
        aria-label="Track title"
        onChange={(e) => onChange((t) => ({ ...t, title: e.target.value }))}
      />
      {track.source.kind === 'file' ? (
        <audio ref={audioRef} src={`ppfile://t/${track.id}`} preload="auto" />
      ) : (
        <div className="yt-slot" ref={slotRef} style={{ height: ytHeight }}>
          <p className="muted small">YouTube Music loads here. Sign in once and the session is remembered.</p>
        </div>
      )}
      <div className="transport">
        <button className="primary" onClick={toggle}>
          {state.playing ? 'Pause' : 'Play'}
        </button>
        <span className="mono readout">
          {formatTime(state.t)} / {formatTime(duration)}
        </span>
        <label className="muted small">
          Speed
          <select value={state.rate} onChange={(e) => setRate(Number(e.target.value))}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
        <button onClick={addCue}>Add cue here (M)</button>
        {isYt && (
          <>
            <button onClick={() => window.api.ytReturn()} title="Navigate the video view back to this track">
              Back to track
            </button>
            <label className="muted small">
              View size
              <input
                type="range"
                min={YT_HEIGHT.min}
                max={YT_HEIGHT.max}
                step={YT_HEIGHT.step}
                value={ytHeight}
                aria-label="Video view size"
                onChange={(e) => changeYtHeight(Number(e.target.value))}
                onPointerUp={(e) => e.currentTarget.blur()}
              />
            </label>
          </>
        )}
      </div>
      <div
        className="timeline"
        role="slider"
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(state.t)}
        onClick={(e) => {
          if (duration <= 0) return
          const r = e.currentTarget.getBoundingClientRect()
          seek(((e.clientX - r.left) / r.width) * duration)
        }}
      >
        <div className="played" style={{ transform: `scaleX(${duration > 0 ? Math.min(1, state.t / duration) : 0})` }} />
        {track.cues.map((c) => (
          <div key={c.id} className={c.id === firedId ? 'marker fired' : 'marker'} style={{ left: pct(c.time) }} title={c.label} />
        ))}
      </div>
      <CueList cues={track.cues} firedId={firedId} onChange={changeCue} onDelete={deleteCue} onSeek={seek} />
    </section>
  )
}
