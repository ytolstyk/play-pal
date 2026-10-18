import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BackupStore } from '../src/main/backups'
import { LibraryStore } from '../src/main/store'
import type { Library } from '../src/shared/types'

const cue = { id: 'c1', time: 1, label: '', action: { type: 'cc', channel: 1, number: 1, value: 1 } }
const track = { id: 't1', title: 'Song', source: { kind: 'file', path: '/a/song.mp3' }, cues: [cue] }
const current = JSON.stringify({ schemaVersion: 1, leadMs: 0, tracks: [track] })
const lib: Library = { leadMs: 0, tracks: [{ ...track, cues: [{ ...cue, time: 2 }] } as Library['tracks'][number]] }

let dir: string
let clock: number
let store: LibraryStore
const file = (): string => join(dir, 'library.json')
const names = async (): Promise<string[]> => (await readdir(join(dir, 'backups'))).filter((n) => !n.startsWith('.')).sort()

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'playpal-'))
  clock = 1_700_000_000_000
  store = new LibraryStore(file(), new BackupStore(join(dir, 'backups'), () => clock++))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('backups', () => {
  it('keeps a clean library once per start, and not again while it is unchanged', async () => {
    await writeFile(file(), current)
    await store.load()
    await store.load()
    expect(await names()).toEqual([expect.stringMatching(/-startup\.json$/)])
  })

  it('keeps the previous file before the first save, then at most one copy per interval', async () => {
    await writeFile(file(), current)
    await store.save(lib)
    await store.save({ ...lib, leadMs: 5 })
    expect(await readFile(join(dir, 'backups', (await names())[0]), 'utf8')).toBe(current)
    expect(await names()).toHaveLength(1)
    clock += 11 * 60_000
    await store.save({ ...lib, leadMs: 9 })
    expect(await names()).toHaveLength(2)
  })

  it('keeps a file in an unknown shape before it is reset, and lists what is recoverable in it', async () => {
    const old = JSON.stringify({ songs: [{ name: 'x' }] })
    await writeFile(file(), old)
    const loaded = await store.load()
    expect(loaded.tracks).toEqual([])
    expect(loaded.warnings.length).toBeGreaterThan(0)
    const [info] = await store.backups.list()
    expect(info).toMatchObject({ kind: 'incompatible', tracks: 0 })
    expect(await readFile(join(dir, 'backups', `${info.id}.json`), 'utf8')).toBe(old)
  })

  it('keeps a file that is not JSON instead of leaving it to be overwritten', async () => {
    await writeFile(file(), '{"tracks": [')
    await store.load()
    expect((await store.backups.list())[0].kind).toBe('corrupt')
    await expect(readFile(file())).rejects.toThrow()
  })

  it('imports an older file into the current shape', async () => {
    await writeFile(file(), JSON.stringify({ tracks: [{ ...track, title: 'x'.repeat(300) }] }))
    const loaded = await store.load()
    expect(loaded.tracks[0].title).toHaveLength(200)
    const [info] = await store.backups.list()
    expect(info).toMatchObject({ kind: 'incompatible', tracks: 1, cues: 1 })
    expect((await store.backups.read(info.id))?.tracks).toHaveLength(1)
  })

  it('refuses ids that are not listed names', async () => {
    expect(await store.backups.read('../library')).toBeNull()
    expect(await store.backups.read(42)).toBeNull()
  })

  it('keeps the previous library when restoring over it', async () => {
    await writeFile(file(), current)
    await store.replace(lib)
    expect((await store.backups.list()).map((b) => b.kind)).toEqual(['before-restore'])
    expect(JSON.parse(await readFile(file(), 'utf8')).tracks[0].cues[0].time).toBe(2)
  })

  it('does not overwrite a library file it could not read, until a restore', async () => {
    const dirAsFile = new LibraryStore(dir, new BackupStore(join(dir, 'b2'))) // reading a directory fails with EISDIR
    const loaded = await dirAsFile.load()
    expect(loaded.warnings).toHaveLength(1)
    await expect(dirAsFile.save(lib)).rejects.toThrow(/not overwriting/)
  })

  it('keeps only the newest copies of each kind', async () => {
    await writeFile(file(), current)
    for (let i = 0; i < 25; i++) {
      await writeFile(file(), JSON.stringify({ schemaVersion: 1, leadMs: i, tracks: [track] }))
      await store.backups.keep(file(), 'auto')
    }
    expect(await names()).toHaveLength(20)
  })

  it('refuses a restore when the current library cannot be kept, and keeps what was there', async () => {
    await writeFile(file(), current)
    await writeFile(join(dir, 'backups'), 'in the way') // a file where the folder should be, so no copy can be made
    await expect(store.replace(lib)).rejects.toThrow(/nothing was replaced/)
    expect(await readFile(file(), 'utf8')).toBe(current)
  })

  it('stops saving when the original of a file it had to reset cannot be kept', async () => {
    await writeFile(file(), JSON.stringify({ songs: [] }))
    await writeFile(join(dir, 'backups'), 'in the way')
    const loaded = await store.load()
    expect(loaded.warnings.join(' ')).toContain('saving is paused')
    await expect(store.save(lib)).rejects.toThrow(/not overwriting/)
  })

  it('lists copies newest first and parses each only once', async () => {
    await writeFile(file(), current)
    await store.backups.keep(file(), 'startup')
    await writeFile(file(), JSON.stringify({ schemaVersion: 1, leadMs: 3, tracks: [] }))
    await store.backups.keep(file(), 'auto')
    const first = await store.backups.list()
    expect(first.map((b) => [b.kind, b.tracks])).toEqual([['auto', 0], ['startup', 1]])
    await rm(join(dir, 'backups', `${first[1].id}.json`))
    expect((await store.backups.list()).map((b) => b.kind)).toEqual(['auto'])
    expect(await store.backups.size()).toBe(1)
  })

  it('gives a restore its own copy even when an identical autosave exists', async () => {
    await writeFile(file(), current)
    await store.backups.keep(file(), 'auto')
    await store.replace(lib)
    expect((await store.backups.list()).map((b) => b.kind).sort()).toEqual(['auto', 'before-restore'])
  })
})
