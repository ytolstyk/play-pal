import { useCallback, useEffect, useRef, useState } from 'react'
import type { Cue, Track } from '../../../shared/types'
import { DEFAULT_CUE_ACTION, sortedByTime } from '../../../shared/cues'
import { formatTime } from '../../../shared/time'
import { MAX_TITLE } from '../../../shared/types'
import { usePlayback } from '../hooks/usePlayback'
import { Wire } from './Circuit'
import { CueList } from './CueList'
import { TimeReadout } from './TimeReadout'
import { Timeline } from './Timeline'
import { StartPresetEditor } from './StartPresetEditor'

interface Props {
  track: Track
  /**
   * True while a modal overlay (settings) is open. The YouTube view is a native layer above the
   * page, so it is hidden (setYtBounds(null)) and the play/cue hotkeys are ignored meanwhile.
   */
  suspendVideo: boolean
  onChange(change: (t: Track) => Track): void
}

const RATES = [0.5, 0.75, 0.9, 1]
const YT_BOUNDS_POLL_MS = 250
const YT_HEIGHT = { min: 160, max: 900, default: 340, keyStep: 20, storageKey: 'ytSlotHeight' }

const clampYtHeight = (h: number): number => Math.min(YT_HEIGHT.max, Math.max(YT_HEIGHT.min, Math.round(h)))

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

export function Player({ track, suspendVideo, onChange }: Props): React.JSX.Element {
  const { state, clock, timeRef, audioRef, starting, toggle, restart, seek, setRate } = usePlayback(track)
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

  // Drag the divider under the video. Pointer capture keeps the drag alive outside the handle.
  const startResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const handle = e.currentTarget
    const startY = e.clientY
    const startH = ytHeight
    handle.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void => setYtHeight(clampYtHeight(startH + ev.clientY - startY))
    const end = (ev: PointerEvent): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      changeYtHeight(clampYtHeight(startH + ev.clientY - startY))
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  useEffect(() => window.api.onCueFired(setFiredId), [])

  // Lets the stylesheet run the wire pulses only while playing in a visible window, so they cost
  // nothing when idle or behind a DAW (the window keeps running with backgroundThrottling off).
  useEffect(() => {
    const root = document.documentElement
    const sync = (): void => {
      if (state.playing && !document.hidden) root.dataset.playing = ''
      else delete root.dataset.playing
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      delete root.dataset.playing
    }
  }, [state.playing])

  // The YouTube Music view is a native overlay; keep it glued to the slot's rectangle.
  useEffect(() => {
    const slot = slotRef.current
    if (!isYt || suspendVideo || !slot) return
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
  }, [isYt, suspendVideo])

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
      if (suspendVideo || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'Space') {
        e.preventDefault()
        toggle()
      } else if (e.code === 'KeyM') addCue()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, addCue, suspendVideo])

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
        <>
          <div className="yt-slot" ref={slotRef} style={{ height: ytHeight }}>
            <p className="muted small">YouTube Music loads here. Sign in once and the session is remembered.</p>
          </div>
          <div
            className="yt-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize video view"
            aria-valuemin={YT_HEIGHT.min}
            aria-valuemax={YT_HEIGHT.max}
            aria-valuenow={ytHeight}
            tabIndex={0}
            onPointerDown={startResize}
            onDoubleClick={() => changeYtHeight(YT_HEIGHT.default)}
            onKeyDown={(e) => {
              const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
              if (!dir) return
              e.preventDefault()
              changeYtHeight(clampYtHeight(ytHeight + dir * YT_HEIGHT.keyStep))
            }}
          />
        </>
      )}
      <Wire variant="a" />
      <StartPresetEditor start={track.start} onChange={(start) => onChange((t) => ({ ...t, start }))} />
      <div className="transport">
        <button className="primary" disabled={starting} onClick={toggle}>
          {starting ? 'Loading…' : state.playing ? 'Pause' : 'Play'}
        </button>
        <button disabled={starting} onClick={restart} title="Play from the beginning">
          Restart
        </button>
        <span className="mono readout">
          <TimeReadout clock={clock} /> / {formatTime(duration)}
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
          </>
        )}
      </div>
      <Wire variant="b" />
      <Timeline clock={clock} duration={duration} cues={track.cues} firedId={firedId} onSeek={seek} />
      <Wire variant="c" />
      <CueList cues={track.cues} firedId={firedId} onChange={changeCue} onDelete={deleteCue} onSeek={seek} />
    </section>
  )
}
