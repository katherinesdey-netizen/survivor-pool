// Vercel Serverless Function — send pick confirmation email to logged-in users
// POST /api/send-pick-confirmation
// Body: { participant_id, team_ids, game_date }

const { createClient } = require('@supabase/supabase-js')
const { Resend } = require('resend')

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { participant_id, team_ids, game_date } = req.body || {}
  if (!participant_id || !team_ids || !game_date) {
    return res.status(400).json({ error: 'Missing required fields' })
  }

  try {
    // Fetch participant (need email + name)
    const { data: participant } = await supabase
      .from('participants')
      .select('full_name, email')
      .eq('id', participant_id)
      .single()

    if (!participant?.email) return res.status(200).json({ skipped: 'no email on file' })

    // Fetch team details
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name, seed, region')
      .in('id', team_ids)

    if (!teams || teams.length === 0) return res.status(200).json({ skipped: 'no teams found' })

    // Fetch round name
    const { data: day } = await supabase
      .from('tournament_days')
      .select('round_name')
      .eq('game_date', game_date)
      .single()

    const roundName = day?.round_name || 'Tournament'
    const dateLabel = new Date(game_date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    })

    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'Adams Survivor Pool <noreply@adamssurvivorpool.com>',
      to: participant.email,
      subject: `✅ Pick confirmed — ${teams.map(t => t.name).join(' & ')}`,
      html: pickConfirmationHtml(participant.full_name, teams, roundName, dateLabel),
    })

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('send-pick-confirmation error:', err)
    return res.status(500).json({ error: 'email_failed' })
  }
}

function pickConfirmationHtml(name, teams, roundName, dateLabel) {
  const teamRows = teams.map(t =>
    `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:8px;margin-bottom:8px;">
      <span style="background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.5);font-size:11px;font-weight:700;padding:3px 7px;border-radius:4px;">#${t.seed}</span>
      <span style="color:#fff;font-size:15px;font-weight:600;">${t.name}</span>
      <span style="margin-left:auto;color:#4ade80;font-size:14px;">✓</span>
    </div>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:32px 20px;">
  <div style="text-align:center;margin-bottom:28px;">
    <div style="font-size:40px;margin-bottom:8px;">✅</div>
    <h1 style="color:#fff;font-size:20px;font-weight:700;margin:0;letter-spacing:-0.02em;">Adams Survivor Pool</h1>
  </div>
  <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px;">
    <p style="color:#fff;font-size:16px;font-weight:600;margin:0 0 6px;">Hey ${name},</p>
    <p style="color:rgba(255,255,255,0.6);font-size:13px;margin:0 0 20px;">${roundName} · ${dateLabel}</p>
    <p style="color:rgba(255,255,255,0.75);font-size:15px;margin:0 0 16px;">Your ${teams.length > 1 ? 'picks are' : 'pick is'} locked in:</p>
    ${teamRows}
    <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:20px 0 0;line-height:1.6;">Good luck! Results will be updated after games complete.</p>
  </div>
  <p style="text-align:center;color:rgba(255,255,255,0.2);font-size:12px;margin-top:20px;">
    Adams Survivor Pool · <a href="https://adamssurvivorpool.com" style="color:rgba(255,255,255,0.3);">adamssurvivorpool.com</a>
  </p>
</div>
</body></html>`
}
