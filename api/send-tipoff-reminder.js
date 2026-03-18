// Vercel Serverless Function — cron: */30 11-22 * * * (every 30 min, 11 AM–10 PM UTC)
// Sends a "tipoff in ~1 hour" reminder to unpicked participants.
// Only fires once per day, when current time is 50–70 minutes before first game.

const { createClient } = require('@supabase/supabase-js')
const { Resend } = require('resend')

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end()

  if (req.method === 'POST') {
    const secret = process.env.CRON_SECRET
    if (secret && req.headers.authorization !== `Bearer ${secret}`)
      return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const now = new Date()
    const todayET = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

    // Find today's tournament day that hasn't had tipoff reminder sent
    const { data: day } = await supabase
      .from('tournament_days')
      .select('id, game_date, round_name, deadline, picks_required')
      .eq('game_date', todayET)
      .eq('tipoff_reminder_sent', false)
      .maybeSingle()

    if (!day) return res.status(200).json({ message: 'No tipoff reminder needed today.' })

    // Skip if deadline already passed
    if (now > new Date(day.deadline))
      return res.status(200).json({ message: 'Deadline already passed.' })

    // Get the earliest game tip time today
    const { data: games } = await supabase
      .from('games')
      .select('tip_time')
      .eq('game_date', todayET)
      .not('tip_time', 'is', null)
      .order('tip_time', { ascending: true })
      .limit(1)

    // Fallback: use deadline as tip proxy if no tip times stored
    const firstTipTime = (games && games.length > 0 && games[0].tip_time)
      ? new Date(games[0].tip_time)
      : new Date(new Date(day.deadline).getTime() + 30 * 60 * 1000) // deadline + 30 min

    const minutesUntilTip = (firstTipTime - now) / 60000

    // Only send within the 50–70 minute window before first tip
    if (minutesUntilTip < 50 || minutesUntilTip > 70) {
      return res.status(200).json({
        message: `${Math.round(minutesUntilTip)} min to tip — not in send window (50-70 min).`
      })
    }

    // Get unpicked participants
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

    // Mark sent regardless so we don't keep checking
    await supabase.from('tournament_days')
      .update({ tipoff_reminder_sent: true })
      .eq('id', day.id)

    if (unpicked.length === 0)
      return res.status(200).json({ message: 'All participants have picked. No emails sent.' })

    const deadlineStr = new Date(day.deadline).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short'
    })
    const tipStr = firstTipTime.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short'
    })

    const resend = new Resend(process.env.RESEND_API_KEY)
    let sentCount = 0

    for (const p of unpicked) {
      try {
        await resend.emails.send({
          from: 'Adam Furtado <adam@adamssurvivorpool.com>',
          to: p.email,
          subject: `⏰ First game tips off in ~1 hour — submit your pick!`,
          html: tipoffReminderHtml(p.full_name, day.round_name, deadlineStr, tipStr, day.picks_required),
        })
        sentCount++
      } catch (emailErr) {
        console.error(`Failed to email ${p.email}:`, emailErr.message)
      }
    }

    return res.status(200).json({ sent: sentCount, total: unpicked.length })
  } catch (err) {
    console.error('send-tipoff-reminder error:', err)
    return res.status(500).json({ error: err.message })
  }
}

function tipoffReminderHtml(name, roundName, deadline, tipTime, picksRequired) {
  const pickWord = picksRequired > 1 ? `${picksRequired} picks` : 'pick'
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:32px 20px;">
  <div style="text-align:center;margin-bottom:28px;">
    <div style="font-size:40px;margin-bottom:8px;">⏰</div>
    <h1 style="color:#fff;font-size:20px;font-weight:700;margin:0;letter-spacing:-0.02em;">Adam's Survivor Pool</h1>
  </div>
  <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px;">
    <p style="color:#fff;font-size:16px;font-weight:600;margin:0 0 10px;">Hey ${name},</p>
    <p style="color:rgba(255,255,255,0.75);font-size:15px;line-height:1.6;margin:0 0 20px;">
      The first <strong style="color:#fff;">${roundName}</strong> game tips off in about an hour and you still haven't submitted your ${pickWord}!
    </p>
    <div style="display:flex;gap:12px;margin-bottom:24px;">
      <div style="flex:1;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.3);border-radius:10px;padding:12px 14px;">
        <div style="font-size:10px;color:rgba(248,113,113,0.8);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:3px;">Deadline</div>
        <div style="font-size:16px;font-weight:700;color:#f87171;">${deadline}</div>
      </div>
      <div style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px 14px;">
        <div style="font-size:10px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:3px;">First Tip</div>
        <div style="font-size:16px;font-weight:700;color:#fff;">${tipTime}</div>
      </div>
    </div>
    <a href="https://adamssurvivorpool.com/pick"
       style="display:block;background:#ff6b00;color:#fff;text-decoration:none;text-align:center;padding:14px 20px;border-radius:10px;font-size:16px;font-weight:700;">
      Submit Your Pick Now →
    </a>
  </div>
  <p style="text-align:center;color:rgba(255,255,255,0.2);font-size:12px;margin-top:20px;">
    Adam's Survivor Pool · <a href="https://adamssurvivorpool.com" style="color:rgba(255,255,255,0.3);">adamssurvivorpool.com</a>
  </p>
</div>
</body></html>`
}
