import { useCallback, useEffect, useState } from 'react'
import type { Track } from '../../shared/types'
import { Player } from './components/Player'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { useLibrary } from './hooks/useLibrary'
import { useMidiStatus } from './hooks/useMidiStatus'

export function App(): React.JSX.Element {
  const { library, warnings, saveError, update } = useLibrary()
  const midi = useMidiStatus()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const track = library?.tracks.find((t) => t.id === selectedId) ?? null

  // Cues fire from what's on screen, whether or not it has been saved yet.
  useEffect(() => {
    window.api.armTrack(track ?? null)
  }, [track])

  // Main serves a file track's audio from the saved library, so adding waits for the save.
  const addTrack = useCallback(
    async (t: Track) => {
      if (await update((lib) => ({ ...lib, tracks: [...lib.tracks, t] }), true)) setSelectedId(t.id)
    },
    [update]
  )

  const deleteTrack = useCallback(
    (id: string) => {
      setSelectedId(null)
      void update((lib) => ({ ...lib, tracks: lib.tracks.filter((t) => t.id !== id) }), true)
    },
    [update]
  )

  const changeTrack = useCallback(
    (change: (t: Track) => Track) => {
      if (!selectedId) return
      void update((lib) => ({ ...lib, tracks: lib.tracks.map((t) => (t.id === selectedId ? change(t) : t)) }))
    },
    [selectedId, update]
  )

  if (!library) return <div className="loading muted">Loading…</div>

  const messages = [...warnings, ...(saveError ? [`Not saved: ${saveError}`] : [])]
  return (
    <div className="app">
      <div className="body">
        <Sidebar
          tracks={library.tracks}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAdd={(t) => void addTrack(t)}
          onDelete={deleteTrack}
        />
        <main>
          {track ? (
            <Player key={track.id} track={track} onChange={changeTrack} />
          ) : (
            <p className="muted empty">Add a local file or paste a YouTube Music link to get started.</p>
          )}
        </main>
      </div>
      <StatusBar
        midi={midi}
        leadMs={library.leadMs}
        messages={messages}
        onLeadChange={(ms) => {
          window.api.setLead(ms)
          void update((lib) => ({ ...lib, leadMs: ms }), true)
        }}
      />
    </div>
  )
}
