import { describe, expect, it } from 'vitest'
import { CueRunner } from '../src/main/cueRunner'
import type { ClockSample, Cue } from '../src/shared/types'

const action = { type: 'cc', channel: 1, number: 20, value: 127 } as const
const cue = (id: string, time: number): Cue => ({ id, time, label: id, action })
const sample = (t: number, playing = true, rate = 1): ClockSample => ({
  trackId: 'T',
  t,
  duration: 300,
  playing,
  rate
})

function setup(cues: Cue[], leadMs = 0) {
  const fired: string[] = []
  const runner = new CueRunner((c) => {
    fired.push(c.id)
    return true
  })
  runner.setLeadMs(leadMs)
  runner.select('T', cues)
  return { runner, fired }
}

describe('CueRunner', () => {
  it('fires a cue when playback crosses it', () => {
    const { runner, fired } = setup([cue('a', 10)])
    runner.sample(sample(9), 0)
    runner.tick(500)
    expect(fired).toEqual([])
    runner.tick(1100)
    expect(fired).toEqual(['a'])
  })

  it('does not fire the same cue twice', () => {
    const { runner, fired } = setup([cue('a', 10)])
    runner.sample(sample(9.9), 0)
    runner.tick(200)
    runner.tick(400)
    runner.tick(600)
    expect(fired).toEqual(['a'])
  })

  it('fires early by the lead time', () => {
    const { runner, fired } = setup([cue('a', 10)], 200)
    runner.sample(sample(9.7), 0)
    runner.tick(50)
    expect(fired).toEqual([])
    runner.tick(150) // position 9.85 + 0.2 lead = 10.05
    expect(fired).toEqual(['a'])
  })

  it('on a forward seek fires only the cue active at the new position', () => {
    const { runner, fired } = setup([cue('a', 10), cue('b', 20), cue('c', 30)])
    runner.sample(sample(0), 0)
    runner.sample(sample(35), 100) // jumped past all three
    expect(fired).toEqual(['c'])
  })

  it('on a backward seek re-fires the cue active there', () => {
    const { runner, fired } = setup([cue('a', 10), cue('b', 20)])
    runner.sample(sample(25), 0)
    expect(fired).toEqual(['b'])
    runner.sample(sample(12), 100)
    expect(fired).toEqual(['b', 'a'])
  })

  it('does nothing when seeking before every cue', () => {
    const { runner, fired } = setup([cue('a', 10)])
    runner.sample(sample(2), 0)
    expect(fired).toEqual([])
  })

  it('does not treat normal sample jitter as a seek', () => {
    const { runner, fired } = setup([cue('a', 10)])
    runner.sample(sample(9.5), 0)
    runner.sample(sample(9.55), 40) // expected ~9.54
    runner.tick(600)
    expect(fired).toEqual(['a'])
  })

  it('scales extrapolation by playback rate', () => {
    const { runner, fired } = setup([cue('a', 10)])
    runner.sample(sample(9.5, true, 0.5), 0)
    runner.tick(500) // 0.25s of track
    expect(fired).toEqual([])
    runner.tick(1100) // 0.55s of track
    expect(fired).toEqual(['a'])
  })

  it('fires only the last of several cues crossed in one tick', () => {
    const { runner, fired } = setup([cue('a', 10), cue('b', 10.1)])
    runner.sample(sample(9.9), 0)
    runner.tick(500)
    expect(fired).toEqual(['b'])
  })

  it('does not advance while paused, and a paused seek resolves the active cue', () => {
    const { runner, fired } = setup([cue('a', 10), cue('b', 20)])
    runner.sample(sample(5, false), 0)
    runner.tick(60000)
    expect(fired).toEqual([])
    runner.sample(sample(21, false), 61000)
    expect(fired).toEqual(['b'])
  })

  it('re-fires a cue when a loop crosses it again', () => {
    const { runner, fired } = setup([cue('a', 10)])
    runner.sample(sample(9.5), 0)
    runner.tick(1000) // crosses 10
    runner.sample(sample(0.2), 1100) // looped back before the cue
    runner.sample(sample(9.5), 1200) // and on again
    runner.tick(2200)
    expect(fired).toEqual(['a', 'a'])
  })

  it('does not re-send the already loaded preset when seeking within its section', () => {
    const { runner, fired } = setup([cue('a', 10), cue('b', 20)])
    runner.sample(sample(25), 0)
    runner.sample(sample(22), 100)
    expect(fired).toEqual(['b'])
  })

  it('retries a cue whose MIDI send failed', () => {
    let up = false
    const fired: string[] = []
    const runner = new CueRunner((c) => {
      if (up) fired.push(c.id)
      return up
    })
    runner.select('T', [cue('a', 10)])
    runner.sample(sample(12), 0) // port down: not sent
    up = true
    runner.sample(sample(13), 100) // seek within the section: tries again
    expect(fired).toEqual(['a'])
  })

  it('keeps retrying a crossed cue until the port is back', () => {
    let up = false
    const fired: string[] = []
    const runner = new CueRunner((c) => {
      if (up) fired.push(c.id)
      return up
    })
    runner.select('T', [cue('a', 10)])
    runner.sample(sample(9.9), 0)
    runner.tick(200) // crosses 10 while the port is down
    runner.tick(300)
    expect(fired).toEqual([])
    up = true
    runner.sample(sample(10.4), 400)
    runner.tick(450)
    runner.tick(550)
    expect(fired).toEqual(['a'])
  })

  it('resends after the loaded cue is edited', () => {
    const { runner, fired } = setup([cue('a', 10)])
    runner.sample(sample(12), 0)
    runner.setCues([{ ...cue('a', 10), action: { ...action, value: 5 } }])
    runner.sample(sample(15), 100)
    expect(fired).toEqual(['a', 'a'])
  })

  it('drops a pending retry when the user seeks elsewhere', () => {
    let up = false
    const fired: string[] = []
    const runner = new CueRunner((c) => {
      if (up) fired.push(c.id)
      return up
    })
    runner.select('T', [cue('a', 10), cue('b', 20)])
    runner.sample(sample(19.9), 0)
    runner.tick(200) // crosses 20 while down: pending b
    runner.sample(sample(3), 300) // seek to before everything
    up = true
    runner.tick(500)
    expect(fired).toEqual([])
  })

  it('drops a pending retry for a cue that was deleted', () => {
    let up = false
    const fired: string[] = []
    const runner = new CueRunner((c) => {
      if (up) fired.push(c.id)
      return up
    })
    runner.select('T', [cue('a', 10)])
    runner.sample(sample(9.9), 0)
    runner.tick(200)
    runner.setCues([])
    up = true
    runner.tick(400)
    expect(fired).toEqual([])
  })

  it('stops extrapolating when samples dry up', () => {
    const { runner, fired } = setup([cue('a', 10)])
    runner.sample(sample(5), 0)
    runner.tick(10000) // 10s of silence: the clock is dead, no cue at 10
    runner.tick(20000)
    expect(fired).toEqual([])
  })

  it('halt() stops firing until the next sample', () => {
    const { runner, fired } = setup([cue('a', 10)])
    runner.sample(sample(9.9), 0)
    runner.halt()
    runner.tick(500)
    expect(fired).toEqual([])
  })

  it('ignores samples for another track', () => {
    const { runner, fired } = setup([cue('a', 0)])
    runner.sample({ ...sample(5), trackId: 'other' }, 0)
    expect(fired).toEqual([])
  })

  it('picks up cues edited while a track is open', () => {
    const { runner, fired } = setup([])
    runner.sample(sample(9), 0)
    runner.setCues([cue('a', 10)])
    runner.tick(1100)
    expect(fired).toEqual(['a'])
  })
})
