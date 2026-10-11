export const IPC = {
  libraryLoad: 'library:load',
  librarySave: 'library:save',
  pickAudio: 'track:pick-audio',
  arm: 'player:arm',
  lead: 'player:lead',
  fileClock: 'player:file-clock',
  playback: 'player:playback',
  cueFired: 'player:cue-fired',
  ytBounds: 'yt:bounds',
  ytCommand: 'yt:command',
  ytReturn: 'yt:return',
  midiTest: 'midi:test',
  midiStatus: 'midi:status',
  midiReconnect: 'midi:reconnect'
} as const

/**
 * Channels between main and the YouTube Music page's preload. Duplicated as literals in
 * preload/yt.ts because the two preload bundles must not share runtime imports.
 */
export const YT_PAGE = {
  clock: 'yt:page-clock',
  command: 'yt:page-command'
} as const
