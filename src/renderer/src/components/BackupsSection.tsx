import { useCallback, useEffect, useState } from 'react'
import type { BackupInfo, BackupKind, RestoreResult } from '../../../shared/types'
import type { LibraryApi } from '../hooks/useLibrary'

interface Props {
  replace: LibraryApi['replace']
}

const KIND_LABEL: Record<BackupKind, string> = {
  auto: 'Autosave',
  startup: 'App start',
  'before-restore': 'Before a restore',
  incompatible: 'Old or damaged format',
  corrupt: 'Unreadable file'
}
const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`
const dateTime = new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' })

function describe(r: RestoreResult): string {
  if (!r.ok) return `Not restored: ${r.errors.join('; ')}`
  const notes = r.warnings.length > 0 ? ` (${r.warnings.join('; ')})` : ''
  return `Restored ${plural(r.tracks, 'track')}${notes}`
}

/** Dated copies of the library: pick one to go back to, or import a library file of any age. */
export function BackupsSection({ replace }: Props): React.JSX.Element {
  const [backups, setBackups] = useState<BackupInfo[] | null>(null)
  // Restoring replaces the whole library, so it takes a second click on the same row.
  const [confirming, setConfirming] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => void window.api.listBackups().then(setBackups, () => setBackups([])), [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const run = useCallback(
    async (job: () => Promise<RestoreResult | null>) => {
      setConfirming(null)
      setBusy(true)
      try {
        const result = await replace(job)
        if (result) setStatus(describe(result))
      } finally {
        setBusy(false)
        refresh()
      }
    },
    [replace, refresh]
  )

  return (
    <>
      <h3 className="muted small">Backups</h3>
      <div className="backups">
        {backups === null ? null : backups.length === 0 ? (
          <p className="muted small">None yet. A copy is kept at each start and as you edit.</p>
        ) : (
          <ul>
            {backups.map((b) => (
              <li key={b.id}>
                <span>
                  {dateTime.format(b.savedAt)}
                  <span className="muted small">
                    {' '}
                    {KIND_LABEL[b.kind]} · {plural(b.tracks, 'track')}, {plural(b.cues, 'cue')}
                  </span>
                </span>
                <button
                  className="small"
                  disabled={busy || b.tracks === 0}
                  onBlur={() => setConfirming(null)}
                  onClick={() => (confirming === b.id ? void run(() => window.api.restoreBackup(b.id)) : setConfirming(b.id))}
                >
                  {confirming === b.id ? 'Replace library?' : 'Restore'}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="small" disabled={busy} onClick={() => void run(() => window.api.importLibraryFile())}>
          Import a library file…
        </button>
        {status && <p className="muted small" role="status">{status}</p>}
      </div>
    </>
  )
}
