import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { supabase, supabaseConfigError } from './lib/supabase'
import { runShowdown } from './lib/showdown'

const TURN_OPTIONS = [45, 60, 75, 90, 105, 120]
const BLIND_OPTIONS = [
  { label: '1 / 1', sb: 1, bb: 1 },
  { label: '1 / 2', sb: 1, bb: 2 },
]
const MAX_PLAYERS = 8

// Clockwise: 3 top, 1 right, 3 bottom, 1 left
const SEAT_POSITIONS = [
  { top: '9%',  left: '22%' },  // 1 top-left
  { top: '3%',  left: '50%' },  // 2 top-center
  { top: '9%',  left: '78%' },  // 3 top-right
  { top: '50%', left: '95%' },  // 4 right
  { top: '89%', left: '78%' },  // 5 bottom-right
  { top: '95%', left: '50%' },  // 6 bottom-center
  { top: '89%', left: '22%' },  // 7 bottom-left
  { top: '50%', left: '5%' },   // 8 left
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

function nextOccupiedSeat(fromSeat, occupiedSeats) {
  const sorted = [...occupiedSeats].sort((a, b) => a - b)
  for (const seat of sorted) {
    if (seat > fromSeat) return seat
  }
  return sorted[0]
}

function parseCardList(text) {
  return text
    .split(/[,\s]+/)
    .map((c) => c.trim())
    .filter(Boolean)
}

function createShuffledDeck() {
  const ranks = '23456789TJQKA'.split('')
  const suits = 'CDHS'.split('')
  const deck = []
  for (const r of ranks) {
    for (const s of suits) deck.push(`${r}${s}`)
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

function App() {
  const [username, setUsername] = useState('')
  const [joined, setJoined] = useState(false)
  const [players, setPlayers] = useState([])
  const [settings, setSettings] = useState({ small_blind: 1, big_blind: 2, turn_seconds: 60 })
  const [gameState, setGameState] = useState({ hand_no: 0, phase: 'waiting', dealer_seat: null, current_turn_session_id: null, pot: 0, hand_state: {} })
  const [countdown, setCountdown] = useState(null)
  const [error, setError] = useState('')
  const [showdownResult, setShowdownResult] = useState(null)
  const [raiseTo, setRaiseTo] = useState('')
  const [boardInput, setBoardInput] = useState('')

  const sessionId = useMemo(() => getSessionId(), [])

  if (supabaseConfigError || !supabase) {
    return (
      <div className="app">
        <header>
          <h1>Cards - Texas Hold'em MVP</h1>
          <p>Supabase config is missing in this deployed build.</p>
        </header>
        <div className="error">{supabaseConfigError || 'Supabase client failed to initialize.'}</div>
      </div>
    )
  }

  const seatedPlayers = players.filter((p) => p.seat_no !== null).sort((a, b) => a.seat_no - b.seat_no)
  const hand = gameState.hand_state || {}
  const handPlayers = hand.playersBySession || {}

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
    for (let i = 1; i <= MAX_PLAYERS; i += 1) if (!used.has(i)) return i
    return null
  }

  const joinLobby = async () => {
    setError('')
    if (!username.trim()) return setError('Username is required.')

    const { data: currentPlayers, error: currentErr } = await supabase.from('lobby_players').select('*')
    if (currentErr) return setError(currentErr.message)

    const seatNo = assignOpenSeat(currentPlayers || [])
    if (!seatNo) return setError('Lobby is full (8/8).')

    const { error: upsertError } = await supabase.from('lobby_players').upsert(
      { session_id: sessionId, username: username.trim(), seat_no: seatNo, heartbeat_at: new Date().toISOString() },
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
    await supabase.from('table_settings').update({ small_blind: sb, big_blind: bb, updated_at: new Date().toISOString() }).eq('id', 1)
  }

  const setTurnSeconds = async (seconds) => {
    await supabase.from('table_settings').update({ turn_seconds: seconds, updated_at: new Date().toISOString() }).eq('id', 1)
  }

  const saveGame = async (next) => {
    const { error: updateError } = await supabase
      .from('game_state')
      .update({
        phase: next.street || gameState.phase,
        current_turn_session_id: next.actingSessionId || null,
        pot: next.pot || 0,
        hand_state: next,
        last_action_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', 1)

    if (updateError) setError(updateError.message)
  }

  const startHand = async () => {
    if (seatedPlayers.length < 2) return setError('Need at least 2 players to start hand.')

    const occupiedSeats = seatedPlayers.map((p) => p.seat_no)
    const dealerSeat = gameState.dealer_seat ? nextOccupiedSeat(gameState.dealer_seat, occupiedSeats) : Math.min(...occupiedSeats)
    const sbSeat = nextOccupiedSeat(dealerSeat, occupiedSeats)
    const bbSeat = nextOccupiedSeat(sbSeat, occupiedSeats)
    const utgSeat = nextOccupiedSeat(bbSeat, occupiedSeats)

    const deck = createShuffledDeck()
    const playersBySession = {}

    for (const p of seatedPlayers) {
      playersBySession[p.session_id] = {
        session_id: p.session_id,
        username: p.username,
        seat_no: p.seat_no,
        stack: p.stack,
        folded: false,
        allIn: false,
        checked: false,
        pending: true,
        currentBet: 0,
        totalCommitted: 0,
        actedStreet: false,
        holeCards: [deck.pop(), deck.pop()],
        lastAction: 'dealt',
      }
    }

    const sbPlayer = Object.values(playersBySession).find((p) => p.seat_no === sbSeat)
    const bbPlayer = Object.values(playersBySession).find((p) => p.seat_no === bbSeat)
    const postBlind = (pl, amount, label) => {
      const paid = Math.min(pl.stack, amount)
      pl.stack -= paid
      pl.currentBet += paid
      pl.totalCommitted += paid
      pl.lastAction = label
      if (pl.stack === 0) pl.allIn = true
    }
    postBlind(sbPlayer, settings.small_blind, 'small_blind')
    postBlind(bbPlayer, settings.big_blind, 'big_blind')

    const handState = {
      handNo: (gameState.hand_no || 0) + 1,
      street: 'preflop',
      boardCards: [],
      deck,
      dealerSeat,
      smallBlind: settings.small_blind,
      bigBlind: settings.big_blind,
      currentBet: Math.max(settings.small_blind, settings.big_blind),
      minRaise: settings.big_blind,
      actingSessionId: Object.values(playersBySession).find((p) => p.seat_no === utgSeat)?.session_id,
      playersBySession,
      pot: settings.small_blind + settings.big_blind,
      actionLog: [`Hand #${(gameState.hand_no || 0) + 1} started`],
      winnerSummary: null,
    }

    await supabase.from('game_state').update({ hand_no: handState.handNo, dealer_seat: dealerSeat }).eq('id', 1)
    await saveGame(handState)
  }

  const seatOf = (sid) => handPlayers[sid]?.seat_no

  const nextActiveSession = (fromSession) => {
    const active = Object.values(handPlayers)
      .filter((p) => !p.folded && !p.allIn)
      .sort((a, b) => a.seat_no - b.seat_no)
    if (active.length === 0) return null
    const fromSeat = seatOf(fromSession) || active[0].seat_no
    const nextSeat = nextOccupiedSeat(fromSeat, active.map((p) => p.seat_no))
    return active.find((p) => p.seat_no === nextSeat)?.session_id || active[0].session_id
  }

  const allCanActResolved = (state) => {
    const ps = Object.values(state.playersBySession)
    const live = ps.filter((p) => !p.folded)
    if (live.length <= 1) return true
    return live.every((p) => p.allIn || (p.actedStreet && p.currentBet === state.currentBet))
  }

  const streetAdvance = (state) => {
    const ps = Object.values(state.playersBySession)
    for (const p of ps) {
      p.currentBet = 0
      p.checked = false
      p.pending = !p.folded && !p.allIn
      p.actedStreet = false
    }
    state.currentBet = 0
    state.minRaise = state.bigBlind

    if (state.street === 'preflop') {
      state.street = 'flop'
      state.boardCards.push(state.deck.pop(), state.deck.pop(), state.deck.pop())
      state.actionLog?.push(`Flop: ${state.boardCards.join(' ')}`)
    } else if (state.street === 'flop') {
      state.street = 'turn'
      state.boardCards.push(state.deck.pop())
      state.actionLog?.push(`Turn: ${state.boardCards.join(' ')}`)
    } else if (state.street === 'turn') {
      state.street = 'river'
      state.boardCards.push(state.deck.pop())
      state.actionLog?.push(`River: ${state.boardCards.join(' ')}`)
    } else {
      state.street = 'showdown'
      state.actionLog?.push('Showdown')
    }

    const activeBySeat = ps.filter((p) => !p.folded && !p.allIn).sort((a, b) => a.seat_no - b.seat_no)
    const firstPostFlopSeat = nextOccupiedSeat(state.dealerSeat, activeBySeat.map((p) => p.seat_no))
    state.actingSessionId = activeBySeat.find((p) => p.seat_no === firstPostFlopSeat)?.session_id || null
  }

  const finishHand = async (state) => {
    const live = Object.values(state.playersBySession).filter((p) => !p.folded)
    if (live.length === 1) {
      const w = live[0]
      w.stack += state.pot
      w.lastAction = 'wins_uncontested'
      state.winnerSummary = `${w.username} wins ${state.pot} (everyone else folded)`
    } else {
      const result = runShowdown({
        players: live.map((p) => ({ seat_no: p.seat_no, username: p.username, holeCards: p.holeCards })),
        boardCards: state.boardCards,
        pot: state.pot,
      })
      for (const share of result.potShareList) {
        const w = Object.values(state.playersBySession).find((p) => p.seat_no === share.seat_no)
        if (w) w.stack += share.amount
      }
      state.winnerSummary = result.potShareList.map((s) => `${s.username} +${s.amount}`).join(' | ')
      setShowdownResult(result)
    }

    for (const p of Object.values(state.playersBySession)) {
      await supabase.from('lobby_players').update({ stack: p.stack }).eq('session_id', p.session_id)
    }

    state.street = 'waiting'
    state.actingSessionId = null
    await saveGame(state)
    await refreshAll()
  }

  const applyAction = async (type) => {
    if (!hand.actingSessionId || hand.actingSessionId !== sessionId) return
    const state = structuredClone(hand)
    const player = state.playersBySession[sessionId]
    if (!player) return

    const toCall = Math.max(0, state.currentBet - player.currentBet)

    const commit = (amount) => {
      const paid = Math.min(amount, player.stack)
      player.stack -= paid
      player.currentBet += paid
      player.totalCommitted += paid
      state.pot += paid
      if (player.stack === 0) player.allIn = true
      return paid
    }

    if (type === 'fold') {
      player.folded = true
      player.pending = false
      player.lastAction = 'fold'
      player.actedStreet = true
      state.actionLog?.push(`${player.username}: fold`)
    } else if (type === 'check') {
      if (toCall > 0) return setError('Cannot check, call/raise/fold required.')
      player.checked = true
      player.pending = false
      player.lastAction = 'check'
      player.actedStreet = true
      state.actionLog?.push(`${player.username}: check`)
    } else if (type === 'call') {
      commit(toCall)
      player.pending = false
      player.lastAction = `call ${toCall}`
      player.actedStreet = true
      state.actionLog?.push(`${player.username}: call ${toCall}`)
    } else if (type === 'bet') {
      const betTo = Number(raiseTo || 0)
      if (!(betTo > state.currentBet)) return setError('Enter a bet/raise amount greater than current bet.')
      const add = betTo - player.currentBet
      commit(add)
      const delta = betTo - state.currentBet
      state.minRaise = Math.max(state.minRaise, delta)
      state.currentBet = player.currentBet
      player.pending = false
      player.lastAction = `bet/raise to ${player.currentBet}`
      player.actedStreet = true
      state.actionLog?.push(`${player.username}: raise to ${player.currentBet}`)
      Object.values(state.playersBySession).forEach((p) => {
        if (p.session_id !== player.session_id && !p.folded && !p.allIn) p.actedStreet = false
      })
    } else if (type === 'allin') {
      commit(player.stack)
      if (player.currentBet > state.currentBet) {
        state.minRaise = Math.max(state.minRaise, player.currentBet - state.currentBet)
        state.currentBet = player.currentBet
        Object.values(state.playersBySession).forEach((p) => {
          if (p.session_id !== player.session_id && !p.folded && !p.allIn) p.actedStreet = false
        })
      }
      player.pending = false
      player.lastAction = 'all-in'
      player.actedStreet = true
      state.actionLog?.push(`${player.username}: all-in (${player.currentBet})`)
    }

    const liveNotFolded = Object.values(state.playersBySession).filter((p) => !p.folded)
    if (liveNotFolded.length <= 1) return finishHand(state)

    if (allCanActResolved(state)) {
      streetAdvance(state)
      if (state.street === 'showdown' || state.street === 'waiting') return finishHand(state)
    } else {
      state.actingSessionId = nextActiveSession(sessionId)
    }

    await saveGame(state)
  }

  const saveBoardOnly = async () => {
    const state = structuredClone(hand)
    state.boardCards = parseCardList(boardInput)
    await saveGame(state)
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
      await supabase.from('lobby_players').update({ heartbeat_at: new Date().toISOString() }).eq('session_id', sessionId)
    }, 15000)

    return () => {
      clearInterval(heartbeatTimer)
      supabase.removeChannel(channel)
    }
  }, [joined])

  useEffect(() => {
    if (!gameState.last_action_at || gameState.phase === 'waiting') return setCountdown(null)

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

  useEffect(() => {
    const b = hand?.boardCards || []
    setBoardInput(Array.isArray(b) ? b.join(' ') : '')
  }, [hand?.boardCards])

  const myPlayer = handPlayers[sessionId]
  const toCall = myPlayer ? Math.max(0, (hand.currentBet || 0) - (myPlayer.currentBet || 0)) : 0

  return (
    <div className="app">
      <header>
        <h1>Cards - Texas Hold'em (Playable MVP)</h1>
        <p>Playthrough includes blinds, preflop/flop/turn/river, actions, and showdown.</p>
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
            <span>Joined as: <strong>{username}</strong></span>
            <button onClick={leaveLobby}>Leave</button>
          </div>
        )}
      </section>

      <section>
        <h2>Table Settings</h2>
        <div className="row wrap">
          <span>Blinds:</span>
          {BLIND_OPTIONS.map((b) => <button key={b.label} onClick={() => setBlinds(b.sb, b.bb)}>{b.label}</button>)}
          <strong>Current: {settings.small_blind}/{settings.big_blind}</strong>
        </div>
        <div className="row wrap">
          <span>Turn timer:</span>
          {TURN_OPTIONS.map((t) => <button key={t} onClick={() => setTurnSeconds(t)}>{t}s</button>)}
          <strong>Current: {settings.turn_seconds}s</strong>
        </div>
      </section>

      <section>
        <h2>Game State</h2>
        <div className="row wrap">
          <strong>Hand #{gameState.hand_no || 0}</strong>
          <span>Street: {hand.street || 'waiting'}</span>
          <span>Dealer: {hand.dealerSeat ?? '-'}</span>
          <span>Pot: {hand.pot ?? gameState.pot ?? 0}</span>
          <span>Current bet: {hand.currentBet ?? 0}</span>
          <span>Timer: {countdown ?? '-'}s</span>
          <button onClick={startHand}>Start New Hand</button>
        </div>
        <div className="row wrap" style={{ marginTop: 8 }}>
          <strong>Board:</strong>
          <span>{(hand.boardCards || []).join(' ') || '-'}</span>
        </div>
        {hand.winnerSummary && <div style={{ marginTop: 8 }}><strong>Result:</strong> {hand.winnerSummary}</div>}
      </section>

      <section>
        <h2>Your Hand & Actions</h2>
        {!myPlayer ? (
          <p>
            You are not currently in the active hand. Join a seat first, then click <strong>Start New Hand</strong> to be dealt cards.
          </p>
        ) : (
          <>
            <div className="row wrap">
              <strong>Your cards:</strong>
              <span>{myPlayer?.holeCards?.join(' ') || '-'}</span>
            </div>
            <div className="row wrap" style={{ marginTop: 8 }}>
              <span>To call: {toCall}</span>
              <span>Your stack: {myPlayer?.stack ?? '-'}</span>
              <span>Your committed: {myPlayer?.totalCommitted ?? '-'}</span>
              <span>Status: {myPlayer?.folded ? 'Folded' : myPlayer?.allIn ? 'All-in' : hand.actingSessionId === sessionId ? 'Your turn' : 'Waiting'}</span>
            </div>
          </>
        )}
        <div className="row wrap" style={{ marginTop: 10 }}>
          <button disabled={hand.actingSessionId !== sessionId} onClick={() => applyAction('fold')}>Fold</button>
          <button disabled={hand.actingSessionId !== sessionId || toCall > 0} onClick={() => applyAction('check')}>Check</button>
          <button disabled={hand.actingSessionId !== sessionId || toCall === 0} onClick={() => applyAction('call')}>Call</button>
          <input
            placeholder="Raise to"
            value={raiseTo}
            onChange={(e) => setRaiseTo(e.target.value)}
            style={{ width: 110 }}
          />
          <button disabled={hand.actingSessionId !== sessionId} onClick={() => applyAction('bet')}>Bet/Raise To</button>
          <button disabled={hand.actingSessionId !== sessionId} onClick={() => applyAction('allin')}>All-in</button>
        </div>
      </section>

      <section>
        <h2>Table / Seats ({seatedPlayers.length}/{MAX_PLAYERS})</h2>
        <div className="table-area">
          {/* Oval felt */}
          <div className="poker-felt">
            <div className="table-center-info">
              <div className="table-street-bar">
                <span>Pot: <strong>{hand.pot ?? 0}</strong></span>
                <span>{hand.street || 'waiting'}</span>
                {countdown != null && hand.street !== 'waiting' && <span>⏱ {countdown}s</span>}
              </div>
              {(hand.boardCards || []).length > 0 && (
                <div className="board-cards">
                  {(hand.boardCards || []).map((c, i) => (
                    <span key={i} className="board-card">{c}</span>
                  ))}
                </div>
              )}
              {hand.winnerSummary && (
                <div className="winner-banner">🏆 {hand.winnerSummary}</div>
              )}
            </div>
          </div>

          {/* Seat slots around the table */}
          {Array.from({ length: MAX_PLAYERS }, (_, i) => {
            const seatNo = i + 1
            const player = seatedPlayers.find((p) => p.seat_no === seatNo)
            const hp = player ? handPlayers[player.session_id] : null
            const isTurn = !!(player && hand.actingSessionId === player.session_id)
            const isDealer = hand.dealerSeat === seatNo
            const isMe = player?.session_id === sessionId
            const pos = SEAT_POSITIONS[i]
            return (
              <div
                key={seatNo}
                className={`seat-slot${player ? ' occupied' : ' empty'}${isTurn ? ' acting' : ''}${hp?.folded ? ' folded' : ''}`}
                style={{ top: pos.top, left: pos.left }}
              >
                {player ? (
                  <>
                    <div className="seat-name">
                      {isDealer && <span className="dealer-chip">D</span>}
                      <span className="seat-username">{player.username}{isMe ? ' ★' : ''}</span>
                    </div>
                    <div className="seat-stack">{hp?.stack ?? player.stack}</div>
                    <div className="seat-cards">
                      {isMe || hand.street === 'waiting'
                        ? (hp?.holeCards?.join(' ') || '–')
                        : (hp?.holeCards ? '🂠 🂠' : '–')}
                    </div>
                    <div className="seat-action">
                      {hp?.folded ? 'Folded' : hp?.allIn ? 'All-in' : hp?.lastAction || '–'}
                    </div>
                  </>
                ) : (
                  <div className="seat-empty-label">Seat {seatNo}</div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <h2>Hand Log</h2>
        <div>
          {(hand.actionLog || []).length === 0 ? (
            <p>No actions yet.</p>
          ) : (
            <ul>
              {(hand.actionLog || []).slice(-12).map((line, idx) => (
                <li key={`${idx}-${line}`}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2>Manual Board Override (debug)</h2>
        <div className="row wrap">
          <input placeholder="AS KD QH JC TD" value={boardInput} onChange={(e) => setBoardInput(e.target.value)} style={{ minWidth: 260 }} />
          <button onClick={saveBoardOnly}>Save Board</button>
        </div>
      </section>

      {showdownResult && (
        <section>
          <h2>Showdown Result</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(showdownResult, null, 2)}</pre>
        </section>
      )}
    </div>
  )
}

export default App
