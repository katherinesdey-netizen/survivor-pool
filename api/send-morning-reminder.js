// Vercel Serverless Function — cron: 0 13 * * * (9 AM ET daily)
// Sends morning pick reminder to all paid, non-eliminated participants
// who haven't submitted their pick yet today.

const { createClient } = require('@supabase/supabase-js')
const { Resend } = require('resend')

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  // Auth check for manual POST triggers
  if (req.method === 'POST') {
    const secret = process.env.CRON_SECRET
    if (secret && req.headers.authorization !== `Bearer ${secret}`)
      return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

    // Find today's tournament day that hasn't had the morning reminder sent yet
    const { data: day } = await supabase
      .from('tournament_days')
      .select('id, game_date, round_name, deadline, picks_required')
      .eq('game_date', todayET)
      .eq('morning_reminder_sent', false)
      .maybeSingle()

    if (!day) return res.status(200).json({ message: 'No morning reminder needed today.' })

    // If deadline has already passed, skip
    if (new Date() > new Date(day.deadline))
      return res.status(200).json({ message: 'Deadline already passed — skipping.' })

    // Find participants who haven't picked today yet
    const { data: pickedToday } = await supabase
      .from('picks')
      .select('participant_id')
      .eq('game_date', todayET)

    const pickedIds = new Set((pickedToday || []).map(p => p.participant_id))

    const { data: participants } = await supabase
      .from('participants')
      .select('id, full_name, email')
      .eq('is_paid', true)
      .eq('is_eliminated', false)

    const unpicked = (participants || []).filter(p => !pickedIds.has(p.id))

    // Mark sent even if everyone has picked (no need to try again)
    await supabase.from('tournament_days')
      .update({ morning_reminder_sent: true })
      .eq('id', day.id)

    if (unpicked.length === 0)
      return res.status(200).json({ message: 'All participants have picked. No emails sent.' })

    const deadlineStr = new Date(day.deadline).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short'
    })

    const resend = new Resend(process.env.RESEND_API_KEY)
    let sentCount = 0

    for (const p of unpicked) {
      try {
        await resend.emails.send({
          from: 'Adams Survivor Pool <noreply@adamssurvivorpool.com>',
          to: p.email,
          subject: `🏀 Don't forget your pick — ${day.round_name}`,
          html: morningReminderHtml(p.full_name, day.round_name, deadlineStr, day.picks_required),
        })
        sentCount++
      } catch (emailErr) {
        console.error(`Failed to email ${p.email}:`, emailErr.message)
      }
    }

    return res.status(200).json({ sent: sentCount, total: unpicked.length })
  } catch (err) {
    console.error('send-morning-reminder error:', err)
    return res.status(500).json({ error: err.message })
  }
}

function morningReminderHtml(name, roundName, deadline, picksRequired) {
  const pickWord = picksRequired > 1 ? `${picksRequired} picks` : 'pick'
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:32px 20px;">
  <div style="text-align:center;margin-bottom:28px;">
    <div style="font-size:40px;margin-bottom:8px;">🏀</div>
    <h1 style="color:#fff;font-size:20px;font-weight:700;margin:0;letter-spacing:-0.02em;">Adams Survivor Pool</h1>
  </div>
  <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px;">
    <p style="color:#fff;font-size:16px;font-weight:600;margin:0 0 10px;">Hey ${name} 👋</p>
    <p style="color:rgba(255,255,255,0.75);font-size:15px;line-height:1.6;margin:0 0 24px;">
      You haven't submitted your ${pickWord} yet for today's <strong style="color:#fff;">${roundName}</strong> games. Don't get auto-assigned the worst seed!
    </p>
    <div style="background:rgba(255,107,0,0.12);border:1px solid rgba(255,107,0,0.35);border-radius:10px;padding:14px 18px;margin-bottom:24px;">
      <div style="font-size:11px;color:rgba(255,107,0,0.8);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:4px;">Deadline</div>
      <div style="font-size:20px;font-weight:700;color:#ff6b00;">${deadline}</div>
    </div>
    <a href="https://adamssurvivorpool.com/pick"
       style="display:block;background:#ff6b00;color:#fff;text-decoration:none;text-align:center;padding:14px 20px;border-radius:10px;font-size:16px;font-weight:700;letter-spacing:-0.01em;">
      Submit Your Pick →
    </a>
  </div>
  <p style="text-align:center;color:rgba(255,255,255,0.2);font-size:12px;margin-top:20px;">
    Adams Survivor Pool · <a href="https://adamssurvivorpool.com" style="color:rgba(255,255,255,0.3);">adamssurvivorpool.com</a>
  </p>
</div>
</body></html>`
}
