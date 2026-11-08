/**
 * Whether the window is the one in front. Main reports it from the native window, because
 * `document.hidden` never flips behind a DAW (background throttling is off) and `document.hasFocus()`
 * goes false whenever the YouTube Music view takes page focus, though the window is still in front.
 * Everything that only animates (visualizer, pulses, playhead redraws) idles while this is false.
 */
let native = true
let active = true
const listeners = new Set<() => void>()
let started = false
/** A push from main is newer than the answer to the initial query, which must not overwrite it. */
let pushed = false

const update = (): void => {
  const next = native && !document.hidden
  if (next === active) return
  active = next
  for (const l of [...listeners]) l()
}

function start(): void {
  if (started) return
  started = true
  document.addEventListener('visibilitychange', update)
  window.api.onWindowActive((on) => {
    pushed = true
    native = on
    update()
  })
  void window.api
    .getWindowActive()
    .then((on) => {
      if (pushed) return
      native = on
      update()
    })
    .catch(() => undefined)
  update()
}

export const isWindowActive = (): boolean => {
  start()
  return active
}

export function subscribeWindowActive(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
