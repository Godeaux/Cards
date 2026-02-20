import PokerHand from 'poker-hand-evaluator'

const RANKS = '23456789TJQKA'
const SUITS = 'CDHS'

const HAND_RANK_ORDER = {
  ROYAL_FLUSH: 1,
  STRAIGHT_FLUSH: 2,
  FOUR_OF_A_KIND: 3,
  FULL_HOUSE: 4,
  FLUSH: 5,
  STRAIGHT: 6,
  THREE_OF_A_KIND: 7,
  TWO_PAIRS: 8,
  ONE_PAIR: 9,
  HIGH_CARD: 10,
}

export function parseCard(card) {
  if (typeof card !== 'string') throw new Error(`Invalid card: ${card}`)
  const normalized = card.trim().toUpperCase()
  if (normalized.length !== 2) throw new Error(`Card must be 2 chars: ${card}`)

  const rank = normalized[0]
  const suit = normalized[1]

  if (!RANKS.includes(rank)) throw new Error(`Invalid rank: ${rank}`)
  if (!SUITS.includes(suit)) throw new Error(`Invalid suit: ${suit}`)

  return normalized
}

export function validateCards(cards) {
  if (!Array.isArray(cards)) throw new Error('Cards must be an array')
  const normalized = cards.map(parseCard)
  if (new Set(normalized).size !== normalized.length) throw new Error('Duplicate cards detected')
  return normalized
}

function combinations(arr, k) {
  const out = []
  const pick = (start, acc) => {
    if (acc.length === k) {
      out.push(acc)
      return
    }
    for (let i = start; i < arr.length; i += 1) {
      pick(i + 1, [...acc, arr[i]])
    }
  }
  pick(0, [])
  return out
}

function evaluateFiveCards(cards5) {
  const hand = new PokerHand(cards5.join(' '))
  const rankName = hand.getRank()
  const score = hand.getScore() // lower is better
  return {
    cards: cards5,
    score,
    rankName,
    rank: HAND_RANK_ORDER[rankName] ?? 99,
  }
}

export function evaluatePlayerHand({ holeCards, boardCards }) {
  if (!Array.isArray(holeCards) || holeCards.length !== 2) {
    throw new Error('Player must have exactly 2 hole cards')
  }
  if (!Array.isArray(boardCards) || boardCards.length !== 5) {
    throw new Error('Board must have exactly 5 cards')
  }

  const hole = validateCards(holeCards)
  const board = validateCards(boardCards)
  const allSeven = [...hole, ...board]
  if (new Set(allSeven).size !== 7) throw new Error('Duplicate cards between hole and board')

  const all5 = combinations(allSeven, 5)
  const evals = all5.map(evaluateFiveCards)
  evals.sort((a, b) => a.score - b.score) // lower score wins
  const best = evals[0]

  return {
    holeCards: hole,
    rank: best.rank,
    rankName: best.rankName,
    score: best.score,
    best5: best.cards,
  }
}

export function runShowdown({ players, boardCards, pot }) {
  if (!Array.isArray(players) || players.length < 1) throw new Error('At least one player required')
  const board = validateCards(boardCards)
  if (board.length !== 5) throw new Error('Board must have exactly 5 cards')
  if (typeof pot !== 'number' || pot < 0) throw new Error('Pot must be a non-negative number')

  const playerResults = players.map((p) => ({
    seat_no: p.seat_no,
    username: p.username,
    ...evaluatePlayerHand({ holeCards: p.holeCards, boardCards: board }),
  }))

  playerResults.sort((a, b) => a.score - b.score)
  const bestScore = playerResults[0].score
  const winners = playerResults.filter((p) => p.score === bestScore).sort((a, b) => a.seat_no - b.seat_no)

  const intPot = Math.floor(pot)
  const base = Math.floor(intPot / winners.length)
  const remainder = intPot % winners.length

  const potShareList = winners.map((w, idx) => ({
    seat_no: w.seat_no,
    username: w.username,
    amount: base + (idx < remainder ? 1 : 0),
  }))

  const potShares = Object.fromEntries(potShareList.map((s) => [String(s.seat_no), s.amount]))

  return {
    boardCards: board,
    winners,
    playerResults,
    potShares,
    potShareList,
  }
}

export function selfCheck() {
  const checks = []
  try {
    checks.push(parseCard('as') === 'AS' ? 'ok parseCard' : 'fail parseCard')
    checks.push(validateCards(['AS', 'KD']).length === 2 ? 'ok validateCards' : 'fail validateCards')

    const royal = evaluatePlayerHand({
      holeCards: ['AH', 'KH'],
      boardCards: ['QH', 'JH', 'TH', '2C', '3D'],
    })
    checks.push(royal.rankName === 'ROYAL_FLUSH' ? 'ok evaluatePlayerHand' : 'fail evaluatePlayerHand')

    const showdown = runShowdown({
      players: [
        { seat_no: 2, username: 'Bob', holeCards: ['AS', 'KS'] },
        { seat_no: 1, username: 'Alice', holeCards: ['AH', 'KH'] },
      ],
      boardCards: ['QH', 'JH', 'TH', '2D', '3C'],
      pot: 101,
    })
    checks.push(showdown.winners[0].username === 'Alice' ? 'ok runShowdown winner' : 'fail runShowdown winner')
    checks.push(showdown.potShares['1'] === 101 ? 'ok pot split' : 'fail pot split')
  } catch (e) {
    checks.push(`error ${e.message}`)
  }
  return checks
}
