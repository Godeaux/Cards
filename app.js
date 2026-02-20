import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TURN_OPTIONS = [45, 60, 75, 90, 105, 120]
const BLIND_OPTIONS = [
  { label: '1 / 1', sb: 1, bb: 1 },
  { label: '1 / 2', sb: 1, bb: 2 },
]
const MAX_PLAYERS = 8

const cfg = window.CARDS_CONFIG || {
  supabaseUrl: 'https://oiltjegxfwjdvuzbsyfv.supabase.co',
  supabaseAnonKey: 'sb_publishable_7rNCoUWbz3FnDY4VdIvCbg_9R-LuirL',
}
const errorEl = document.getElementById('error')

if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
  showError('Missing config.js values (supabaseUrl / supabaseAnonKey).')
  throw new Error('Missing config')
}

const supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey)

const usernameEl = document.getElementById('username')
const joinBtn = document.getElementById('joinBtn')
const leaveBtn = document.getElementById('leaveBtn')
const whoamiEl = document.getElementById('whoami')
const playersEl = document.getElementById('players')
const playerCountEl = document.getElementById('playerCount')
const currentSettingsEl = document.getElementById('currentSettings')
const handStateEl = document.getElementById('handState')
const blindButtonsEl = document.getElementById('blindButtons')
const timerButtonsEl = document.getElementById('timerButtons')
const startHandBtn = document.getElementById('startHandBtn')
const endTurnBtn = document.getElementById('endTurnBtn')

const state = {
  sessionId: getSessionId(),
  joined: false,
  username: '',
  players: [],
  settings: { small_blind: 1, big_blind: 2, turn_seconds: 60 },
  game: { hand_no: 0, phase: 'waiting', dealer_seat: null, current_turn_session_id: null, pot: 0, last_action_at: null },
}

function getSessionId() {
  const key = 'cards_session_id'
  let sid = localStorage.getItem(key)
  if (!sid) {
    sid = crypto.randomUUID()
    localStorage.setItem(key, sid)
  }
  return sid
}

function showError(msg) {
  errorEl.textContent = msg
  errorEl.classList.remove('hidden')
}

function clearError() {
  errorEl.textContent = ''
  errorEl.classList.add('hidden')
}

function assignOpenSeat(players) {
  const used = new Set(players.map((p) => p.seat_no).filter((v) => v != null))
  for (let i = 1; i <= MAX_PLAYERS; i += 1) if (!used.has(i)) return i
  return null
}

function nextOccupiedSeat(fromSeat, occupiedSeats) {
  const sorted = [...occupiedSeats].sort((a, b) => a - b)
  for (const seat of sorted) if (seat > fromSeat) return seat
  return sorted[0]
}

async function refreshAll() {
  const [playersRes, settingsRes, gameRes] = await Promise.all([
    supabase.from('lobby_players').select('*').order('seat_no', { ascending: true }),
    supabase.from('table_settings').select('*').eq('id', 1).single(),
    supabase.from('game_state').select('*').eq('id', 1).single(),
  ])

  if (playersRes.error) throw playersRes.error
  if (settingsRes.error) throw settingsRes.error
  if (gameRes.error) throw gameRes.error

  state.players = playersRes.data || []
  state.settings = settingsRes.data
  state.game = gameRes.data

  const me = state.players.find((p) => p.session_id === state.sessionId)
  state.joined = !!me
  state.username = me?.username || state.username

  render()
}

function render() {
  const me = state.players.find((p) => p.session_id === state.sessionId)
  whoamiEl.textContent = me ? `Joined as: ${me.username} (Seat ${me.seat_no})` : 'Not joined'
  joinBtn.classList.toggle('hidden', !!me)
  leaveBtn.classList.toggle('hidden', !me)

  playerCountEl.textContent = String(state.players.length)
  playersEl.innerHTML = state.players.map((p) => `<li>Seat ${p.seat_no}: ${escapeHtml(p.username)} — stack ${p.stack}</li>`).join('')

  currentSettingsEl.textContent = `Blinds ${state.settings.small_blind}/${state.settings.big_blind} • Turn timer ${state.settings.turn_seconds}s`

  const myTurn = state.game.current_turn_session_id === state.sessionId
  const timer = getRemainingTimer()
  handStateEl.textContent = `Hand #${state.game.hand_no || 0} • Phase ${state.game.phase} • Dealer seat ${state.game.dealer_seat ?? '-'} • Pot ${state.game.pot || 0} • Timer ${timer}s • ${myTurn ? 'YOUR TURN' : 'waiting'}`
  endTurnBtn.disabled = !myTurn
}

