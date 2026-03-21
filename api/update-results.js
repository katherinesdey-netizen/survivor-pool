// Vercel Serverless Function — runs as a cron job every 5 minutes
// Also callable manually from the Admin panel via POST request

const { createClient } = require('@supabase/supabase-js')
const { Resend } = require('resend')

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // needs service key to bypass RLS
)

// Fetch NCAA scores from ESPN for a given date (YYYYMMDD string)
async function fetchESPNScores(dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&_=${Date.now()}`
  const res = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } })
  if (!res.ok) throw new Error(`ESPN API error: ${res.status}`)
  const data = await res.json()
  return data.events || []
}

// Return ET date string offset by `daysAgo` (0 = today, 1 = yesterday)
function etDateStr(daysAgo = 0) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

// Extract completed games with winner/loser from ESPN data
// Captures ESPN's numeric team ID for exact DB matching
function parseCompletedGames(events) {
  const results = []

  for (const event of events) {
    const status = event.status?.type
    if (!status?.completed) continue // skip games not finished

    const competitors = event.competitions?.[0]?.competitors || []
    if (competitors.length !== 2) continue

    const winner = competitors.find(c => c.winner === true)
    const loser = competitors.find(c => c.winner === false)
    if (!winner || !loser) continue

    results.push({
      winnerName: winner.team.displayName,
      loserName: loser.team.displayName,
      winnerId: parseInt(winner.team.id, 10),
      loserId: parseInt(loser.team.id, 10),
      gameDate: event.date ? new Date(event.date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : null
    })
  }

  return results
}

// Find a team in our DB by ESPN numeric ID (exact), falling back to name match
// Also back-fills espn_id in the DB on first name-based match so future lookups are exact
async function findTeamByName(espnName, espnId) {
  // Primary: exact match on espn_id column — always correct
  if (espnId) {
    const { data: byId } = await supabase
      .from('teams')
      .select('id, name')
      .eq('espn_id', espnId)
      .maybeSingle()
    if (byId) return byId
  }

  // Fallback 1: exact case-insensitive name match
  const { data: exact } = await supabase
    .from('teams')
    .select('id, name')
    .ilike('name', espnName)
    .maybeSingle()
  if (exact) {
    if (espnId) await supabase.from('teams').update({ espn_id: espnId }).eq('id', exact.id)
    return exact
  }

  // Fallback 2: ESPN often returns "Duke Blue Devils" but DB has "Duke"
  // Require the DB name to be at least 5 chars and match as a whole word to avoid
  // short/ambiguous names (e.g. "Miami") incorrectly matching "Miami (OH)"
  const { data: allTeams } = await supabase.from('teams').select('id, name')
  const espnLower = espnName.toLowerCase()
  const match = (allTeams || []).find(t => {
    const dbName = t.name.toLowerCase()
    if (dbName.length < 5) return false // too short to match safely
    // Only match if the DB name appears as a word boundary in the ESPN name,
    // AND the ESPN name starts with the DB name (avoids Miami ⊂ Miami (OH))
    return espnLower.startsWith(dbName) || espnLower === dbName
  })
  if (match && espnId) await supabase.from('teams').update({ espn_id: espnId }).eq('id', match.id)
  return match || null
}

// Main processing function
async function processResults() {
  const log = []

  try {
    // 1. Fetch scores from ESPN — today AND yesterday (catches any missed results)
    const todayET = etDateStr(0)
    const yesterdayET = etDateStr(1)
    log.push(`Fetching ESPN scores... today=${todayET} yesterday=${yesterdayET}`)

    const [todayEvents, yesterdayEvents] = await Promise.all([
      fetchESPNScores(todayET.replace(/-/g, '')),
      fetchESPNScores(yesterdayET.replace(/-/g, ''))
    ])
    const events = [...todayEvents, ...yesterdayEvents]
    log.push(`Found ${todayEvents.length} games today, ${yesterdayEvents.length} yesterday`)

    const completedGames = parseCompletedGames(events)
    log.push(`${completedGames.length} games completed`)

    if (completedGames.length === 0) {
      return { success: true, log, message: 'No completed games found.' }
    }

    // 2. For each completed game, update picks using the game's actual ET date
    let picksUpdated = 0

    for (const game of completedGames) {
      const winnerTeam = await findTeamByName(game.winnerName, game.winnerId)
      const loserTeam = await findTeamByName(game.loserName, game.loserId)
      const gameDate = game.gameDate // ET date stored during parseCompletedGames

      log.push(`Game (${gameDate}): ${game.winnerName} beat ${game.loserName}`)
      log.push(`  Matched: winner=${winnerTeam?.name || 'NOT FOUND'}, loser=${loserTeam?.name || 'NOT FOUND'}`)

      // Mark winning picks as won (also corrects any previously wrong result)
      if (winnerTeam) {
        const { count } = await supabase
          .from('picks')
          .update({ result: 'won' })
          .eq('team_id', winnerTeam.id)
          .eq('game_date', gameDate)
          .neq('result', 'won')
        picksUpdated += count || 0
      }

      // Mark losing picks as lost (also corrects any previously wrong result)
      if (loserTeam) {
        const { count } = await supabase
          .from('picks')
          .update({ result: 'lost' })
          .eq('team_id', loserTeam.id)
          .eq('game_date', gameDate)
          .neq('result', 'lost')
        picksUpdated += count || 0

        // Mark losing team as eliminated from tournament
        await supabase
          .from('teams')
          .update({ is_eliminated: true, eliminated_on: gameDate })
          .eq('id', loserTeam.id)
      }
    }

    log.push(`Updated ${picksUpdated} picks`)

    // 3. Check for participant eliminations across all processed dates
    const processedDates = [...new Set(completedGames.map(g => g.gameDate).filter(Boolean))]
    const { data: losingPicks } = await supabase
      .from('picks')
      .select('participant_id, game_date')
      .in('game_date', processedDates)
      .eq('result', 'lost')

    if (losingPicks && losingPicks.length > 0) {
      // Group by participant; use earliest losing date for elimination date
      const elimDateByParticipant = {}
      for (const pick of losingPicks) {
        const prev = elimDateByParticipant[pick.participant_id]
        if (!prev || pick.game_date < prev) elimDateByParticipant[pick.participant_id] = pick.game_date
      }
      const losingParticipantIds = Object.keys(elimDateByParticipant)
      log.push(`Eliminating ${losingParticipantIds.length} participant(s)`)

      // Eliminate each participant with their correct losing date (preserves tie rule)
      const newlyEliminated = []
      for (const participantId of losingParticipantIds) {
        const elimDate = elimDateByParticipant[participantId]
        const { data: updated } = await supabase
          .from('participants')
          .update({ is_eliminated: true, eliminated_on_date: elimDate })
          .eq('id', participantId)
          .eq('is_eliminated', false)
          .select('id, full_name, email')
        if (updated && updated.length > 0) newlyEliminated.push(...updated)
      }

      // Send elimination emails (non-blocking)
      if (newlyEliminated.length > 0) {
        try {
          const resend = new Resend(process.env.RESEND_API_KEY)

          // Get the losing pick details for each eliminated participant
          const { data: losingPickDetails } = await supabase
            .from('picks')
            .select('participant_id, game_date, teams(name, seed)')
            .in('participant_id', newlyEliminated.map(p => p.id))
            .in('game_date', processedDates)
            .eq('result', 'lost')

          const pickByParticipant = {}
          for (const pick of (losingPickDetails || [])) {
            pickByParticipant[pick.participant_id] = pick.teams
          }

          const dateLabel = new Date(todayET + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric'
          })

          for (const p of newlyEliminated) {
            if (!p.email) continue
            const losingTeam = pickByParticipant[p.id]
            await resend.emails.send({
              from: 'Adam Furtado <adam@adamssurvivorpool.com>',
              to: p.email,
              subject: `☠️ You've been eliminated — Adam's Survivor Pool`,
              html: eliminationHtml(p.full_name, losingTeam, dateLabel),
            }).catch(e => console.error(`Elimination email failed for ${p.email}:`, e.message))
          }
          log.push(`Sent ${newlyEliminated.length} elimination email(s)`)
        } catch (emailErr) {
          log.push(`Elimination email error: ${emailErr.message}`)
        }
      }
    }

    return {
      success: true,
      log,
      gamesProcessed: completedGames.length,
      picksUpdated
    }

  } catch (err) {
    log.push(`ERROR: ${err.message}`)
    return { success: false, log, error: err.message }
  }
}

// Vercel serverless handler
module.exports = async (req, res) => {
  // Allow GET (cron) and POST (manual trigger from admin)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Simple auth check for manual POST calls from admin
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET
  
  if (req.method === 'POST') {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const result = await processResults()
  return res.status(result.success ? 200 : 500).json(result)
}

function eliminationHtml(name, team, dateLabel) {
  const teamLine = team
    ? `<div style="background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.2);border-radius:8px;padding:12px 16px;margin:16px 0;display:flex;align-items:center;gap:10px;">
        <span style="background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.4);font-size:11px;font-weight:700;padding:3px 7px;border-radius:4px;">#${team.seed}</span>
        <span style="color:#f87171;font-size:15px;font-weight:600;">${team.name}</span>
        <span style="margin-left:auto;color:#f87171;font-size:18px;">❌</span>
       </div>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:32px 20px;">
  <div style="text-align:center;margin-bottom:28px;">
    <div style="font-size:40px;margin-bottom:8px;">☠️</div>
    <h1 style="color:#fff;font-size:20px;font-weight:700;margin:0;letter-spacing:-0.02em;">Adam's Survivor Pool</h1>
  </div>
  <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px;">
    <p style="color:#fff;font-size:16px;font-weight:600;margin:0 0 10px;">Sorry, ${name}.</p>
    <p style="color:rgba(255,255,255,0.75);font-size:15px;line-height:1.6;margin:0 0 4px;">
      Your pick on <strong style="color:#fff;">${dateLabel}</strong> lost:
    </p>
    ${teamLine}
    <p style="color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin:16px 0 20px;">
      You've been eliminated from the pool. Thanks for playing — better luck next year!
    </p>
    <a href="https://adamssurvivorpool.com/standings"
       style="display:block;background:rgba(255,255,255,0.07);color:rgba(255,255,255,0.7);text-decoration:none;text-align:center;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;border:1px solid rgba(255,255,255,0.1);">
      View Final Standings →
    </a>
  </div>
  <p style="text-align:center;color:rgba(255,255,255,0.2);font-size:12px;margin-top:20px;">
    Adam's Survivor Pool · <a href="https://adamssurvivorpool.com" style="color:rgba(255,255,255,0.3);">adamssurvivorpool.com</a>
  </p>
</div>
</body></html>`
}
