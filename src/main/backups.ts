import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { importLibrary } from '../shared/libraryImport'
import { BACKUP_KINDS, type BackupInfo, type BackupKind, type LoadResult } from '../shared/types'

/** Milliseconds since the epoch have 13 digits until 2286, which also makes names sort by time. */
const NAME = new RegExp(`^library-(\\d{13})-(${BACKUP_KINDS.join('|')})$`)
const EXT = '.json'
/** Longest a file may be to be read back as a library (the library itself stays far below this). */
export const MAX_LIBRARY_FILE_BYTES = 10 * 1024 * 1024
/** Edits within this long of the last automatic copy do not make another. */
const AUTO_INTERVAL_MS = 10 * 60_000
/** Copies kept per kind (about 80 files at most), so a run of automatic ones can never push out a file that failed to load. */
const KEEP: Record<BackupKind, number> = { auto: 20, startup: 10, 'before-restore': 10, incompatible: 20, corrupt: 20 }

/** Reads a library file of any age (see importLibrary); null if it is missing, too big, not JSON or not a library. */
export async function readLibraryFile(path: string): Promise<LoadResult | null> {
  try {
    if ((await fs.stat(path)).size > MAX_LIBRARY_FILE_BYTES) return null
    return importLibrary(JSON.parse(await fs.readFile(path, 'utf8')))
  } catch {
    return null
  }
}

function parseId(id: unknown): { savedAt: number; kind: BackupKind } | null {
  const m = typeof id === 'string' ? NAME.exec(id) : null
  return m ? { savedAt: Number(m[1]), kind: m[2] as BackupKind } : null
}

const ROUTINE: readonly BackupKind[] = ['auto', 'startup']
/**
 * Whether an identical newest copy of kind `existing` already covers a request for `wanted`.
 * A routine request (autosave, app start) is covered by any; the rest always get a copy of
 * their own unless the newest is that very kind, so their quota and label hold.
 */
const covers = (existing: BackupKind | undefined, wanted: BackupKind): boolean =>
  existing !== undefined && (existing === wanted || ROUTINE.includes(wanted))

const count = (r: LoadResult | null): Pick<BackupInfo, 'tracks' | 'cues'> => ({
  tracks: r?.tracks.length ?? 0,
  cues: r?.tracks.reduce((sum, t) => sum + t.cues.length, 0) ?? 0
})

/**
 * Dated copies of library.json, so a bad edit, a reset or a format change never loses the
 * previous state. Copies are made when the app starts, now and then while saving, before a file
 * that did not load cleanly can be replaced, and before a restore. Nothing here ever throws into
 * the caller's save: a failed backup must not stop the library being saved.
 */
export class BackupStore {
  private lastAutoAt = 0
  private listing: Promise<BackupInfo[]> | null = null
  /** What each copy holds. A copy never changes once written, so it is parsed once. */
  private readonly counts = new Map<string, Pick<BackupInfo, 'tracks' | 'cues'>>()

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now
  ) {}

  private path(id: string): string {
    return join(this.dir, `${id}${EXT}`)
  }

  private async ids(): Promise<string[]> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[])
    return names
      .filter((n) => n.endsWith(EXT))
      .map((n) => n.slice(0, -EXT.length))
      .filter((id) => parseId(id))
      .sort()
      .reverse() // newest first
  }

  /** How many copies there are (no parsing). */
  async size(): Promise<number> {
    return (await this.ids()).length
  }

  /**
   * Copies `file` in as a backup of `kind`: 'kept' once it is safely held (also when the newest
   * copy is already identical), 'nothing' if there is no file to copy, 'failed' if it could not be.
   */
  async keep(file: string, kind: BackupKind): Promise<'kept' | 'nothing' | 'failed'> {
    let bytes: Buffer
    try {
      bytes = await fs.readFile(file)
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'nothing' : 'failed'
    }
    try {
      const ids = await this.ids()
      const previous = ids[0] && covers(parseId(ids[0])?.kind, kind) ? await fs.readFile(this.path(ids[0])).catch(() => null) : null
      if (previous?.equals(bytes)) return 'kept'
      await fs.mkdir(this.dir, { recursive: true })
      const id = `library-${this.now()}-${kind}`
      const tmp = join(this.dir, `.${id}.tmp`)
      try {
        await fs.writeFile(tmp, bytes)
        await fs.rename(tmp, this.path(id))
      } catch (err) {
        await fs.unlink(tmp).catch(() => undefined)
        throw err
      }
      await this.prune([id, ...ids])
      return 'kept'
    } catch (err) {
      console.warn('could not back up the library file:', err)
      return 'failed'
    }
  }

  /** Called before library.json is overwritten: keeps what is there, at most once per AUTO_INTERVAL_MS. */
  async beforeSave(file: string): Promise<void> {
    if (this.now() - this.lastAutoAt < AUTO_INTERVAL_MS) return
    if ((await this.keep(file, 'auto')) !== 'failed') this.lastAutoAt = this.now()
  }

  /** Newest first. Each copy is parsed once, one at a time, so this never holds up the cue scheduler for long. */
  list(): Promise<BackupInfo[]> {
    return (this.listing ??= this.build().finally(() => (this.listing = null)))
  }

  private async build(): Promise<BackupInfo[]> {
    const ids = await this.ids()
    const out: BackupInfo[] = []
    for (const id of ids) {
      let held = this.counts.get(id)
      if (!held) {
        const read = await readLibraryFile(this.path(id))
        held = count(read)
        if (read) this.counts.set(id, held) // an unreadable copy is tried again next time, not written off
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      out.push({ id, ...(parseId(id) as NonNullable<ReturnType<typeof parseId>>), ...held })
    }
    for (const id of this.counts.keys()) if (!ids.includes(id)) this.counts.delete(id)
    return out
  }

  /** What a backup holds, read leniently. Null for an unknown id (only ids from `list` are accepted) or an unreadable file. */
  async read(id: unknown): Promise<LoadResult | null> {
    return typeof id === 'string' && parseId(id) ? readLibraryFile(this.path(id)) : null
  }

  /** `ids` is every copy, newest first. */
  private async prune(ids: string[]): Promise<void> {
    const seen: Partial<Record<BackupKind, number>> = {}
    for (const id of ids) {
      const { kind } = parseId(id) as NonNullable<ReturnType<typeof parseId>>
      seen[kind] = (seen[kind] ?? 0) + 1
      if (seen[kind] > KEEP[kind]) await fs.unlink(this.path(id)).catch(() => undefined)
    }
  }
}
