import { useCallback, useEffect, useState } from 'react'
import type { Library, Track, YtAdvanced } from '../../../shared/types'
import { newYtTrack } from '../newTrack'

export interface AdvancedOffer {
  /** The song the YouTube page moved on to by itself, unless the library already has it. */
  offered: YtAdvanced | null
  dismiss(): void
  /** Adds the offered song to the library as a track of its own. */
  accept(): void
}

/**
 * Main takes the open track back when YouTube Music starts another song on its own, and says which song it was;
 * this keeps that news until the user adds the song or dismisses it, or opens another track (it belongs to the one that was playing).
 */
export function useAdvancedOffer(library: Library | null, selectedId: string | null, add: (t: Track) => void): AdvancedOffer {
  const [advanced, setAdvanced] = useState<YtAdvanced | null>(null)
  useEffect(() => window.api.onYtAdvanced(setAdvanced), [])
  useEffect(() => {
    setAdvanced(null)
  }, [selectedId])

  const known = advanced !== null && library?.tracks.some((t) => t.source.kind === 'ytmusic' && t.source.videoId === advanced.videoId)
  const offered = known ? null : advanced
  const dismiss = useCallback(() => setAdvanced(null), [])
  const accept = useCallback(() => {
    if (!advanced) return
    setAdvanced(null)
    add(newYtTrack(advanced.videoId, advanced.title))
  }, [advanced, add])
  return { offered, dismiss, accept }
}
