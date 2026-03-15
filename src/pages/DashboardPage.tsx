import React, { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
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

interface EspnTeam {
  team: { displayName: string; abbreviation: string }
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
  const { participant } = useAuth()

  // My data
  const [myPicks, setMyPicks] = useState<MyPick[]>([])
  const [todayInfo, setTodayInfo] = useState<TournamentDay | null>(null)
  const [todayPickCount, setTodayPickCount] = useState(0)
  const [latestRecap, setLatestRecap] = useState<Recap | null>(null)
  const [loading, setLoading] = useState(true)

  // Pool-wide data
  const [allParticipants, setAllParticipants] = useState<AllParticipant[]>([])
  const [allPicks, setAllPicks] = useState<AllPick[]>([])
  const [dayMetas, setDayMetas] = useState<DayMeta[]>([])
  const [totalPot, setTotalPot] = useState(0)

  // ESPN
  const [espnGames, setEspnGames] = useState<EspnGame[]>([])
  const [scoresLoading, setScoresLoading] = useState(true)

  useEffect(() => {
    if (!participant) return
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant])

  // ESPN — 30s when live games, 60s otherwise
  useEffect(() => {
    fetchScores()
    const iv = setInterval(fetchScores, 30000)
    return () => clearInterval(iv)
  }, [])

  async function fetchData() {
    setLoading(true)
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
          .select('id, full_name, is_eliminated, is_paid')
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
    } catch (err) {
      console.error('fetchData error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function fetchScores() {
    setScoresLoading(true)
    try {
      const res = await fetch(
        'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100'
      )
      const data = await res.json()
      setEspnGames(data.events || [])
    } catch {
      // silently fail — scores are optional
    } finally {
      setScoresLoading(false)
    }
  }

  // Build grid lookup: participantId → gameDate → pick
  const picksGrid: Record<string, Record<string, AllPick>> = {}
  allPicks.forEach(p => {
    if (!picksGrid[p.participant_id]) picksGrid[p.participant_id] = {}
    picksGrid[p.participant_id][p.game_date] = p
  })

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
  function fmtRound(r: string) {
    // Shorten round names for column headers
    return r.replace('Round of 64', 'R64').replace('Round of 32', 'R32')
      .replace('Sweet 16', 'S16').replace('Elite Eight', 'E8')
      .replace('Final Four', 'F4').replace('Championship', 'Champ')
      .replace('National ', '')
  }
  function fmtGameTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

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

          {/* LEGO 3 — All Picks Grid */}
          {dayMetas.length > 0 && (
            <div className="lego-card">
              <div className="lego-label">📊 All Picks</div>
              <div className="picks-grid-wrap">
                <table className="picks-grid">
                  <thead>
                    <tr>
                      <th className="grid-name-col">Participant</th>
                      {dayMetas.map(d => (
                        <th key={d.game_date} className="grid-day-col">
                          <div className="grid-day-label">{fmtRound(d.round_name)}</div>
                          <div className="grid-day-date">{new Date(d.game_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allParticipants.map(p => (
                      <tr key={p.id} className={`grid-row ${p.is_eliminated ? 'grid-row-out' : ''} ${p.id === participant?.id ? 'grid-row-me' : ''}`}>
                        <td className="grid-name">
                          {p.full_name}
                          {p.id === participant?.id && <span className="me-tag">you</span>}
                          {p.is_eliminated && <span className="grid-skull">💀</span>}
                        </td>
                        {dayMetas.map(d => {
                          const pick = picksGrid[p.id]?.[d.game_date]
                          if (!pick) return <td key={d.game_date} className="grid-cell grid-cell-empty">—</td>
                          return (
                            <td key={d.game_date} className={`grid-cell grid-cell-${pick.result}`}>
                              <div className="grid-team">{pick.teams?.name}</div>
                              <div className="grid-seed">#{pick.teams?.seed}</div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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

          {/* Box Scores */}
          <div className="lego-card">
            <div className="lego-label">🏀 Today's Games</div>
            {scoresLoading ? (
              <div className="scores-loading">Loading scores…</div>
            ) : espnGames.length === 0 ? (
              <div className="scores-empty">No NCAA Tournament games today.<br/><span style={{fontSize:'12px', color:'rgba(255,255,255,0.3)'}}>Check back on game days.</span></div>
            ) : (
              <div className="scores-list">
                {espnGames.map(game => {
                  const comp = game.competitions[0]
                  const status = comp.status
                  const home = comp.competitors.find(c => c.homeAway === 'home')
                  const away = comp.competitors.find(c => c.homeAway === 'away')
                  const isLive = status.type.name === 'STATUS_IN_PROGRESS'
                  const isFinal = status.type.completed
                  const isScheduled = !isLive && !isFinal

                  const network = comp.broadcasts?.[0]?.media?.shortName || null
                  const period = status.period
                  const clock = status.displayClock
                  const periodLabel = period === 1 ? '1st Half' : period === 2 ? '2nd Half' : period > 2 ? `OT${period - 2}` : ''

                  return (
                    <div key={game.id} className={`score-card ${isLive ? 'score-live' : ''}`}>
                      <div className="score-header">
                        <div className="score-status">
                          {isLive && <span className="live-dot" />}
                          <span className={`score-status-text ${isLive ? 'live-text' : ''}`}>
                            {isLive
                              ? `${periodLabel} · ${clock}`
                              : isFinal ? 'Final'
                              : fmtGameTime(game.date)}
                          </span>
                        </div>
                        {network && <span className="score-network">{network}</span>}
                      </div>
                      <div className="score-matchup">
                        <div className={`score-team ${away?.winner ? 'score-winner' : isFinal && !away?.winner ? 'score-loser' : ''}`}>
                          <span className="score-team-name">{away?.team.displayName}</span>
                          {(isLive || isFinal) && <span className="score-pts">{away?.score}</span>}
                        </div>
                        <div className={`score-team ${home?.winner ? 'score-winner' : isFinal && !home?.winner ? 'score-loser' : ''}`}>
                          <span className="score-team-name">{home?.team.displayName}</span>
                          {(isLive || isFinal) && <span className="score-pts">{home?.score}</span>}
                        </div>
                      </div>
                    </div>
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
