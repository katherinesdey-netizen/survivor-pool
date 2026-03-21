// Tests for api/submit-pick.js
// Mocks @supabase/supabase-js so no real DB is needed.
// Uses jest.resetModules() per test so the module-level supabase client
// picks up the current mockFrom for each test.

let mockFrom

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args) => mockFrom(...args) }),
}))

jest.mock('resend', () => ({
  Resend: jest.fn().mockReturnValue({
    emails: { send: jest.fn().mockResolvedValue({}) },
  }),
}))

// ── Helpers ────────────────────────────────────────────────────────────────

// Build a chainable supabase query mock that resolves to `resolveValue`.
// All filter methods return `this`; terminal methods resolve the promise.
// The chain itself is thenable (for direct `await chain.select().in(...)` usage).
function chain(resolveValue) {
  const c = {
    select: jest.fn().mockReturnThis(),
    ilike:  jest.fn().mockReturnThis(),
    eq:     jest.fn().mockReturnThis(),
    neq:    jest.fn().mockReturnThis(),
    in:     jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    order:  jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resolveValue),
    single:      jest.fn().mockResolvedValue(resolveValue),
  }
  // Thenable so `await supabase.from('x').select().in(...)` resolves correctly
  c.then  = (res, rej) => Promise.resolve(resolveValue).then(res, rej)
  c.catch = (rej)      => Promise.resolve(resolveValue).catch(rej)
  return c
}

function mockRes() {
  const res = {
    status:    jest.fn(),
    json:      jest.fn(),
    setHeader: jest.fn(),
    end:       jest.fn(),
  }
  res.status.mockReturnValue(res)
  return res
}

