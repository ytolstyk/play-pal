import { useState } from 'react'
import type { Track } from '../../../shared/types'
import { parseVideoId } from '../../../shared/url'

interface Props {
  tracks: Track[]
  selectedId: string | null
  onSelect(id: string): void
  onAdd(track: Track): void
  onDelete(id: string): void
}

const baseName = (path: string): string => (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, '')

export function Sidebar({ tracks, selectedId, onSelect, onAdd, onDelete }: Props): React.JSX.Element {
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const addFile = async (): Promise<void> => {
    const path = await window.api.pickAudioFile()
    if (path) onAdd({ id: crypto.randomUUID(), title: baseName(path), source: { kind: 'file', path }, cues: [] })
  }

  const addLink = (): void => {
    const videoId = parseVideoId(link)
    if (!videoId) {
      setLinkError('Paste a music.youtube.com or youtube.com watch link')
      return
    }
    setLinkError(null)
    setLink('')
    onAdd({
      id: crypto.randomUUID(),
      title: `YouTube Music ${videoId}`,
      source: { kind: 'ytmusic', videoId },
      cues: []
    })
  }

  return (
    <aside className="sidebar">
      <div className="add">
        <button onClick={() => void addFile()}>+ Local file</button>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            addLink()
          }}
        >
          <input
            value={link}
            placeholder="Paste a YouTube Music link"
            onChange={(e) => setLink(e.target.value)}
            aria-label="YouTube Music link"
          />
          <button type="submit" disabled={link.trim() === ''}>
            Add
          </button>
        </form>
        {linkError && <p className="error small">{linkError}</p>}
      </div>
      <ul className="tracks">
        {tracks.length === 0 && <li className="muted small empty">No tracks yet.</li>}
        {tracks.map((t) => (
          <li key={t.id} className={t.id === selectedId ? 'selected' : undefined}>
            <button className="track" onClick={() => onSelect(t.id)}>
              <span className="title">{t.title || 'Untitled'}</span>
              <span className="meta muted small">
                {t.source.kind === 'file' ? 'file' : 'YT Music'} · {t.cues.length} cue{t.cues.length === 1 ? '' : 's'}
              </span>
            </button>
            {t.id === selectedId && (
              <button
                className="ghost small"
                onClick={() => {
                  if (confirmDeleteId === t.id) {
                    setConfirmDeleteId(null)
                    onDelete(t.id)
                  } else setConfirmDeleteId(t.id)
                }}
                onBlur={() => setConfirmDeleteId(null)}
              >
                {confirmDeleteId === t.id ? 'Really delete?' : 'Delete'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  )
}
