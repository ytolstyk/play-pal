/** Routes the pointer's events to `el` until it is released; a pointer that is already gone is ignored. */
export function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId)
  } catch {
    // pointer already gone; the gesture still ends on pointerup/cancel
  }
}

export function releasePointer(el: Element, pointerId: number): void {
  try {
    el.releasePointerCapture(pointerId)
  } catch {
    // already released
  }
}
