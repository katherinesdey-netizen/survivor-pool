// Vercel Serverless Function — look up guest participant + all data needed for pick page
// POST /api/lookup-participant
// Body: { email: string, name?: string }
// Returns: { participant, today, last_day, teams, games, picks } or { needs_name: true } or error

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service key bypasses RLS
)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, name } = req.body || {}
  if (!email) return res.status(400).json({ error: 'Missing email' })

  try {
    // ── 1. Look up participant ─────────────────────────────
    let { data: participant, error: pErr } = await supabase
      .from('participants')
      .select('id, full_name, is_paid, is_eliminated')
      .ilike('email', email.trim())
      .maybeSingle()

    if (pErr) throw pErr

    if (!participant) {
      // New email — if no name provided yet, ask the frontend for one
      if (!name || !name.trim()) {
        return res.status(200).json({ needs_name: true })
      }

      // Create the new participant (id has no default — generate a UUID)
      const { randomUUID } = require('crypto')
      const { data: created, error: createErr } = await supabase
        .from('participants')
        .insert({ id: randomUUID(), full_name: name.trim(), email: email.trim().toLowerCase(), is_paid: true, is_eliminated: false })
        .select('id, full_name, is_paid, is_eliminated')
        .single()

      if (createErr) throw createErr
      participant = created
    }

    if (!participant.is_paid) {
      return res.status(403).json({
        error: 'not_paid',
        message: "Your entry fee hasn't been confirmed yet. Contact the pool admin."
      })
    }
    if (participant.is_eliminated) {
      return res.status(403).json({
        error: 'eliminated',
        message: "You've been eliminated from the pool. Better luck next year! 😢"
      })
    }

    // ── 2. Find today's open tournament day ───────────────
    const todayStr = new Date().toISOString().split('T')[0]
    const { data: daysData } = await supabase
      .from('tournament_days')
      .select('game_date, round_name, deadline, picks_required')
      .gte('game_date', todayStr)
      .order('game_date', { ascending: true })

    const now = new Date()
    const today = (daysData || []).find(d => !d.deadline || now < new Date(d.deadline)) ?? null

    // ── 3. Fetch remaining data in parallel ───────────────
    const [teamsResult, gamesResult, picksResult] = await Promise.all([
      supabase.from('teams').select('id, name, seed, region').eq('is_eliminated', false).order('seed'),
      today
        ? supabase.from('games').select('team1_id, team2_id').eq('game_date', today.game_date)
        : Promise.resolve({ data: [] }),
      supabase
        .from('picks')
        .select('team_id, game_date, teams(name, seed, region)')
        .eq('participant_id', participant.id),
    ])

    // Flatten picks so they JSON-serialize cleanly
    const picks = (picksResult.data || []).map((pk) => ({
      team_id: pk.team_id,
      game_date: pk.game_date,
      team_name: pk.teams?.name ?? null,
      team_seed: pk.teams?.seed ?? null,
      team_region: pk.teams?.region ?? null,
    }))

    return res.status(200).json({
      participant,
      today,                              // null if no open day
      last_day: today === null ? (daysData?.[0] ?? null) : null,
      teams: teamsResult.data || [],
      games: gamesResult.data || [],
      picks,
    })

  } catch (err) {
    console.error('lookup-participant error:', err)
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' })
  }
}
