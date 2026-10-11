const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set(['music.youtube.com', 'www.youtube.com', 'youtube.com', 'm.youtube.com'])

export const isVideoId = (v: unknown): v is string => typeof v === 'string' && VIDEO_ID.test(v)

/** Video id from a YouTube / YouTube Music / youtu.be link, or null. */
export function parseVideoId(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const id =
    url.hostname === 'youtu.be'
      ? url.pathname.slice(1)
      : YOUTUBE_HOSTS.has(url.hostname)
        ? url.searchParams.get('v')
        : null
  return isVideoId(id) ? id : null
}

export const watchUrl = (videoId: string): string => `https://music.youtube.com/watch?v=${videoId}`
