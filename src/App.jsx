import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { supabase } from './lib/supabase'

const TURN_OPTIONS = [45, 60, 75, 90, 105, 120]
const BLIND_OPTIONS = [
  { label: '1 / 1', sb: 1, bb: 1 },
  { label: '1 / 2', sb: 1, bb: 2 },
]

function getSessionId() {
  const key = 'cards_session_id'
  let sid = localStorage.getItem(key)
  if (!sid) {
    sid = crypto.randomUUID()
    localStorage.setItem(key, sid)
  }
  return sid
}

function App() {
  const [username, setUsername] = useState('')
  const [joined, setJoined] = useState(false)
  const [players, setPlayers] = useState([])
  const [settings, setSettings] = useState({ small_blind: 1, big_blind: 2, turn_seconds: 60 })
  const [error, setError] = useState('')

  const sessionId = useMemo(() => getSessionId(), [])

  const refreshLobby = async () => {
    const [playersRes, settingsRes] = await Promise.all([
      supabase.from('lobby_players').select('*').order('joined_at', { ascending: true }),
      supabase.from('table_settings').select('*').eq('id', 1).single(),
    ])

    if (playersRes.error) throw playersRes.error
    if (settingsRes.error) throw settingsRes.error

    setPlayers(playersRes.data || [])
    setSettings(settingsRes.data)
  }

  const joinLobby = async () => {
    setError('')
    if (!username.trim()) {
      setError('Username is required.')
      return
    }

    const { error: upsertError } = await supabase.from('lobby_players').upsert(
      {
        session_id: sessionId,
        username: username.trim(),
        heartbeat_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' },
    )

    if (upsertError) {
      setError(upsertError.message)
      return
    }

    setJoined(true)
    await refreshLobby()
  }

  const leaveLobby = async () => {
    await supabase.from('lobby_players').delete().eq('session_id', sessionId)
    setJoined(false)
    await refreshLobby()
  }

  const updateHeartbeat = async () => {
    if (!joined) return
    await supabase
      .from('lobby_players')
      .update({ heartbeat_at: new Date().toISOString() })
      .eq('session_id', sessionId)
  }

  const setBlinds = async (sb, bb) => {
    await supabase
      .from('table_settings')
      .update({ small_blind: sb, big_blind: bb, updated_at: new Date().toISOString() })
      .eq('id', 1)
  }

  const setTurnSeconds = async (seconds) => {
    await supabase
      .from('table_settings')
      .update({ turn_seconds: seconds, updated_at: new Date().toISOString() })
      .eq('id', 1)
  }

  useEffect(() => {
    refreshLobby().catch((e) => setError(e.message))

    const channel = supabase
      .channel('cards-lobby')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_players' }, () => {
        refreshLobby().catch((e) => setError(e.message))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_settings' }, () => {
        refreshLobby().catch((e) => setError(e.message))
      })
      .subscribe()

    const timer = setInterval(() => {
      updateHeartbeat()
    }, 15000)

    return () => {
      clearInterval(timer)
      supabase.removeChannel(channel)
    }
  }, [joined])

  return (
    <div className="app">
      <header>
        <h1>Cards — Texas Hold’em MVP</h1>
        <p>Realtime lobby is live. Next: betting/hand engine.</p>
      </header>

      {error && <div className="error">{error}</div>}

      <section>
        <h2>Join Lobby</h2>
        {!joined ? (
          <div className="row">
            <input
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={20}
            />
            <button onClick={joinLobby}>Join Lobby</button>
          </div>
        ) : (
          <div className="row">
            <span>Joined as: <strong>{username}</strong></span>
            <button onClick={leaveLobby}>Leave</button>
          </div>
        )}
      </section>

      <section>
        <h2>Table Settings (shared)</h2>
        <div className="row wrap">
          <span>Blinds:</span>
          {BLIND_OPTIONS.map((b) => (
            <button key={b.label} onClick={() => setBlinds(b.sb, b.bb)}>
              {b.label}
            </button>
          ))}
          <strong>Current: {settings.small_blind}/{settings.big_blind}</strong>
        </div>
        <div className="row wrap">
          <span>Turn timer:</span>
          {TURN_OPTIONS.map((t) => (
            <button key={t} onClick={() => setTurnSeconds(t)}>{t}s</button>
          ))}
          <strong>Current: {settings.turn_seconds}s</strong>
        </div>
      </section>

      <section>
        <h2>Players in Lobby ({players.length}/8)</h2>
        <ul>
          {players.map((p) => (
            <li key={p.id}>{p.username} — stack {p.stack}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Supabase setup checklist</h2>
        <ol>
          <li>Run <code>supabase/schema.sql</code> in SQL Editor.</li>
          <li>Enable Realtime for <code>lobby_players</code> and <code>table_settings</code>.</li>
          <li>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code>.</li>
        </ol>
      </section>
    </div>
  )
}

export default App
