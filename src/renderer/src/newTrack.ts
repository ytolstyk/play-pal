import type { Track } from '../../shared/types'
import { ytFallbackTitle } from '../../shared/url'

/** A library track for a YouTube Music video; without a known title it is named after the video. */
export const newYtTrack = (videoId: string, title = ytFallbackTitle(videoId)): Track => ({
  id: crypto.randomUUID(),
  title,
  source: { kind: 'ytmusic', videoId },
  cues: []
})
