/**
 * How recently the track's own page must have been playing for a change of video to count as the page moving on by itself,
 * and how recently a click or key in the page counts as the user having caused it (about as long as the page's transient
 * user activation, which a full page load also resets).
 */
export const YT_RECENT_MS = 5000

const within = (at: number | null, now: number): boolean => at !== null && now - at <= YT_RECENT_MS

/**
 * Whether the page leaving the track was its queue auto-advancing (which can come well before the reported end) rather than
 * the user browsing away: it was playing a moment ago and nobody clicked or typed in it just before. A media key
 * (Next) is no page activation, so it reads as an auto-advance too.
 */
export const isAutoAdvance = (lastUserActiveAt: number | null, lastPlayingAt: number | null, now: number): boolean =>
  within(lastPlayingAt, now) && !within(lastUserActiveAt, now)
