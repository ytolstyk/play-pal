import { formatTime } from '../../../shared/time'
import { useClockTime, type Clock } from '../hooks/usePlayback'

/** The current position as text; the only thing besides the timeline that re-renders at clock rate. */
export function TimeReadout({ clock }: { clock: Clock }): React.JSX.Element {
  return <>{formatTime(useClockTime(clock))}</>
}
