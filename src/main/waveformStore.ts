import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { decodeWaveFile, encodeWaveFile, isWaveBins } from '../shared/waveform'
import { isTrackId } from '../shared/validation'

const EXT = '.wave'
const TMP_EXT = '.tmp'

/**
 * One file per track (see shared/waveform.ts), kept beside library.json so the library stays small and
 * a cue edit never rewrites it. It is only a display cache: anything unreadable, or in an older format,
 * reads as "not recorded".
 */
export class WaveformStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    return join(this.dir, `${id}${EXT}`)
  }

  async load(id: string): Promise<Uint8Array | null> {
    if (!isTrackId(id)) return null
    try {
      const bins = decodeWaveFile(await fs.readFile(this.file(id)))
      return bins && new Uint8Array(bins) // not a view of the read buffer, which IPC would copy whole
    } catch {
      return null
    }
  }

  async save(id: string, bins: Uint8Array): Promise<void> {
    if (!isTrackId(id) || !isWaveBins(bins)) throw new Error(`invalid waveform for track ${id}: ${bins.length} bytes`)
    await fs.mkdir(this.dir, { recursive: true })
    const tmp = join(this.dir, `.${id}.${randomUUID()}${TMP_EXT}`)
    try {
      await fs.writeFile(tmp, encodeWaveFile(bins))
      await fs.rename(tmp, this.file(id))
    } catch (err) {
      await fs.unlink(tmp).catch(() => undefined)
      throw err
    }
  }

  /** Deletes the waveforms of tracks no longer in the library, and leftovers of interrupted writes. */
  async prune(keep: ReadonlySet<string>): Promise<void> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[])
    await Promise.all(
      names
        .filter((n) => (n.endsWith(EXT) && !keep.has(n.slice(0, -EXT.length))) || n.endsWith(TMP_EXT))
        .map((n) => fs.unlink(join(this.dir, n)).catch(() => undefined))
    )
  }
}