function loadHandler() {
  // Re-require after resetModules so the module-level supabase client is fresh
  return require('../../api/submit-pick')
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const PARTICIPANT = {
  id: 'p-uuid-1',
  full_name: 'Test User',
  is_paid: true,
  is_eliminated: false,
}

const DAY_R32 = {
  game_date: '2026-03-21',
  round_name: 'Round of 32',
  deadline: '2099-12-31T23:59:00Z', // far future — not passed
  picks_required: 1,
}

const DAY_R64 = {
  game_date: '2026-03-19',
  round_name: 'Round of 64',
  deadline: '2099-12-31T23:59:00Z',
  picks_required: 2,
}

const TEAM1 = { id: 1, name: 'Duke',    seed: 1,  region: 'East', is_eliminated: false }
const TEAM2 = { id: 2, name: 'Vermont', seed: 16, region: 'East', is_eliminated: false }

beforeEach(() => {
  jest.resetModules()
  mockFrom = jest.fn()
})

// ── Input validation (no DB needed) ────────────────────────────────────────

describe('submit-pick — input validation', () => {
  test('405 for GET request', async () => {
    const handler = loadHandler()
    const res = mockRes()
    await handler({ method: 'GET', body: {} }, res)
    expect(res.status).toHaveBeenCalledWith(405)
  })

  test('200 for OPTIONS preflight', async () => {
    const handler = loadHandler()
    const res = mockRes()
    await handler({ method: 'OPTIONS', body: {} }, res)
    expect(res.status).toHaveBeenCalledWith(200)
  })

  test('400 when email is missing', async () => {
    const handler = loadHandler()
    const res = mockRes()
    await handler({ method: 'POST', body: { team_ids: [1], game_date: '2026-03-21' } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  test('400 when team_ids is missing', async () => {
    const handler = loadHandler()
    const res = mockRes()
    await handler({ method: 'POST', body: { email: 'test@test.com', game_date: '2026-03-21' } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  test('400 when team_ids is empty array', async () => {
    const handler = loadHandler()
    const res = mockRes()
    await handler({ method: 'POST', body: { email: 'test@test.com', team_ids: [], game_date: '2026-03-21' } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  test('400 when game_date is missing', async () => {
    const handler = loadHandler()
    const res = mockRes()
    await handler({ method: 'POST', body: { email: 'test@test.com', team_ids: [1] } }, res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

// ── Participant validation ──────────────────────────────────────────────────

describe('submit-pick — participant validation', () => {
  test('404 when participant is not found by email', async () => {
    mockFrom.mockReturnValue(chain({ data: null, error: null }))
    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'nobody@test.com', team_ids: [1], game_date: '2026-03-21' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'not_found' }))
  })

  test('403 when participant is eliminated', async () => {
    mockFrom.mockReturnValue(chain({ data: { ...PARTICIPANT, is_eliminated: true }, error: null }))
    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-21' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'eliminated' }))
  })

  test('unpaid participant is marked paid before proceeding', async () => {
    // First from() call → participant lookup (not paid)
    // Subsequent calls → update is_paid, tournament_days, teams, picks, insert, email
    const updateChain = chain({ data: null, error: null })
    mockFrom
      .mockReturnValueOnce(chain({ data: { ...PARTICIPANT, is_paid: false }, error: null }))
      .mockReturnValueOnce(updateChain)                                          // update is_paid
      .mockReturnValueOnce(chain({ data: DAY_R32, error: null }))                // tournament_days
      .mockReturnValueOnce(chain({ data: [TEAM1], error: null }))                // teams
      .mockReturnValueOnce(chain({ data: [], error: null }))                     // prior picks
      .mockReturnValueOnce(chain({ error: null }))                               // picks insert
      .mockReturnValueOnce(chain({ data: { email: 'test@test.com' }, error: null })) // email lookup

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-21' } },
      res
    )
    // Should succeed (200) and the update chain should have been called
    expect(res.status).toHaveBeenCalledWith(200)
    expect(updateChain.update).toHaveBeenCalledWith({ is_paid: true })
  })
})

// ── Deadline validation ────────────────────────────────────────────────────

describe('submit-pick — deadline', () => {
  test('403 when deadline has passed', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({
        data: { ...DAY_R32, deadline: '2020-01-01T00:00:00Z' }, // past
        error: null,
      }))

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-21' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'deadline_passed' }))
  })

  test('no deadline set — submission is always allowed', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: { ...DAY_R32, deadline: null }, error: null }))
      .mockReturnValueOnce(chain({ data: [TEAM1], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ data: { email: 'test@test.com' }, error: null }))

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-21' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(200)
  })
})

// ── Pick count validation ──────────────────────────────────────────────────

describe('submit-pick — pick count', () => {
  test('400 when Round of 64 receives only 1 pick (requires 2)', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: DAY_R64, error: null }))

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-19' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'wrong_pick_count' }))
  })

  test('400 when Round of 32 receives 2 picks (requires 1)', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: DAY_R32, error: null }))

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1, 2], game_date: '2026-03-21' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'wrong_pick_count' }))
  })

  test('wrong_pick_count message includes the round name', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: DAY_R64, error: null }))

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-19' } },
      res
    )
    const { message } = res.json.mock.calls[0][0]
    expect(message).toContain('Round of 64')
  })
})

// ── Team validation ────────────────────────────────────────────────────────

