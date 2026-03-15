// Vercel Serverless Function — no-auth pick submission
// POST /api/submit-pick
// Body: { email, team_id, game_date }

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service key bypasses RLS
)

module.exports = async (req, res) => {
  // CORS headers (for localhost dev)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, team_id, game_date } = req.body || {}

  if (!email || !team_id || !game_date) {
    return res.status(400).json({ error: 'Missing required fields: email, team_id, game_date' })
  }

  try {
    // ── 1. Look up participant by email ───────────────────
    const { data: participant, error: pErr } = await supabase
      .from('participants')
      .select('id, full_name, is_paid, is_eliminated')
      .ilike('email', email.trim())
      .maybeSingle()

    if (pErr) throw pErr

    if (!participant) {
      return res.status(404).json({
        error: 'not_found',
        message: "We don't have that email on file. Check for typos or contact the pool admin."
      })
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
        message: "You've been eliminated from the pool. Better luck next year!"
      })
    }

    // ── 2. Validate tournament day + deadline ─────────────
    const { data: day, error: dErr } = await supabase
      .from('tournament_days')
      .select('game_date, round_name, deadline')
      .eq('game_date', game_date)
      .maybeSingle()

    if (dErr) throw dErr

    if (!day) {
      return res.status(400).json({ error: 'invalid_date', message: 'No tournament game scheduled for that date.' })
    }

    if (day.deadline) {
      const deadline = new Date(day.deadline)
      if (new Date() > deadline) {
        return res.status(403).json({
          error: 'deadline_passed',
          message: `The deadline for ${day.round_name} has passed.`
        })
      }
    }

    // ── 3. Validate team ──────────────────────────────────
    const { data: team, error: tErr } = await supabase
      .from('teams')
      .select('id, name, seed, region, is_eliminated')
      .eq('id', team_id)
      .maybeSingle()

    if (tErr) throw tErr

    if (!team) {
      return res.status(400).json({ error: 'invalid_team', message: 'Team not found.' })
    }
    if (team.is_eliminated) {
      return res.status(400).json({
        error: 'team_eliminated',
        message: `${team.name} has already been eliminated from the tournament.`
      })
    }

    // ── 4. Check if team was already used in a previous round ──
    const { data: priorUse } = await supabase
      .from('picks')
      .select('game_date')
      .eq('participant_id', participant.id)
      .eq('team_id', team_id)
      .neq('game_date', game_date) // a different day
      .limit(1)

    if (priorUse && priorUse.length > 0) {
      return res.status(400).json({
        error: 'team_already_used',
        message: `You already used ${team.name} on a previous day. Each team can only be picked once.`
      })
    }

    // ── 5. Upsert the pick (allow changing before deadline) ──
    const { error: insertErr } = await supabase
      .from('picks')
      .upsert(
        {
          participant_id: participant.id,
          team_id: team.id,
          game_date,
          result: 'pending',
          is_auto_assigned: false,
        },
        { onConflict: 'participant_id,game_date' }
      )

    if (insertErr) throw insertErr

    return res.status(200).json({
      success: true,
      participant_name: participant.full_name,
      team_name: team.name,
      team_seed: team.seed,
      round_name: day.round_name,
      game_date,
    })

  } catch (err) {
    console.error('submit-pick error:', err)
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' })
  }
}
