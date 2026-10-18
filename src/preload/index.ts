import { contextBridge, ipcRenderer } from 'electron'
import type { AudioFrame } from '../shared/audio'
import type { Api } from '../shared/api'
import { IPC } from '../shared/ipc'
import type { MidiStatus, PlaybackState } from '../shared/types'

/** Subscribes to a main -> renderer push and returns the unsubscribe function. */
const subscribe =
  <T>(channel: string) =>
  (cb: (payload: T) => void): (() => void) => {
    const listener = (_e: unknown, payload: T): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }

const api: Api = {
  loadLibrary: () => ipcRenderer.invoke(IPC.libraryLoad),
  saveLibrary: (library) => ipcRenderer.invoke(IPC.librarySave, library),
  listBackups: () => ipcRenderer.invoke(IPC.backupList),
  restoreBackup: (id) => ipcRenderer.invoke(IPC.backupRestore, id),
  importLibraryFile: () => ipcRenderer.invoke(IPC.backupImport),
  pickAudioFile: () => ipcRenderer.invoke(IPC.pickAudio),
  armTrack: (track) => ipcRenderer.send(IPC.arm, track),
  sendStartPreset: (trackId) => ipcRenderer.invoke(IPC.startPreset, trackId),
  setLead: (ms) => ipcRenderer.send(IPC.lead, ms),
  sendClock: (sample) => ipcRenderer.send(IPC.fileClock, sample),
  onPlayback: subscribe<PlaybackState>(IPC.playback),
  onCueFired: subscribe<string>(IPC.cueFired),
  setYtBounds: (rect) => ipcRenderer.send(IPC.ytBounds, rect),
  ytCommand: (command) => ipcRenderer.send(IPC.ytCommand, command),
  ytReturn: () => ipcRenderer.send(IPC.ytReturn),
  onAudioFrame: subscribe<AudioFrame>(IPC.audioFrame),
  loadWaveform: (trackId) => ipcRenderer.invoke(IPC.waveformLoad, trackId),
  saveWaveform: (trackId, bins) => ipcRenderer.invoke(IPC.waveformSave, trackId, bins),
  testAction: (action) => ipcRenderer.invoke(IPC.midiTest, action),
  getMidiStatus: () => ipcRenderer.invoke(IPC.midiStatus),
  onMidiStatus: subscribe<MidiStatus>(IPC.midiStatus),
  reconnect: () => ipcRenderer.invoke(IPC.midiReconnect)
}

contextBridge.exposeInMainWorld('api', api)
