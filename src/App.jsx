import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { supabase } from './lib/supabase'

const TURN_OPTIONS = [45, 60, 75, 90, 105, 120]
const BLIND_OPTIONS = [
  { label: '1 / 1', sb: 1, bb: 1 },
  { label: '1 / 2', sb: 1, bb: 2 },
]
const MAX_PLAYERS = 8

function getSessionId() {
  const key = 'cards_session_id'
  let sid = localStorage.getItem(key)
  if (!sid) {
    sid = crypto.randomUUID()
    localStorage.setItem(key, sid)
  }
  return sid
}

function nextOccupiedSeat(fromSeat, occupiedSeats) {
  const sorted = [...occupiedSeats].sort((a, b) => a - b)
  for (const seat of sorted) {
    if (seat > fromSeat) return seat
  }
  return sorted[0]
}

function App() {
  const [username, setUsername] = useState('')
  const [joined, setJoined] = useState(false)
  const [players, setPlayers] = useState([])
  const [settings, setSettings] = useState({ small_blind: 1, big_blind: 2, turn_seconds: 60 })
  const [gameState, setGameState] = useState({ hand_no: 0, phase: 'waiting', dealer_seat: null, current_turn_session_id: null, pot: 0 })
  const [countdown, setCountdown] = useState(null)
  const [error, setError] = useState('')

  const sessionId = useMemo(() => getSessionId(), [])

  const refreshAll = async () => {
    const [playersRes, settingsRes, gameRes] = await Promise.all([
      supabase.from('lobby_players').select('*').order('seat_no', { ascending: true }),
      supabase.from('table_settings').select('*').eq('id', 1).single(),
      supabase.from('game_state').select('*').eq('id', 1).single(),
    ])

    if (playersRes.error) throw playersRes.error
    if (settingsRes.error) throw settingsRes.error
    if (gameRes.error) throw gameRes.error

    setPlayers(playersRes.data || [])
    setSettings(settingsRes.data)
    setGameState(gameRes.data)
  }

  const assignOpenSeat = (currentPlayers) => {
    const used = new Set(currentPlayers.map((p) => p.seat_no).filter((v) => v !== null))
    for (let i = 1; i <= MAX_PLAYERS; i += 1) {
      if (!used.has(i)) return i
    }
    return null
  }

  const joinLobby = async () => {
    setError('')
    if (!username.trim()) {
      setError('Username is required.')
      return
    }

    const { data: currentPlayers, error: currentErr } = await supabase.from('lobby_players').select('*')
    if (currentErr) return setError(currentErr.message)

    const seatNo = assignOpenSeat(currentPlayers || [])
    if (!seatNo) {
      setError('Lobby is full (8/8).')
      return
    }

    const { error: upsertError } = await supabase.from('lobby_players').upsert(
      {
        session_id: sessionId,
        username: username.trim(),
        seat_no: seatNo,
        heartbeat_at: new Date().toISOString(),
      },
      { onConflict: 'session_id' },
    )

    if (upsertError) return setError(upsertError.message)

    setJoined(true)
    await refreshAll()
  }

  const leaveLobby = async () => {
    await supabase.from('lobby_players').delete().eq('session_id', sessionId)
    setJoined(false)
    await refreshAll()
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

  const logAction = async (action, payload = {}) => {
    const actor = players.find((p) => p.session_id === sessionId)
    await supabase.from('hand_actions').insert({
      actor_session_id: sessionId,
      actor_username: actor?.username || null,
      action,
      payload,
    })
  }

  const startHand = async () => {
    const seated = players.filter((p) => p.seat_no !== null)
    if (seated.length < 2) {
      setError('Need at least 2 players to start hand.')
      return
    }

    const occupiedSeats = seated.map((p) => p.seat_no)
    const dealerSeat = gameState.dealer_seat
      ? nextOccupiedSeat(gameState.dealer_seat, occupiedSeats)
      : Math.min(...occupiedSeats)

    const sbSeat = nextOccupiedSeat(dealerSeat, occupiedSeats)
    const bbSeat = nextOccupiedSeat(sbSeat, occupiedSeats)
    const turnSeat = nextOccupiedSeat(bbSeat, occupiedSeats)

    const sbPlayer = seated.find((p) => p.seat_no === sbSeat)
    const bbPlayer = seated.find((p) => p.seat_no === bbSeat)
    const turnPlayer = seated.find((p) => p.seat_no === turnSeat)

    const pot = settings.small_blind + settings.big_blind

    await supabase
      .from('game_state')
      .update({
        hand_no: (gameState.hand_no || 0) + 1,
        phase: 'preflop',
        dealer_seat: dealerSeat,
        current_turn_session_id: turnPlayer.session_id,
        pot,
        last_action_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)

    await logAction('start_hand', {
      dealerSeat,
      smallBlind: { seat: sbSeat, username: sbPlayer?.username, amount: settings.small_blind },
      bigBlind: { seat: bbSeat, username: bbPlayer?.username, amount: settings.big_blind },
      firstToAct: { seat: turnSeat, username: turnPlayer?.username },
      pot,
    })
  }

  const endTurn = async () => {
    if (!gameState.current_turn_session_id) return

    const seated = players.filter((p) => p.seat_no !== null)
    const current = seated.find((p) => p.session_id === gameState.current_turn_session_id)
    if (!current) return

    const nextSeat = nextOccupiedSeat(current.seat_no, seated.map((p) => p.seat_no))
    const nextPlayer = seated.find((p) => p.seat_no === nextSeat)

    await supabase
      .from('game_state')
      .update({
        current_turn_session_id: nextPlayer.session_id,
        last_action_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)

    await logAction('end_turn', {
      from: current.username,
      to: nextPlayer.username,
      nextSeat,
    })
  }

  useEffect(() => {
    refreshAll().catch((e) => setError(e.message))

    const channel = supabase
      .channel('cards-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_players' }, refreshAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_settings' }, refreshAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, refreshAll)
      .subscribe()

    const heartbeatTimer = setInterval(async () => {
      if (!joined) return
      await supabase
        .from('lobby_players')
        .update({ heartbeat_at: new Date().toISOString() })
        .eq('session_id', sessionId)
    }, 15000)

    return () => {
      clearInterval(heartbeatTimer)
      supabase.removeChannel(channel)
    }
  }, [joined])

  useEffect(() => {
    if (!gameState.last_action_at || gameState.phase === 'waiting') {
      setCountdown(null)
      return
    }

    const tick = () => {
      const last = new Date(gameState.last_action_at).getTime()
      const elapsedSec = Math.floor((Date.now() - last) / 1000)
      const remaining = Math.max(0, settings.turn_seconds - elapsedSec)
      setCountdown(remaining)
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [gameState.last_action_at, gameState.phase, settings.turn_seconds])

  const myTurn = gameState.current_turn_session_id === sessionId

  return (
    <div className="app">
      <header>
        <h1>Cards — Texas Hold’em MVP</h1>
        <p>Realtime lobby + first hand lifecycle wiring is now in progress.</p>
      </header>

      {error && <div className="error">{error}</div>}

      <section>
        <h2>Join Lobby</h2>
        {!joined ? (
          <div className="row">
            <input placeholder="Enter username" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={20} />
            <button onClick={joinLobby}>Join Lobby</button>
          </div>
        ) : (
          <div className="row">
            <span>
              Joined as: <strong>{username}</strong>
            </span>
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
          <strong>
            Current: {settings.small_blind}/{settings.big_blind}
          </strong>
        </div>
        <div className="row wrap">
          <span>Turn timer:</span>
          {TURN_OPTIONS.map((t) => (
            <button key={t} onClick={() => setTurnSeconds(t)}>
              {t}s
            </button>
          ))}
          <strong>Current: {settings.turn_seconds}s</strong>
        </div>
      </section>

      <section>
        <h2>Players ({players.length}/8)</h2>
        <ul>
          {players.map((p) => (
            <li key={p.id}>
              Seat {p.seat_no}: {p.username} — stack {p.stack}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Hand State</h2>
        <div className="row wrap">
          <strong>Hand #{gameState.hand_no || 0}</strong>
          <span>Phase: {gameState.phase}</span>
          <span>Dealer seat: {gameState.dealer_seat ?? '-'}</span>
          <span>Pot: {gameState.pot ?? 0}</span>
          <span>Timer: {countdown ?? '-'}s</span>
          <span>{myTurn ? '✅ Your turn' : '⏳ Waiting'}</span>
        </div>
        <div className="row wrap" style={{ marginTop: 10 }}>
          <button onClick={startHand}>Start New Hand</button>
          <button onClick={endTurn} disabled={!myTurn}>
            End Turn (test)
          </button>
        </div>
      </section>
    </div>
  )
}

export default App