describe('submit-pick — team validation', () => {
  test('400 when team ID does not exist in DB', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: DAY_R32, error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null })) // no teams found

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [999], game_date: '2026-03-21' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_team' }))
  })

  test('400 when picked team is already eliminated from the tournament', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: DAY_R32, error: null }))
      .mockReturnValueOnce(chain({ data: [{ ...TEAM1, is_eliminated: true }], error: null }))

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-21' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'team_eliminated' }))
  })

  test('400 when same team ID appears twice in submission', async () => {
    // Sending [1,1] for R64 — Supabase IN deduplicates, returns only 1 row
    // So teamsData.length (1) !== team_ids.length (2) → invalid_team fires first
    // NOTE: the `duplicate_team` check at line 113 is unreachable for same-id duplicates
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: DAY_R64, error: null }))
      .mockReturnValueOnce(chain({ data: [TEAM1], error: null })) // only 1 row returned for IN(1,1)

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1, 1], game_date: '2026-03-19' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(400)
    // invalid_team fires before duplicate_team due to length mismatch
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_team' }))
  })

  test('400 when team was already used on a different day', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: DAY_R32, error: null }))
      .mockReturnValueOnce(chain({ data: [TEAM1], error: null }))          // teams found
      .mockReturnValueOnce(chain({                                          // prior uses — team already picked
        data: [{ team_id: 1, teams: { name: 'Duke' } }],
        error: null,
      }))

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-21' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'team_already_used' }))
  })

  test('team_already_used message includes the team name', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: DAY_R32, error: null }))
      .mockReturnValueOnce(chain({ data: [TEAM1], error: null }))
      .mockReturnValueOnce(chain({ data: [{ team_id: 1, teams: { name: 'Duke' } }], error: null }))

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-21' } },
      res
    )
    expect(res.json.mock.calls[0][0].message).toContain('Duke')
  })
})

// ── Successful submission ──────────────────────────────────────────────────

describe('submit-pick — success', () => {
  test('200 on valid R32 single pick', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))              // participant
      .mockReturnValueOnce(chain({ data: DAY_R32, error: null }))                  // tournament_days
      .mockReturnValueOnce(chain({ data: [TEAM1], error: null }))                  // teams
      .mockReturnValueOnce(chain({ data: [], error: null }))                        // prior picks (none)
      .mockReturnValueOnce(chain({ error: null }))                                  // picks insert
      .mockReturnValueOnce(chain({ data: { email: 'test@test.com' }, error: null })) // email lookup

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-21' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(200)
    const body = res.json.mock.calls[0][0]
    expect(body.success).toBe(true)
    expect(body.participant_name).toBe('Test User')
    expect(body.picks).toHaveLength(1)
    expect(body.picks[0].name).toBe('Duke')
  })

  test('200 on valid R64 two-pick submission', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: DAY_R64, error: null }))
      .mockReturnValueOnce(chain({ data: [TEAM1, TEAM2], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ data: { email: 'test@test.com' }, error: null }))

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1, 2], game_date: '2026-03-19' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json.mock.calls[0][0].picks).toHaveLength(2)
  })

  test('409 when picks already exist and clear_first is not set', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: DAY_R32, error: null }))
      .mockReturnValueOnce(chain({ data: [TEAM1], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ error: { code: '23505', message: 'duplicate key' } })) // insert fails

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-21' } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'already_picked' }))
  })

  test('clear_first deletes existing picks before inserting', async () => {
    const deleteChain = chain({ data: null, error: null })
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: DAY_R32, error: null }))
      .mockReturnValueOnce(chain({ data: [TEAM1], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(deleteChain)                                              // delete existing picks
      .mockReturnValueOnce(chain({ error: null }))                                   // insert new picks
      .mockReturnValueOnce(chain({ data: { email: 'test@test.com' }, error: null })) // email lookup

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-21', clear_first: true } },
      res
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(deleteChain.delete).toHaveBeenCalled()
  })

  test('email send failure does not prevent successful pick submission', async () => {
    mockFrom
      .mockReturnValueOnce(chain({ data: PARTICIPANT, error: null }))
      .mockReturnValueOnce(chain({ data: DAY_R32, error: null }))
      .mockReturnValueOnce(chain({ data: [TEAM1], error: null }))
      .mockReturnValueOnce(chain({ data: [], error: null }))
      .mockReturnValueOnce(chain({ error: null }))
      .mockReturnValueOnce(chain({ data: null, error: { message: 'no email' } })) // email lookup fails

    const handler = loadHandler()
    const res = mockRes()
    await handler(
      { method: 'POST', body: { email: 'test@test.com', team_ids: [1], game_date: '2026-03-21' } },
      res
    )
    // Should still return 200 even if email lookup fails
    expect(res.status).toHaveBeenCalledWith(200)
  })
})
