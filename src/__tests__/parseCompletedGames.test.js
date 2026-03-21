// Mock module-level deps so they don't blow up in Jest's jsdom environment
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: jest.fn() }) }))
jest.mock('resend', () => ({ Resend: jest.fn() }))

const { parseCompletedGames } = require('../../api/update-results')

function makeEvent(overrides = {}) {
  return {
    date: '2026-03-19T18:00:00Z',
    status: { type: { completed: true } },
    competitions: [{
      competitors: [
        { winner: true,  team: { id: '150', displayName: 'Duke Blue Devils' } },
        { winner: false, team: { id: '200', displayName: 'Vermont Catamounts' } },
      ]
    }],
    ...overrides,
  }
}

describe('parseCompletedGames', () => {
  test('parses a completed game correctly', () => {
    const [result] = parseCompletedGames([makeEvent()])
    expect(result.winnerName).toBe('Duke Blue Devils')
    expect(result.loserName).toBe('Vermont Catamounts')
    expect(result.winnerId).toBe(150)
    expect(result.loserId).toBe(200)
    expect(result.gameDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('parses ESPN team IDs as integers (not strings)', () => {
    const [result] = parseCompletedGames([makeEvent()])
    expect(typeof result.winnerId).toBe('number')
    expect(typeof result.loserId).toBe('number')
  })

  test('skips incomplete games', () => {
    const event = makeEvent()
    event.status.type.completed = false
    expect(parseCompletedGames([event])).toHaveLength(0)
  })

  test('skips events where no winner is flagged', () => {
    const event = makeEvent()
    event.competitions[0].competitors[0].winner = undefined
    event.competitions[0].competitors[1].winner = undefined
    expect(parseCompletedGames([event])).toHaveLength(0)
  })

  test('skips events with only one competitor', () => {
    const event = makeEvent()
    event.competitions[0].competitors = [event.competitions[0].competitors[0]]
    expect(parseCompletedGames([event])).toHaveLength(0)
  })

  test('handles empty event list', () => {
    expect(parseCompletedGames([])).toHaveLength(0)
  })

  test('converts event date to ET date string (YYYY-MM-DD)', () => {
    // 2026-03-19T18:00:00Z = 2pm ET = March 19 ET
    const [result] = parseCompletedGames([makeEvent({ date: '2026-03-19T18:00:00Z' })])
    expect(result.gameDate).toBe('2026-03-19')
  })

  test('late night game (after midnight UTC) stays correct ET date', () => {
    // 2026-03-20T01:00:00Z = 9pm ET on Mar 19 — should be 2026-03-19 in ET
    const [result] = parseCompletedGames([makeEvent({ date: '2026-03-20T01:00:00Z' })])
    expect(result.gameDate).toBe('2026-03-19')
  })

  test('handles null event date', () => {
    const event = makeEvent()
    event.date = null
    const [result] = parseCompletedGames([event])
    expect(result.gameDate).toBeNull()
  })

  test('processes multiple games and returns all', () => {
    const events = [makeEvent(), makeEvent()]
    expect(parseCompletedGames(events)).toHaveLength(2)
  })

  test('mixes complete and incomplete games — only returns complete', () => {
    const complete = makeEvent()
    const incomplete = makeEvent()
    incomplete.status.type.completed = false
    expect(parseCompletedGames([complete, incomplete])).toHaveLength(1)
  })
})
