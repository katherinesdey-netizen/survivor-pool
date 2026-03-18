// Vercel Serverless Function — manually triggered from Admin panel
// POST /api/send-recap
// Body: { recap_id }
// Sends a recap email to all paid participants.

const { createClient } = require('@supabase/supabase-js')
const { Resend } = require('resend')

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Auth: require CRON_SECRET bearer token
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.authorization !== `Bearer ${secret}`)
    return res.status(401).json({ error: 'Unauthorized' })

  const { recap_id, test_email } = req.body || {}
  if (!recap_id) return res.status(400).json({ error: 'Missing recap_id' })

  try {
    // Fetch the recap
    const { data: recap, error: rErr } = await supabase
      .from('recaps')
      .select('id, title, body, game_date')
      .eq('id', recap_id)
      .single()

    if (rErr || !recap) return res.status(404).json({ error: 'Recap not found' })

    const resend = new Resend(process.env.RESEND_API_KEY)

    const dateLabel = new Date(recap.game_date + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    })

    const subject = test_email
      ? `[TEST] 📊 ${recap.title} — Adam's Survivor Pool`
      : `📊 ${recap.title} — Adam's Survivor Pool`
    const html = recapHtml(recap.title, recap.body, dateLabel)

    // Test mode: send only to the provided address
    if (test_email) {
      await resend.emails.send({
        from: 'Adam Furtado <adam@adamssurvivorpool.com>',
        to: [test_email],
        subject,
        html,
      })
      return res.status(200).json({ sent: 1, total: 1, test: true })
    }

    // Get all paid participants
    const { data: participants } = await supabase
      .from('participants')
      .select('email, full_name')
      .eq('is_paid', true)

    if (!participants || participants.length === 0)
      return res.status(200).json({ message: 'No paid participants found.', sent: 0 })

    // Use Resend batch API — one email object per person so each recipient
    // gets their own email (not a group send where everyone sees each other).
    // Resend batch.send() supports up to 100 per call.
    const batchSize = 100
    let sentCount = 0

    for (let i = 0; i < participants.length; i += batchSize) {
      const chunk = participants.slice(i, i + batchSize)
      try {
        await resend.batch.send(
          chunk.map(p => ({
            from: 'Adam Furtado <adam@adamssurvivorpool.com>',
            to: [p.email],
            subject,
            html,
          }))
        )
        sentCount += chunk.length
      } catch (batchErr) {
        console.error(`Batch ${i}–${i + batchSize} failed:`, batchErr.message)
      }
    }

    return res.status(200).json({ sent: sentCount, total: participants.length })
  } catch (err) {
    console.error('send-recap error:', err)
    return res.status(500).json({ error: err.message })
  }
}

// Extract YouTube video ID from a URL, or return null
function getYouTubeId(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  return m ? m[1] : null
}

// Convert plain recap body text to HTML
// Handles: **bold**, newlines, [img:url], bare image URLs, YouTube URLs
function formatRecapBody(text) {
  if (!text) return ''

  return text
    .split('\n')
    .map(line => {
      const trimmed = line.trim()
      if (!trimmed) return '<br>'

      // YouTube URL → clickable thumbnail
      const youtubeId = getYouTubeId(trimmed)
      if (youtubeId && trimmed.match(/^https?:\/\//)) {
        const thumb = `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`
        const link = `https://www.youtube.com/watch?v=${youtubeId}`
        return `<a href="${link}" style="display:block;text-decoration:none;margin:12px 0;">` +
          `<img src="${thumb}" style="max-width:100%;border-radius:8px;display:block;" alt="YouTube video">` +
          `<div style="color:#a5b4fc;font-size:13px;font-weight:600;margin-top:6px;">▶ Watch on YouTube</div>` +
          `</a>`
      }

      // Image markers: [img:url] or bare image URLs
      const imgMatch = trimmed.match(/^\[img:(https?:\/\/[^\]]+)\]$/)
      if (imgMatch) {
        return `<img src="${imgMatch[1]}" style="max-width:100%;border-radius:8px;margin:8px 0;" alt="">`
      }
      if (/^https?:\/\/\S+\.(jpg|jpeg|gif|png|webp)(\?.*)?$/i.test(trimmed)) {
        return `<img src="${trimmed}" style="max-width:100%;border-radius:8px;margin:8px 0;" alt="">`
      }

      // Bold: **text**
      const formatted = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

      return `<p style="margin:0 0 12px;color:rgba(255,255,255,0.8);font-size:15px;line-height:1.7;">${formatted}</p>`
    })
    .join('')
}

function recapHtml(title, body, dateLabel) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">
  <div style="text-align:center;margin-bottom:28px;">
    <div style="font-size:40px;margin-bottom:8px;">🏀</div>
    <h1 style="color:#fff;font-size:20px;font-weight:700;margin:0 0 4px;letter-spacing:-0.02em;">Adam's Survivor Pool</h1>
    <div style="font-size:13px;color:rgba(255,255,255,0.4);">${dateLabel}</div>
  </div>
  <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px;">
    <h2 style="color:#fff;font-size:20px;font-weight:700;margin:0 0 20px;line-height:1.3;">${title}</h2>
    <div>${formatRecapBody(body)}</div>
    <div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:24px;padding-top:20px;">
      <a href="https://adamssurvivorpool.com/standings"
         style="display:inline-block;background:rgba(255,107,0,0.15);color:#ff6b00;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;border:1px solid rgba(255,107,0,0.3);">
        View Full Standings →
      </a>
    </div>
  </div>
  <p style="text-align:center;color:rgba(255,255,255,0.2);font-size:12px;margin-top:20px;">
    Adam's Survivor Pool · <a href="https://adamssurvivorpool.com" style="color:rgba(255,255,255,0.3);">adamssurvivorpool.com</a>
  </p>
</div>
</body></html>`
}
