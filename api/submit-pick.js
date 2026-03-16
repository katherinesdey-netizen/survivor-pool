// Vercel Serverless Function — no-auth pick submission
// POST /api/submit-pick
// Body: { email, team_ids: number[], game_date, clear_first?: boolean }

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

  const { email, team_ids, game_date, clear_first } = req.body || {}

  if (!email || !team_ids || !Array.isArray(team_ids) || team_ids.length === 0 || !game_date) {
    return res.status(400).json({ error: 'Missing required fields: email, team_ids (array), game_date' })
  }

  try {
    // ── 1. Look up participant ─────────────────────────────
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
      .select('game_date, round_name, deadline, picks_required')
      .eq('game_date', game_date)
      .maybeSingle()

    if (dErr) throw dErr
    if (!day) return res.status(400).json({ error: 'invalid_date', message: 'No tournament game scheduled for that date.' })

    if (day.deadline && new Date() > new Date(day.deadline)) {
      return res.status(403).json({
        error: 'deadline_passed',
        message: `The deadline for ${day.round_name} has passed.`
      })
    }

    const picksRequired = day.picks_required || 1

    if (team_ids.length !== picksRequired) {
      return res.status(400).json({
        error: 'wrong_pick_count',
        message: `${day.round_name} requires exactly ${picksRequired} pick${picksRequired > 1 ? 's' : ''}.`
      })
    }

    // ── 3. Validate all teams ─────────────────────────────
    const { data: teamsData, error: tErr } = await supabase
      .from('teams')
      .select('id, name, seed, region, is_eliminated')
      .in('id', team_ids)

    if (tErr) throw tErr

    if (!teamsData || teamsData.length !== team_ids.length) {
      return res.status(400).json({ error: 'invalid_team', message: 'One or more teams not found.' })
    }

    const eliminatedTeam = teamsData.find(t => t.is_eliminated)
    if (eliminatedTeam) {
      return res.status(400).json({
        error: 'team_eliminated',
        message: `${eliminatedTeam.name} has already been eliminated from the tournament.`
      })
    }

    // No duplicate teams within the same submission
    if (new Set(team_ids).size !== team_ids.length) {
      return res.status(400).json({ error: 'duplicate_team', message: 'You cannot pick the same team twice.' })
    }

    // ── 4. Check teams not used in a previous round ───────
    const { data: priorUses } = await supabase
      .from('picks')
      .select('team_id, teams(name)')
      .eq('participant_id', participant.id)
      .in('team_id', team_ids)
      .neq('game_date', game_date)

    if (priorUses && priorUses.length > 0) {
      const usedName = priorUses[0].teams?.name || 'A team you selected'
      return res.status(400).json({
        error: 'team_already_used',
        message: `${usedName} was already used on a previous day. Each team can only be picked once.`
      })
    }

    // ── 5. Clear existing picks for today if requested ────
    if (clear_first) {
      const { error: delErr } = await supabase
        .from('picks')
        .delete()
        .eq('participant_id', participant.id)
        .eq('game_date', game_date)

      if (delErr) throw delErr
    }

    // ── 6. Insert all picks ───────────────────────────────
    const rows = team_ids.map(tid => ({
      participant_id: participant.id,
      team_id: tid,
      game_date,
      result: 'pending',
      is_auto_assigned: false,
    }))

    const { error: insertErr } = await supabase
      .from('picks')
      .insert(rows)

    if (insertErr) {
      // Likely a duplicate (already picked) — surface a friendly error
      return res.status(409).json({
        error: 'already_picked',
        message: 'You already have picks for this day. Use "Change my picks" to update them.'
      })
    }

    return res.status(200).json({
      success: true,
      participant_name: participant.full_name,
      picks: teamsData.map(t => ({ name: t.name, seed: t.seed, region: t.region })),
      round_name: day.round_name,
      game_date,
    })

  } catch (err) {
    console.error('submit-pick error:', err)
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' })
  }
}
