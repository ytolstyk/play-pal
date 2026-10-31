interface SinkTarget {
  readonly sinkId: string | { type: 'none' }
  setSinkId(sinkId: string): Promise<void>
}

/** Last device asked of each target, and its switches in order: a quick A -> B -> A must end on A, not be skipped as "already on A". */
const requested = new WeakMap<SinkTarget, string>()
const queue = new WeakMap<SinkTarget, Promise<void>>()

/** Moves an <audio> element or AudioContext to an output device ('' = the system default); a no-op when it is already headed there. */
export function routeTo(target: SinkTarget, sinkId: string): void {
  const current = requested.get(target) ?? (typeof target.sinkId === 'string' ? target.sinkId : '')
  if (current === sinkId) return
  requested.set(target, sinkId)
  const switched = (queue.get(target) ?? Promise.resolve()).then(() => target.setSinkId(sinkId)).catch((err) => {
    if (requested.get(target) === sinkId) requested.delete(target)
    console.warn('[output] could not switch the output device', err)
  })
  queue.set(target, switched)
}