function getRemainingTimer() {
  if (!state.game.last_action_at || state.game.phase === 'waiting') return '-'
  const elapsed = Math.floor((Date.now() - new Date(state.game.last_action_at).getTime()) / 1000)
  return Math.max(0, state.settings.turn_seconds - elapsed)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

async function joinLobby() {
  clearError()
  const name = (usernameEl.value || '').trim()
  if (!name) return showError('Username is required.')

  const { data: players, error } = await supabase.from('lobby_players').select('*')
  if (error) return showError(error.message)

  const seatNo = assignOpenSeat(players || [])
  if (!seatNo) return showError('Lobby full (8/8).')

  const { error: upsertError } = await supabase.from('lobby_players').upsert(
    { session_id: state.sessionId, username: name, seat_no: seatNo, heartbeat_at: new Date().toISOString() },
    { onConflict: 'session_id' },
  )
  if (upsertError) return showError(upsertError.message)

  await refreshAll()
}

async function leaveLobby() {
  clearError()
  const { error } = await supabase.from('lobby_players').delete().eq('session_id', state.sessionId)
  if (error) return showError(error.message)
  await refreshAll()
}

async function setBlinds(sb, bb) {
  const { error } = await supabase.from('table_settings').update({ small_blind: sb, big_blind: bb, updated_at: new Date().toISOString() }).eq('id', 1)
  if (error) showError(error.message)
}

async function setTurn(seconds) {
  const { error } = await supabase.from('table_settings').update({ turn_seconds: seconds, updated_at: new Date().toISOString() }).eq('id', 1)
  if (error) showError(error.message)
}

async function logAction(action, payload = {}) {
  const me = state.players.find((p) => p.session_id === state.sessionId)
  await supabase.from('hand_actions').insert({
    actor_session_id: state.sessionId,
    actor_username: me?.username || null,
    action,
    payload,
  })
}

async function startHand() {
  clearError()
  const seated = state.players.filter((p) => p.seat_no != null)
  if (seated.length < 2) return showError('Need at least 2 players to start.')

  const occupied = seated.map((p) => p.seat_no)
  const dealerSeat = state.game.dealer_seat ? nextOccupiedSeat(state.game.dealer_seat, occupied) : Math.min(...occupied)
  const sbSeat = nextOccupiedSeat(dealerSeat, occupied)
  const bbSeat = nextOccupiedSeat(sbSeat, occupied)
  const turnSeat = nextOccupiedSeat(bbSeat, occupied)

  const turnPlayer = seated.find((p) => p.seat_no === turnSeat)
  const pot = state.settings.small_blind + state.settings.big_blind

  const { error } = await supabase.from('game_state').update({
    hand_no: (state.game.hand_no || 0) + 1,
    phase: 'preflop',
    dealer_seat: dealerSeat,
    current_turn_session_id: turnPlayer.session_id,
    pot,
    last_action_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', 1)

  if (error) return showError(error.message)

  await logAction('start_hand', { dealerSeat, sbSeat, bbSeat, turnSeat, pot })
  await refreshAll()
}

async function endTurn() {
  clearError()
  const current = state.players.find((p) => p.session_id === state.game.current_turn_session_id)
  if (!current) return

  const occupied = state.players.filter((p) => p.seat_no != null).map((p) => p.seat_no)
  const nextSeat = nextOccupiedSeat(current.seat_no, occupied)
  const nextPlayer = state.players.find((p) => p.seat_no === nextSeat)

  const { error } = await supabase.from('game_state').update({
    current_turn_session_id: nextPlayer.session_id,
    last_action_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', 1)

  if (error) return showError(error.message)

  await logAction('end_turn', { from: current.username, to: nextPlayer.username })
  await refreshAll()
}

function wireButtons() {
  blindButtonsEl.innerHTML = '<span>Blinds:</span>'
  BLIND_OPTIONS.forEach((b) => {
    const btn = document.createElement('button')
    btn.textContent = b.label
    btn.onclick = () => setBlinds(b.sb, b.bb)
    blindButtonsEl.appendChild(btn)
  })

  timerButtonsEl.innerHTML = '<span>Turn timer:</span>'
  TURN_OPTIONS.forEach((t) => {
    const btn = document.createElement('button')
    btn.textContent = `${t}s`
    btn.onclick = () => setTurn(t)
    timerButtonsEl.appendChild(btn)
  })
}

async function init() {
  wireButtons()
  joinBtn.onclick = joinLobby
  leaveBtn.onclick = leaveLobby
  startHandBtn.onclick = startHand
  endTurnBtn.onclick = endTurn

  try {
    await refreshAll()
  } catch (e) {
    showError(e.message)
  }

  const channel = supabase
    .channel('cards-realtime-html')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_players' }, refreshAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'table_settings' }, refreshAll)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, refreshAll)
    .subscribe()

  setInterval(async () => {
    if (!state.joined) return
    await supabase.from('lobby_players').update({ heartbeat_at: new Date().toISOString() }).eq('session_id', state.sessionId)
  }, 15000)

  setInterval(render, 1000)

  window.addEventListener('beforeunload', async () => {
    supabase.removeChannel(channel)
  })
}

init()
