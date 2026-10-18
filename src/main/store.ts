import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseLibraryFile } from '../shared/libraryImport'
import { emptyLibrary } from '../shared/validation'
import { SCHEMA_VERSION, type Library, type LibraryFile, type LoadResult } from '../shared/types'
import type { BackupStore } from './backups'

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * JSON persistence: atomic writes, one .bak of the previous file, and dated copies in `backups`
 * (see BackupStore). A file that did not load cleanly is copied there before anything can
 * replace it; if that copy fails, saving stops rather than replace the only one.
 */
export class LibraryStore {
  /**
   * Why saving is stopped, if it is: the file exists but could not be read ('unreadable'), or
   * could not be copied aside before being reset ('uncopied'). Saving would replace the real
   * library with what the app shows instead.
   */
  private blockedBy: 'unreadable' | 'uncopied' | null = null

  constructor(
    private readonly file: string,
    readonly backups: BackupStore
  ) {}

  async load(): Promise<LoadResult> {
    let text: string
    try {
      text = await fs.readFile(this.file, 'utf8')
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'ENOENT' ? this.missing() : this.pause('unreadable', 'library file could not be read')
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return this.setAsideCorrupt()
    }
    const result = parseLibraryFile(raw)
    if (result.warnings.length === 0) {
      await this.backups.keep(this.file, 'startup')
      return result
    }
    if ((await this.backups.keep(this.file, 'incompatible')) === 'failed') {
      return this.pause('uncopied', 'the original file could not be copied aside', result.warnings)
    }
    this.blockedBy = null
    result.warnings.push('the original file was kept; see Backups in Settings')
    return result
  }

  private async missing(): Promise<LoadResult> {
    this.blockedBy = null
    const kept = await this.backups.size()
    return { ...emptyLibrary(), warnings: kept > 0 ? [`no library file found; ${plural(kept, 'backup')} can be restored in Settings`] : [] }
  }

  /** An empty library for the app to show, with saving stopped so it cannot replace the real file. */
  private pause(by: 'unreadable' | 'uncopied', why: string, earlier: string[] = []): LoadResult {
    this.blockedBy = by
    return { ...emptyLibrary(), warnings: [...earlier, `${why}; saving is paused so it is not overwritten`] }
  }

  private async setAsideCorrupt(): Promise<LoadResult> {
    // Out of the way so the next save does not overwrite it; the .corrupt name is the fallback if the copy fails.
    this.blockedBy = null
    if ((await this.backups.keep(this.file, 'corrupt')) === 'kept') await fs.unlink(this.file).catch(() => undefined)
    else if (!(await fs.rename(this.file, `${this.file}.corrupt`).then(() => true, () => false))) {
      return this.pause('uncopied', 'library file was unreadable and could not be set aside')
    }
    return { ...emptyLibrary(), warnings: ['library file was unreadable; kept as a backup and reset'] }
  }

  async save(library: Library): Promise<void> {
    if (this.blockedBy) throw new Error('library file could not be read at startup; not overwriting it (restore a backup in Settings)')
    await this.write(library)
  }

  /**
   * Writes a library the user chose from a backup or a file. What is there now is kept first and
   * the restore is refused if that fails.
   */
  async replace(library: Library): Promise<void> {
    const kept = await this.backups.keep(this.file, 'before-restore')
    // A file that could not be read cannot be copied either, and restoring is the way out of that state.
    if (kept === 'failed' && this.blockedBy !== 'unreadable') throw new Error('could not keep a copy of the current library, so nothing was replaced')
    await this.write(library)
    this.blockedBy = null
  }

  private async write(library: Library): Promise<void> {
    await this.backups.beforeSave(this.file)
    const payload: LibraryFile = { schemaVersion: SCHEMA_VERSION, ...library }
    await fs.mkdir(dirname(this.file), { recursive: true })
    await fs.copyFile(this.file, `${this.file}.bak`).catch(() => undefined)
    const tmp = join(dirname(this.file), `.library.${randomUUID()}.tmp`)
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
    await fs.rename(tmp, this.file)
  }
}
