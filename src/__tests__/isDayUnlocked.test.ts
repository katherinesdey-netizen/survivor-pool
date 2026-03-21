// Prevent supabase.ts from crashing — it requires env vars at import time
jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
  },
}))

import { isDayUnlocked } from '../pages/PicksPage'

interface TournamentDay {
  id: number
  game_date: string
  round_name: string
  picks_required: number
  deadline: string
}

function makeDays(dates: string[]): TournamentDay[] {
  return dates.map((game_date, i) => ({
    id: i,
    game_date,
    round_name: 'Test Round',
    picks_required: 1,
    deadline: game_date + 'T23:59:00Z',
  }))
}

const PAST   = '2020-01-01'
const FUTURE = '2099-12-31'

describe('isDayUnlocked', () => {
  // ── First two days are always unlocked ─────────────────────────────────────
  test('index 0 is always unlocked, even with future dates', () => {
    const days = makeDays([FUTURE, FUTURE, FUTURE])
    expect(isDayUnlocked(days, 0)).toBe(true)
  })

  test('index 1 is always unlocked, even with future dates', () => {
    const days = makeDays([FUTURE, FUTURE, FUTURE])
    expect(isDayUnlocked(days, 1)).toBe(true)
  })

  // ── Day N unlocks when day N-1 game_date has passed ────────────────────────
  test('index 2 is locked when day 1 game_date is in the future', () => {
    const days = makeDays([PAST, FUTURE, FUTURE])
    expect(isDayUnlocked(days, 2)).toBe(false)
  })

  test('index 2 unlocks when day 1 game_date is in the past', () => {
    const days = makeDays([PAST, PAST, FUTURE])
    expect(isDayUnlocked(days, 2)).toBe(true)
  })

  test('index 3 requires day 2 to have passed', () => {
    const days = makeDays([PAST, PAST, FUTURE, FUTURE])
    // Day 2 is in the future → day 3 locked
    expect(isDayUnlocked(days, 3)).toBe(false)
  })

  test('index 3 unlocks when day 2 has passed', () => {
    const days = makeDays([PAST, PAST, PAST, FUTURE])
    expect(isDayUnlocked(days, 3)).toBe(true)
  })

  // ── Edge: unlocks on the same calendar day ─────────────────────────────────
  test('day unlocks on the same ET calendar day (game_date === todayET)', () => {
    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    const days = makeDays([PAST, todayET, FUTURE])
    // days[1].game_date === todayET → todayET <= todayET → index 2 unlocks
    expect(isDayUnlocked(days, 2)).toBe(true)
  })

  // ── Full bracket: Mar 2026 realistic scenario ──────────────────────────────
  test('realistic bracket — Saturday unlocks because Friday has passed', () => {
    const days = makeDays([
      '2026-03-19', // Thu R64 — index 0 always unlocked
      '2026-03-20', // Fri R64 — index 1 always unlocked
      '2026-03-21', // Sat R32 — unlocks when index 1 (Mar 20) <= today
      '2026-03-22', // Sun R32 — locked until Mar 21 passes
    ])
    // Today is 2026-03-21 per CLAUDE.md currentDate
    // days[2].game_date = '2026-03-21'; days[1].game_date = '2026-03-20'
    // isDayUnlocked(days, 2): days[1].game_date '2026-03-20' <= todayET '2026-03-21' → true
    expect(isDayUnlocked(days, 2)).toBe(true)
    // isDayUnlocked(days, 3): days[2].game_date '2026-03-21' <= todayET '2026-03-21' → true
    expect(isDayUnlocked(days, 3)).toBe(true)
  })
})
