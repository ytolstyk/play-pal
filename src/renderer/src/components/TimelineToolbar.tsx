import { formatTime } from '../../../shared/time'
import { WAVE_VIEWS, type WaveView } from '../../../shared/waveDisplay'
import { canZoomIn, ZOOM_STEP, zoomFactor, type View } from '../timelineView'

interface Props {
  view: View
  duration: number
  zoomed: boolean
  follow: boolean
  /** Share of the track whose waveform is recorded, 0-1. */
  coverage: number
  /** False until the waveform has loaded. */
  hasWaveform: boolean
  waveView: WaveView
  onWaveView(view: WaveView): void
  onZoom(factor: number): void
  onReset(): void
  onFollow(on: boolean): void
}

const FULL_COVERAGE = 0.99

/** Zoom, reset and follow controls under the timeline, the visible range, and how much of the waveform is recorded. */
export function TimelineToolbar({ view, duration, zoomed, follow, coverage, hasWaveform, waveView, onWaveView, onZoom, onReset, onFollow }: Props): React.JSX.Element {
  return (
    <div className="timeline-tools">
      <div className="tool-group" role="group" aria-label="Zoom">
        <button className="small" aria-label="Zoom out" title="Zoom out (−, or scroll down)" disabled={!zoomed} onClick={() => onZoom(1 / ZOOM_STEP)}>
          −
        </button>
        <span className="mono small zoom-readout">{zoomFactor(view, duration).toFixed(1)}×</span>
        <button className="small" aria-label="Zoom in" title="Zoom in (+, or scroll up)" disabled={!canZoomIn(view, duration)} onClick={() => onZoom(ZOOM_STEP)}>
          +
        </button>
        <button className="small" title="Show the whole track (0)" disabled={!zoomed} onClick={onReset}>
          Reset zoom
        </button>
        <button
          className={follow ? 'small toggle on' : 'small toggle'}
          aria-pressed={follow}
          title="Keep the playhead in view while playing. Scrolling by hand turns this off."
          disabled={!zoomed}
          onClick={() => onFollow(!follow)}
        >
          Follow
        </button>
      </div>
      <div className="tool-group" role="group" aria-label="Frequencies shown">
        {WAVE_VIEWS.map((o) => (
          <button
            key={o.value}
            className={waveView === o.value ? 'small toggle on' : 'small toggle'}
            aria-pressed={waveView === o.value}
            title={o.title}
            onClick={() => onWaveView(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {zoomed && (
        <span className="mono small muted">
          {formatTime(view.start)} – {formatTime(view.start + view.span)}
        </span>
      )}
      {hasWaveform && coverage < FULL_COVERAGE && (
        <span className="small muted wave-note">Waveform {Math.round(coverage * 100)}% recorded; it fills in as the track plays</span>
      )}
    </div>
  )
}
