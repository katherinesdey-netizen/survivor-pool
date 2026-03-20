import React, { useEffect, useState, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import StandingsGrid, { GridParticipant, GridPick, GridDay } from '../components/StandingsGrid'
import './DashboardPage.css'

interface MyPick {
  id: number
  game_date: string
  result: string
  is_auto_assigned: boolean
  teams: { name: string; seed: number }
}

interface TournamentDay {
  game_date: string
  round_name: string
  picks_required: number
  deadline: string
  is_complete: boolean
}

interface Recap {
  id: number
  title: string
  body: string
  image_urls: string[]
  game_date: string
}

interface AllParticipant {
  id: string
  full_name: string
  is_eliminated: boolean
  is_paid: boolean
  eliminated_on_date: string | null
}

interface AllPick {
  participant_id: string
  game_date: string
  result: string
  is_auto_assigned: boolean
  teams: { name: string; seed: number }
}

interface DayMeta {
  game_date: string
  round_name: string
}

interface DbGame {
  id: number
  game_date: string
  team1: { id: number; name: string; seed: number; region: string }
  team2: { id: number; name: string; seed: number; region: string }
}

interface EspnTeam {
  team: { displayName: string; shortDisplayName: string; abbreviation: string }
  curatedRank?: { current: number }
  seed?: string
  score: string
  homeAway: string
  winner?: boolean
}

interface EspnGame {
  id: string
  name: string
  date: string
  competitions: [{
    competitors: EspnTeam[]
    broadcasts: { media: { shortName: string } }[]
    status: {
      displayClock: string
      period: number
      type: { name: string; completed: boolean; description: string; shortDetail: string }
    }
  }]
}

export default function DashboardPage() {
  const { participant, loading: authLoading } = useAuth()

  // My data
  const [myPicks, setMyPicks] = useState<MyPick[]>([])
  const [todayInfo, setTodayInfo] = useState<TournamentDay | null>(null)
  const [todayPickCount, setTodayPickCount] = useState(0)
  const [latestRecap, setLatestRecap] = useState<Recap | null>(null)
  const [loading, setLoading] = useState(true)

  // Pool-wide data
  const [allParticipants, setAllParticipants] = useState<AllParticipant[]>([])
  const [allPicks, setAllPicks] = useState<AllPick[]>([]) // eslint-disable-line @typescript-eslint/no-unused-vars
  const [dayMetas, setDayMetas] = useState<DayMeta[]>([]) // eslint-disable-line @typescript-eslint/no-unused-vars
  const [totalPot, setTotalPot] = useState(0)

  // Full standings data
  const [standingsParticipants, setStandingsParticipants] = useState<GridParticipant[]>([])
  const [standingsPicks, setStandingsPicks] = useState<GridPick[]>([])
  const [standingsDays, setStandingsDays] = useState<GridDay[]>([])

  // Games widget
  const [espnGames, setEspnGames] = useState<EspnGame[]>([])
  const [dbGames, setDbGames] = useState<DbGame[]>([])
  const [pickCounts, setPickCounts] = useState<Record<number, number>>({})
  const [scoresLoading, setScoresLoading] = useState(true)
  const allDaysRef = useRef<string[]>([])
  // Map of game_date → deadline string, used to gate pick count display
  const [dayDeadlines, setDayDeadlines] = useState<Record<string, string>>({})

  // Always-current refs so the visibilitychange handler calls the latest fetchData/fetchScores
  const fetchDataRef   = useRef(fetchData)
  const fetchScoresRef = useRef(fetchScores)

  useEffect(() => {
    if (authLoading) return
    if (!participant) { setLoading(false); return }
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant, authLoading])

  // Scores: poll every 30s
  useEffect(() => {
    fetchScores()
    const iv = setInterval(fetchScores, 30000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep refs current after every render
  useEffect(() => { fetchDataRef.current   = fetchData   })
  useEffect(() => { fetchScoresRef.current = fetchScores })

  // Re-fetch when the browser tab becomes visible or is restored from bfcache
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchDataRef.current()
        fetchScoresRef.current()
      }
    }
    // pageshow fires when restoring from back-forward cache (bfcache),
    // which doesn't always trigger visibilitychange
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        fetchDataRef.current()
        fetchScoresRef.current()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Which dates to display in the games widget
  function getDisplayDates(): string[] {
    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    // Round of 64: show Thu Mar 19 alone, or both Thu+Fri on Mar 20
    if (todayET === '2026-03-19') return ['2026-03-19']
    if (todayET === '2026-03-20') return ['2026-03-20', '2026-03-19']
    // Later rounds: show today if it's a tournament day, else next upcoming day
    const days = allDaysRef.current
    if (days.includes(todayET)) return [todayET]
    const next = days.find(d => d > todayET)
    return next ? [next] : []
  }

  async function fetchData() {
    if (!participant) return  // guard for visibilitychange calls before auth is ready
    // Refresh the session token before querying — prevents empty results when
    // the JWT has expired while the tab was in the background
    await supabase.auth.getSession()
    setLoading(true)
    const giveUp = setTimeout(() => setLoading(false), 8000)
    try {
      const today = new Date().toISOString().split('T')[0]

      const [
        { data: myPicksData },
        { data: dayData },
        { data: allParticipantsData },
        { data: allPicksData },
        { data: daysData },
        { count: paidCount },
        { data: recapData },
        { data: allDaysData },
      ] = await Promise.all([
        supabase.from('picks')
          .select('id, game_date, result, is_auto_assigned, teams(name, seed)')
          .eq('participant_id', participant!.id)
          .order('game_date', { ascending: true }),

        supabase.from('tournament_days')
          .select('game_date, round_name, picks_required, deadline, is_complete')
          .gte('game_date', today)
          .order('game_date', { ascending: true })
          .limit(1),

        supabase.from('participants')
          .select('id, full_name, is_eliminated, is_paid, eliminated_on_date')
          .eq('is_paid', true)
          .order('is_eliminated', { ascending: true })
          .order('full_name', { ascending: true }),

        supabase.from('picks')
          .select('participant_id, game_date, result, is_auto_assigned, teams(name, seed)')
          .order('game_date', { ascending: true }),

        supabase.from('tournament_days')
          .select('game_date, round_name')
          .lte('game_date', today)
          .order('game_date', { ascending: true }),

        supabase.from('participants')
          .select('*', { count: 'exact', head: true })
          .eq('is_paid', true),

        supabase.from('recaps')
          .select('id, title, body, game_date, image_urls')
          .order('game_date', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle(),

        supabase.from('tournament_days')
          .select('game_date, round_name, deadline')
          .order('game_date', { ascending: true }),
      ])

      setMyPicks((myPicksData as any) || [])
      if (dayData && dayData.length > 0) {
        setTodayInfo(dayData[0])
        const { count } = await supabase.from('picks')
          .select('*', { count: 'exact', head: true })
          .eq('participant_id', participant!.id)
          .eq('game_date', dayData[0].game_date)
        setTodayPickCount(count || 0)
      }
      setAllParticipants(allParticipantsData || [])
      setAllPicks((allPicksData as any) || [])
      setDayMetas(daysData || [])
      setTotalPot((paidCount || 0) * 25)
      setLatestRecap(recapData)

      setStandingsParticipants(allParticipantsData || [])
      setStandingsPicks((allPicksData as any) || [])
      setStandingsDays(allDaysData || [])

      // Store all tournament day dates for games widget
      allDaysRef.current = (allDaysData || []).map((d: any) => d.game_date)
      // Build deadline lookup for pick count gating
      const deadlineMap: Record<string, string> = {}
      for (const d of (allDaysData || [])) {
        if (d.deadline) deadlineMap[d.game_date] = d.deadline
      }
      setDayDeadlines(deadlineMap)
      // Re-fetch scores now that we have the day list
      fetchScores()
    } catch (err) {
      console.error('fetchData error:', err)
    } finally {
      clearTimeout(giveUp)
      setLoading(false)
    }
  }

  async function fetchScores() {
    setScoresLoading(true)
    try {
      const displayDates = getDisplayDates()
      if (displayDates.length === 0) { setScoresLoading(false); return }

      // 1. ESPN — parallel fetch per date
      const espnResults = await Promise.all(
        displayDates.map(d =>
          fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${d.replace(/-/g, '')}`)
            .then(r => r.json())
            .then(data => data.events || [])
            .catch(() => [])
        )
      )
      setEspnGames(espnResults.flat())

      // 2. Our DB games for those dates (with team info)
      const { data: gamesData } = await supabase
        .from('games')
        .select('id, game_date, team1:team1_id(id, name, seed, region), team2:team2_id(id, name, seed, region)')
        .in('game_date', displayDates)
        .order('game_date')
      setDbGames((gamesData as any) || [])

      // 3. Pick counts for those dates
      const { data: picksData } = await supabase
        .from('picks')
        .select('team_id')
        .in('game_date', displayDates)

      const counts: Record<number, number> = {}
      for (const p of (picksData || [])) {
        counts[p.team_id] = (counts[p.team_id] || 0) + 1
      }
      setPickCounts(counts)
    } catch {
      // silent — scores are optional
    } finally {
      setScoresLoading(false)
    }
  }

  // Merge ESPN live data with DB games (for pick counts)
  function buildMergedGames() {
    function nameMatch(espnName: string, dbName: string): boolean {
      const a = (espnName || '').toLowerCase().trim()
      const b = (dbName || '').toLowerCase().trim()
      if (a === b) return true
      const aFirst = a.split(' ')[0]
      const bFirst = b.split(' ')[0]
      return aFirst === bFirst || a.includes(bFirst) || b.includes(aFirst)
    }

    type MergedGame = {
      key: string
      game_date: string
      team1: { id: number; name: string; seed: number; region: string }
      team2: { id: number; name: string; seed: number; region: string }
      startTime: Date
      network: string
      status: 'pre' | 'live' | 'final'
      halfLabel: string
      clock: string
      score1: string
      score2: string
      winner1: boolean
      winner2: boolean
    }

    const merged: MergedGame[] = espnGames.map(eg => {
      const comp = eg.competitions[0]
      const st = comp.status
      const comps = comp.competitors
      // ESPN competitor order: index 0 = away, index 1 = home (convention)
      const espn1 = comps[0]
      const espn2 = comps[1]

      // Derive ET game date from ESPN timestamp
      const gameDate = new Date(eg.date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

      // Try to match a DB game (needed only for pick counts and confirmed seeds)
      const dbGame = dbGames.find(dg =>
        comps.some(c => nameMatch(c.team.shortDisplayName || c.team.displayName, dg.team1.name)) &&
        comps.some(c => nameMatch(c.team.shortDisplayName || c.team.displayName, dg.team2.name))
      )

      // Build team objects — DB preferred (has pick-count IDs), ESPN fallback
      let team1: MergedGame['team1']
      let team2: MergedGame['team2']
      let c1 = espn1
      let c2 = espn2

      if (dbGame) {
        team1 = dbGame.team1
        team2 = dbGame.team2
        // Re-align ESPN competitors to match DB team order
        const match1 = comps.find(c => nameMatch(c.team.shortDisplayName || c.team.displayName, dbGame.team1.name))
        const match2 = comps.find(c => nameMatch(c.team.shortDisplayName || c.team.displayName, dbGame.team2.name))
        if (match1) c1 = match1
        if (match2) c2 = match2
      } else {
        team1 = {
          id: -(eg.id as any * 2),
          name: espn1.team.shortDisplayName || espn1.team.displayName,
          seed: parseInt(espn1.seed || '0') || espn1.curatedRank?.current || 0,
          region: '',
        }
        team2 = {
          id: -(eg.id as any * 2 + 1),
          name: espn2.team.shortDisplayName || espn2.team.displayName,
          seed: parseInt(espn2.seed || '0') || espn2.curatedRank?.current || 0,
          region: '',
        }
      }

      let status: 'pre' | 'live' | 'final' = 'pre'
      const PRE_STATUSES = ['STATUS_SCHEDULED', 'STATUS_PREGAME', 'STATUS_CANCELED', 'STATUS_POSTPONED', 'STATUS_SUSPENDED']
      if (st.type.completed) status = 'final'
      else if (!PRE_STATUSES.includes(st.type.name)) status = 'live'

      const p = st.period
      const halfLabel = st.type.name === 'STATUS_HALFTIME' ? 'Halftime'
        : p === 1 ? '1st Half' : p === 2 ? '2nd Half' : p > 2 ? `OT${p - 2}` : ''

      return {
        key: eg.id,
        game_date: gameDate,
        team1,
        team2,
        startTime: new Date(eg.date),
        network: comp.broadcasts?.[0]?.media?.shortName || '',
        status,
        halfLabel,
        clock: st.displayClock,
        score1: c1.score,
        score2: c2.score,
        winner1: c1.winner || false,
        winner2: c2.winner || false,
      }
    })

    // Sort: non-finals by tip time, finals sink to bottom
    const active = merged.filter(g => g.status !== 'final').sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    const finals = merged.filter(g => g.status === 'final').sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    return [...active, ...finals]
  }

  const aliveCount = allParticipants.filter(p => !p.is_eliminated).length
  const eliminatedCount = allParticipants.filter(p => p.is_eliminated).length
  const totalPicks = myPicks.length
  const wonPicks = myPicks.filter(p => p.result === 'won').length
  const picksNeeded = todayInfo ? todayInfo.picks_required - todayPickCount : 0
  const deadlinePassed = todayInfo ? new Date() > new Date(todayInfo.deadline) : false

  function fmtDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }
  function fmtDeadline(d: string) {
    return new Date(d).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  }
  function fmtTipTime(d: Date) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' })
  }
  function fmtDayHeader(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

  const mergedGames = buildMergedGames()
  const displayDates = getDisplayDates()
  const showDateHeaders = displayDates.length > 1

  return (
    <div className="dashboard">
      {!participant?.is_paid && (
        <div className="warning-card">
          <span className="warning-icon">⚠️</span>
          <div>
            <strong>Payment not confirmed yet</strong>
            <p>Send $25 via Venmo to <strong>@adam-furtado</strong> to activate your entry.</p>
          </div>
        </div>
      )}

      <div className="hq-columns">
        {/* ── LEFT 2/3 ── */}
        <div className="hq-left">

          {/* LEGO 1 — Standings Overview */}
          <div className="lego-card">
            <div className="lego-label">🏆 Pool Standings</div>
            <div className="hq-stats-row">
              <div className="hq-stat">
                <div className="hq-stat-num alive-num">{aliveCount}</div>
                <div className="hq-stat-label">Still Alive</div>
              </div>
              <div className="hq-stat-divider" />
              <div className="hq-stat">
                <div className="hq-stat-num">{eliminatedCount}</div>
                <div className="hq-stat-label">Eliminated</div>
              </div>
              <div className="hq-stat-divider" />
              <div className="hq-stat">
                <div className="hq-stat-num">${totalPot.toLocaleString()}</div>
                <div className="hq-stat-label">Total Pot</div>
              </div>
              <div className="hq-stat-divider" />
              <div className="hq-stat">
                <div className="hq-stat-num">{allParticipants.length}</div>
                <div className="hq-stat-label">Entrants</div>
              </div>
            </div>
            <Link to="/standings" className="hq-standings-link">Full standings →</Link>
          </div>

          {/* LEGO 2 — Your Status */}
          <div className="lego-card">
            <div className="lego-label">{participant?.is_eliminated ? '💀' : '🟢'} Your Status</div>
            <div className="your-status-row">
              <div className="your-status-main">
                <span className={`your-status-badge ${participant?.is_eliminated ? 'badge-out' : 'badge-alive'}`}>
                  {participant?.is_eliminated ? 'Eliminated' : 'Still Alive'}
                </span>
              </div>
              <div className="your-status-stats">
                <div className="ys-stat"><span className="ys-num">{totalPicks}</span><span className="ys-label">Picks Used</span></div>
                <div className="ys-stat"><span className="ys-num">{wonPicks}</span><span className="ys-label">Wins</span></div>
              </div>
            </div>

            {todayInfo && !participant?.is_eliminated && (
              <div className="today-inner">
                <div className="today-header">
                  <div>
                    <div className="today-round">{todayInfo.round_name}</div>
                    <div className="today-date">{fmtDate(todayInfo.game_date)}</div>
                  </div>
                  <div className="today-deadline">
                    <div className="deadline-label">Deadline</div>
                    <div className="deadline-time">{fmtDeadline(todayInfo.deadline)}</div>
                  </div>
                </div>
                {deadlinePassed ? (
                  todayPickCount >= todayInfo.picks_required ? (
                    <div className="picks-done">✅ Picks submitted for today.</div>
                  ) : (
                    <div className="picks-locked">🔒 Picks locked — {todayPickCount} of {todayInfo.picks_required} submitted.</div>
                  )
                ) : picksNeeded > 0 ? (
                  <div className="picks-needed">
                    <div className="picks-needed-text">You need <strong>{picksNeeded} more pick{picksNeeded > 1 ? 's' : ''}</strong> for today</div>
                    <Link to="/picks" className="btn-picks">Submit Picks →</Link>
                  </div>
                ) : (
                  <div className="picks-done">
                    ✅ Picks submitted! <Link to="/picks" className="picks-change-link">Change picks →</Link>
                  </div>
                )}
              </div>
            )}

            {/* My Pick History */}
            {myPicks.length > 0 && (
              <div className="my-picks-section">
                <div className="my-picks-title">Your Pick History</div>
                <div className="picks-table">
                  <div className="picks-header-row">
                    <span>Date</span><span>Team</span><span>Seed</span><span>Result</span>
                  </div>
                  {myPicks.map(pick => (
                    <div key={pick.id} className={`pick-row result-${pick.result}`}>
                      <span className="pick-date">{fmtDate(pick.game_date)}</span>
                      <span className="pick-team">
                        {pick.teams?.name}
                        {pick.is_auto_assigned && <span className="auto-badge">auto</span>}
                      </span>
                      <span className="pick-seed">#{pick.teams?.seed}</span>
                      <span className={`pick-result ${pick.result}`}>
                        {pick.result === 'won' ? '✅ Won' : pick.result === 'lost' ? '❌ Lost' : '⏳'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* LEGO 3 — Full Standings Table */}
          <div className="lego-card">
            <div className="lego-label">📊 Full Standings</div>
            <StandingsGrid
              participants={standingsParticipants}
              picks={standingsPicks}
              days={standingsDays}
              meId={participant?.id}
              onRefresh={fetchData}
            />
          </div>
        </div>

        {/* ── RIGHT 1/3 ── */}
        <div className="hq-right">

          {/* Recap */}
          {latestRecap && (
            <div className="lego-card">
              <div className="lego-label">📝 Latest Recap</div>
              <div className="recap-date-label">
                {new Date(latestRecap.game_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <h3 className="recap-card-title">{latestRecap.title}</h3>
              <div className="recap-card-body">
                {(latestRecap.body || '').replace(/\[img:[^\]]+\]/g, '').replace(/https?:\/\/\S+/g, '').slice(0, 280)}
                {(latestRecap.body || '').length > 280 ? '…' : ''}
              </div>
              <Link to="/recaps" className="recap-read-more">Read full recap →</Link>
            </div>
          )}

          {/* LEGO — Upcoming Games */}
          <div className="lego-card">
            <div className="lego-label">🏀 Scoreboard</div>

            {scoresLoading && mergedGames.length === 0 ? (
              <div className="scores-loading">Loading games…</div>
            ) : mergedGames.length === 0 ? (
              <div className="scores-empty">
                No games right now.<br />
                <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>Check back on game days.</span>
              </div>
            ) : (
              <div className="games-list">
                {displayDates.map(date => {
                  const dayGames = mergedGames.filter(g => g.game_date === date)
                  if (dayGames.length === 0) return null
                  return (
                    <React.Fragment key={date}>
                      {showDateHeaders && (
                        <div className="games-date-divider">{fmtDayHeader(date)}</div>
                      )}
                      {dayGames.map(game => {
                        const isLive = game.status === 'live'
                        const isFinal = game.status === 'final'
                        const deadline = dayDeadlines[game.game_date]
                        const showPickCounts = deadline ? new Date() > new Date(deadline) : false
                        const teams = [
                          { team: game.team1, score: game.score1, winner: game.winner1 },
                          { team: game.team2, score: game.score2, winner: game.winner2 },
                        ]
                        return (
                          <div key={game.key} className={`game-card${isLive ? ' game-live' : isFinal ? ' game-final' : ''}`}>
                            <div className="game-header">
                              <div className="game-status-wrap">
                                {isLive && <span className="live-dot" />}
                                <span className={`game-status-text${isLive ? ' status-live' : ''}`}>
                                  {isFinal
                                    ? 'Final'
                                    : isLive
                                    ? (game.clock && game.clock !== '0:00' ? `${game.halfLabel} · ${game.clock}` : game.halfLabel)
                                    : fmtTipTime(game.startTime)}
                                </span>
                              </div>
                              {game.network && <span className="game-network">{game.network}</span>}
                            </div>

                            {teams.map(({ team, score, winner }) => (
                              <div
                                key={team.id}
                                className={`game-team-row${isFinal ? (winner ? ' team-winner' : ' team-loser') : ''}`}
                              >
                                <span className="game-seed-badge">{team.seed}</span>
                                <span className="game-team-name">{team.name}</span>
                                <span className="game-score">
                                  {(isLive || isFinal) ? score : ''}
                                </span>
                                {showPickCounts && (
                                  <span className="game-pick-count">
                                    <span>{pickCounts[team.id] ?? 0}</span>
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </React.Fragment>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>

      <div className="rules-link-bar">
        📋 <Link to="/rules">View full pool rules</Link>
      </div>
    </div>
  )
}
