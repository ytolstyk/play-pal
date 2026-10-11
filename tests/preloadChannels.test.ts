import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { YT_PAGE } from '../src/shared/ipc'

describe('yt preload channel literals', () => {
  it('match YT_PAGE (the preload cannot import it)', () => {
    const src = readFileSync(new URL('../src/preload/yt.ts', import.meta.url), 'utf8')
    expect(src).toContain(`const CLOCK = '${YT_PAGE.clock}'`)
    expect(src).toContain(`const COMMAND = '${YT_PAGE.command}'`)
  })
})
