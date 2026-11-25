import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { mergeMapPresets, parseNeuralMap, type MapPreset } from '../shared/neuralMap'
import { MAX_LABEL } from '../shared/types'

const MAX_PLUGINS = 50
/** Real maps are about 1 KB each, so these leave a wide margin while keeping a stray folder cheap to scan. */
const MAX_FILES_PER_PLUGIN = 20
const MAX_FILE_BYTES = 64 * 1024
const MAX_PRESETS_PER_PLUGIN = 300

const names = async (dir: string, want: 'file' | 'dir'): Promise<string[]> => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => (want === 'file' ? e.isFile() : e.isDirectory())).map((e) => e.name)
  } catch {
    return [] // a plugin that is not installed (or has no maps yet) simply has nothing to list
  }
}

/** A folder name as a menu heading: no control or line-separator characters, and a sane length. */
const displayName = (folder: string): string => folder.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '').trim().slice(0, MAX_LABEL)

async function readMap(file: string, plugin: string): Promise<MapPreset[]> {
  try {
    const { size } = await fs.stat(file)
    return size > MAX_FILE_BYTES ? [] : parseNeuralMap(await fs.readFile(file, 'utf8'), plugin)
  } catch {
    return []
  }
}

/**
 * Every CC routing found in the MIDI map files of the Neural DSP plugins under `root`
 * (`<root>/<plugin>/MIDI/*.xml`). Read-only; the renderer chooses no paths, and what cannot be read is skipped.
 */
export async function readNeuralMaps(root: string): Promise<MapPreset[]> {
  const plugins = (await names(root, 'dir')).sort().slice(0, MAX_PLUGINS)
  const found: MapPreset[] = []
  const listed = new Set<string>()
  // One file at a time: the process also fires cues, and these are a handful of tiny files.
  for (const folder of plugins) {
    const dir = join(root, folder, 'MIDI')
    const files = (await names(dir, 'file')).filter((f) => f.toLowerCase().endsWith('.xml')).sort().slice(0, MAX_FILES_PER_PLUGIN)
    const plugin = displayName(folder)
    if (!plugin || listed.has(plugin)) continue // two folders that read the same would share one heading
    listed.add(plugin)
    const lists: MapPreset[][] = []
    for (const file of files) lists.push(await readMap(join(dir, file), plugin))
    found.push(...mergeMapPresets(lists).slice(0, MAX_PRESETS_PER_PLUGIN))
  }
  return found
}
