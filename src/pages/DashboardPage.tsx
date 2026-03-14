import React, { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import './DashboardPage.css'

interface Pick {
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

export default function DashboardPage() {
  const { participant } = useAuth()
  const [picks, setPicks] = useState<Pick[]>([])
  const [todayInfo, setTodayInfo] = useState<TournamentDay | null>(null)
  const [todayPickCount, setTodayPickCount] = useState(0)
  const [totalPot, setTotalPot] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!participant) return
    fetchData()
  }, [participant])

  async function fetchData() {
    setLoading(true)

    // Fetch participant's picks with team names
    const { data: picksData } = await supabase
      .from('picks')
      .select('id, game_date, result, is_auto_assigned, teams(name, seed)')
      .eq('participant_id', participant!.id)
      .order('game_date', { ascending: true })

    setPicks((picksData as any) || [])

    // Find today's or next upcoming tournament day
    const today = new Date().toISOString().split('T')[0]
    const { data: dayData } = await supabase
      .from('tournament_days')
      .select('*')
      .gte('game_date', today)
      .order('game_date', { ascending: true })
      .limit(1)

    if (dayData && dayData.length > 0) {
      setTodayInfo(dayData[0])

      // Count picks already submitted for that day
      const { count } = await supabase
        .from('picks')
        .select('*', { count: 'exact', head: true })
        .eq('participant_id', participant!.id)
        .eq('game_date', dayData[0].game_date)

      setTodayPickCount(count || 0)
    }

    // Count paid participants for pot total
    const { count: paidCount } = await supabase
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('is_paid', true)

    setTotalPot((paidCount || 0) * 25)
    setLoading(false)
  }

  function isDeadlinePassed(deadline: string) {
    return new Date() > new Date(deadline)
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    })
  }

  function formatDeadline(deadline: string) {
    return new Date(deadline).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    })
  }

  const picksNeeded = todayInfo ? todayInfo.picks_required - todayPickCount : 0
  const deadlinePassed = todayInfo ? isDeadlinePassed(todayInfo.deadline) : false
  const totalPicks = picks.length
  const wonPicks = picks.filter(p => p.result === 'won').length

  if (loading) {
    return <div className="loading-screen"><div className="spinner" /></div>
  }

  return (
    <div className="dashboard">
      {/* Status Banner */}
      <div className={`status-banner ${participant?.is_eliminated ? 'eliminated' : 'alive'}`}>
        <div className="status-left">
          <div className="status-icon">{participant?.is_eliminated ? '💀' : '🟢'}</div>
          <div>
            <div className="status-label">Your Status</div>
            <div className="status-value">
              {participant?.is_eliminated
                ? `Eliminated${participant.eliminated_on_date ? ` on ${formatDate(participant.eliminated_on_date)}` : ''}`
                : 'Still Alive'}
            </div>
          </div>
        </div>
        <div className="status-right">
          <div className="status-stat">
            <div className="stat-num">${totalPot}</div>
            <div className="stat-label">Total Pot</div>
          </div>
          <div className="status-divider" />
          <div className="status-stat">
            <div className="stat-num">{totalPicks}<span className="stat-max">/12</span></div>
            <div className="stat-label">Picks Used</div>
          </div>
          <div className="status-divider" />
          <div className="status-stat">
            <div className="stat-num">{wonPicks}</div>
            <div className="stat-label">Wins</div>
          </div>
        </div>
      </div>

      {/* Payment Warning */}
      {!participant?.is_paid && (
        <div className="warning-card">
          <span className="warning-icon">⚠️</span>
          <div>
            <strong>Payment not confirmed yet</strong>
            <p>Send $25 via Venmo to <strong>@adam-furtado</strong> to activate your entry. Your picks won't count until payment is confirmed.</p>
          </div>
        </div>
      )}

      {/* Today's Action */}
      {todayInfo && !participant?.is_eliminated && (
        <div className="today-card">
          <div className="today-header">
            <div>
              <div className="today-round">{todayInfo.round_name}</div>
              <div className="today-date">{formatDate(todayInfo.game_date)}</div>
            </div>
            <div className="today-deadline">
              <div className="deadline-label">Deadline</div>
              <div className="deadline-time">{formatDeadline(todayInfo.deadline)}</div>
            </div>
          </div>

          {deadlinePassed ? (
            todayPickCount >= todayInfo.picks_required ? (
              <div className="picks-done">
                ✅ Picks submitted for today.
              </div>
            ) : todayPickCount > 0 ? (
              <div className="picks-locked">
                🔒 Picks locked — {todayPickCount} of {todayInfo.picks_required} picks submitted.
              </div>
            ) : (
              <div className="picks-locked">
                🔒 Picks locked — no picks submitted. Adam will assign your pick automatically.
              </div>
            )
          ) : picksNeeded > 0 ? (
            <div className="picks-needed">
              <div className="picks-needed-text">
                You need to submit <strong>{picksNeeded} more pick{picksNeeded > 1 ? 's' : ''}</strong> for today
              </div>
              <Link to="/picks" className="btn-picks">
                Submit Picks →
              </Link>
            </div>
          ) : (
            <div className="picks-done">
              ✅ Picks submitted! <Link to="/picks" className="picks-change-link">Change picks →</Link>
              <div className="picks-done-sub">You can update your picks any time before the deadline. Your most recent submission counts.</div>
            </div>
          )}
        </div>
      )}

      {/* Two column layout: pick history + rules */}
      <div className="dashboard-columns">
        <div className="dashboard-main">
          <h2 className="section-title">Your Pick History</h2>
          {picks.length === 0 ? (
            <div className="empty-state">
              <p>No picks yet. {todayInfo ? <Link to="/picks">Submit your first pick →</Link> : 'Check back when the tournament starts.'}</p>
            </div>
          ) : (
            <div className="picks-table">
              <div className="picks-header-row">
                <span>Date</span>
                <span>Team</span>
                <span>Seed</span>
                <span>Result</span>
              </div>
              {picks.map(pick => (
                <div key={pick.id} className={`pick-row result-${pick.result}`}>
                  <span className="pick-date">{formatDate(pick.game_date)}</span>
                  <span className="pick-team">
                    {pick.teams?.name}
                    {pick.is_auto_assigned && <span className="auto-badge">auto</span>}
                  </span>
                  <span className="pick-seed">#{pick.teams?.seed}</span>
                  <span className={`pick-result ${pick.result}`}>
                    {pick.result === 'won' ? '✅ Won' : pick.result === 'lost' ? '❌ Lost' : '⏳ Pending'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dashboard-sidebar">
          <div className="rules-card">
            <h3>📋 Pool Rules</h3>
            <ul>
              <li>Pick <strong>2 teams</strong> on Thursday & Friday (Round of 64), <strong>1 team</strong> all other days</li>
              <li>If your pick loses, you're <strong>eliminated</strong></li>
              <li>You <strong>cannot pick the same team twice</strong></li>
              <li>Picks must be submitted <strong>30 min before first tip</strong></li>
              <li>Miss a deadline? You get <strong>auto-assigned the worst available seed</strong></li>
              <li>Last person standing wins <strong>the pot</strong></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
