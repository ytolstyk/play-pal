import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { emptyLibrary, parseLibraryFile } from '../shared/validation'
import type { Library, LibraryFile, LoadResult } from '../shared/types'

/** JSON persistence: atomic writes, one .bak of the previous file, corrupt files kept aside. */
export class LibraryStore {
  constructor(private readonly file: string) {}

  async load(): Promise<LoadResult> {
    let text: string
    try {
      text = await fs.readFile(this.file, 'utf8')
    } catch {
      return { ...emptyLibrary(), warnings: [] }
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      const aside = `${this.file}.corrupt`
      await fs.rename(this.file, aside).catch(() => undefined)
      return { ...emptyLibrary(), warnings: [`library file was unreadable; kept as ${aside} and reset`] }
    }
    return parseLibraryFile(raw)
  }

  async save(library: Library): Promise<void> {
    const payload: LibraryFile = { schemaVersion: 1, ...library }
    await fs.mkdir(dirname(this.file), { recursive: true })
    await fs.copyFile(this.file, `${this.file}.bak`).catch(() => undefined)
    const tmp = join(dirname(this.file), `.library.${randomUUID()}.tmp`)
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
    await fs.rename(tmp, this.file)
  }
}
