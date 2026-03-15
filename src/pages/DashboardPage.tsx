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

interface Recap {
  id: number
  title: string
  body: string
  image_urls: string[]
  game_date: string
}

export default function DashboardPage() {
  const { participant } = useAuth()
  const [picks, setPicks] = useState<Pick[]>([])
  const [todayInfo, setTodayInfo] = useState<TournamentDay | null>(null)
  const [todayPickCount, setTodayPickCount] = useState(0)
  const [totalPot, setTotalPot] = useState(0)
  const [latestRecap, setLatestRecap] = useState<Recap | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!participant) return
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant])

  async function fetchData() {
    setLoading(true)
    try {
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
        .select('game_date, round_name, picks_required, deadline, is_complete')
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

      // Fetch latest recap (limit 1 keeps response size bounded)
      const { data: recapData } = await supabase
        .from('recaps')
        .select('id, title, body, game_date, image_urls')
        .order('game_date', { ascending: false })
        .limit(1)
        .maybeSingle()

      setLatestRecap(recapData)
    } catch (err) {
      console.error('fetchData error:', err)
    } finally {
      setLoading(false)
    }
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

      {/* Two column layout: pick history left, recap right */}
      <div className="dashboard-bottom">
        <div className="dashboard-left">
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

        {latestRecap && (
          <div className="dashboard-right">
            <div className="dashboard-recap-card">
              <div className="recap-day-label">📝 Latest Recap</div>
              <div className="recap-date-label">
                {new Date(latestRecap.game_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
              <h3 className="recap-card-title">{latestRecap.title}</h3>
              <div className="recap-card-body">
                {latestRecap.body.replace(/\[img:[^\]]+\]/g, '').slice(0, 300)}
                {latestRecap.body.replace(/\[img:[^\]]+\]/g, '').length > 300 ? '...' : ''}
              </div>
              {latestRecap.image_urls?.[0] && (
                <img
                  src={latestRecap.image_urls[0]}
                  alt="Recap"
                  className="recap-card-image"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <Link to="/recaps" className="recap-read-more">Read full recap →</Link>
            </div>
          </div>
        )}
      </div>

      {/* Rules link */}
      <div className="rules-link-bar">
        📋 <Link to="/rules">View full pool rules</Link>
      </div>
    </div>
  )
}
