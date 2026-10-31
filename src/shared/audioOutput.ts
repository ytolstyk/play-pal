import { MAX_DEVICE_LABEL } from './types'

/** The parts of a MediaDeviceInfo the output picker uses. */
export interface DeviceInfo {
  kind: string
  deviceId: string
  label: string
}

export interface OutputDevice {
  id: string
  label: string
}

/** Chromium's aliases for whatever the system default currently is; offered as the single "System default" entry instead. */
const ALIAS_IDS = new Set(['default', 'communications'])

/** Named output devices a user can pick (unnamed ones, e.g. when labels are hidden, cannot be told apart or remembered; over-long names cannot be sent to the page). */
export function selectableOutputs(devices: readonly DeviceInfo[]): OutputDevice[] {
  return devices
    .filter((d) => d.kind === 'audiooutput' && d.label && d.label.length <= MAX_DEVICE_LABEL && !ALIAS_IDS.has(d.deviceId))
    .map((d) => ({ id: d.deviceId, label: d.label }))
}

/** Id of the connected device with this name; '' (the system default) for no name or a device that is not connected. */
export function outputIdFor(devices: readonly OutputDevice[], label: string): string {
  return (label && devices.find((d) => d.label === label)?.id) || ''
}

export const sameOutputs = (a: readonly OutputDevice[], b: readonly OutputDevice[]): boolean =>
  a.length === b.length && a.every((d, i) => d.id === b[i].id && d.label === b[i].label)
