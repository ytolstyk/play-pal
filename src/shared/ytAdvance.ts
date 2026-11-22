/**
 * How recently the track's own page must have been alive (playing, or sitting at its end) for a change of video to count as the page moving on by itself,
 * and how recently a click or key in the page counts as the user having caused it (about as long as the page's transient
 * user activation, which a full page load also resets).
 */
export const YT_RECENT_MS = 5000

const within = (at: number | null, now: number): boolean => at !== null && now - at <= YT_RECENT_MS

/**
 * Whether the page leaving the track was its queue auto-advancing (which can come well before the reported end) rather than
 * the user browsing away: it was alive a moment ago and nobody clicked or typed in it just before. A media key
 * (Next) is no page activation, so it reads as an auto-advance too.
 */
export const isAutoAdvance = (lastUserActiveAt: number | null, lastAliveAt: number | null, now: number): boolean =>
  within(lastAliveAt, now) && !within(lastUserActiveAt, now)

/** Within this of the end the track's page counts as having finished rather than paused. */
const END_SLACK_S = 0.5

/**
 * Whether a sample from the track's own page shows it alive for the purposes of `isAutoAdvance`: playing, or sitting at its end.
 * The app swallows the page's `ended` event, so a finished track is left for the page to move on from by itself some time
 * later (its queue's own timers); that late move is still an auto-advance, not the user browsing away.
 */
export const showsTrackAlive = (clock: { t: number; duration: number; playing: boolean }): boolean =>
  clock.playing || (clock.duration > 0 && clock.t >= clock.duration - END_SLACK_S)
