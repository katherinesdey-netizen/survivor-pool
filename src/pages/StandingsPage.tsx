import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import './StandingsPage.css'

interface Participant {
  id: string
  full_name: string
  is_eliminated: boolean
  is_paid: boolean
  eliminated_on_date: string | null
}

interface Pick {
  participant_id: string
  game_date: string
  result: string
  is_auto_assigned: boolean
  teams: { name: string; seed: number }
}

interface TournamentDay {
  game_date: string
  round_name: string
}

export default function StandingsPage() {
  const { participant: me } = useAuth()
  const [participants, setParticipants] = useState<Participant[]>([])
  const [picks, setPicks] = useState<Pick[]>([])
  const [days, setDays] = useState<TournamentDay[]>([])
  const [totalPot, setTotalPot] = useState(0)
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)

    // Get all paid participants
    const { data: participantsData } = await supabase
      .from('participants')
      .select('id, full_name, is_eliminated, is_paid, eliminated_on_date')
      .eq('is_paid', true)
      .order('is_eliminated', { ascending: true })

    setParticipants(participantsData || [])
    setTotalPot((participantsData || []).length * 25)

    // Get all picks with team info
    const { data: picksData } = await supabase
      .from('picks')
      .select('participant_id, game_date, result, is_auto_assigned, teams(name, seed)')
      .order('game_date', { ascending: true })

    setPicks((picksData as any) || [])

    // Get tournament days that have passed (for column headers)
    const today = new Date().toISOString().split('T')[0]
    const { data: daysData } = await supabase
      .from('tournament_days')
      .select('game_date, round_name')
      .lte('game_date', today)
      .order('game_date', { ascending: true })

    setDays(daysData || [])
    setLoading(false)
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric'
    })
  }

  function getPicksForParticipantOnDay(participantId: string, gameDate: string) {
    return picks.filter(p => p.participant_id === participantId && p.game_date === gameDate)
  }

  const alive = participants.filter(p => !p.is_eliminated)
  const eliminated = participants.filter(p => p.is_eliminated)

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

  return (
    <div className="standings-page">
      {/* Header stats */}
      <div className="standings-stats">
        <div className="standings-stat">
          <div className="sstat-num">{alive.length}</div>
          <div className="sstat-label">Still Alive</div>
        </div>
        <div className="standings-divider" />
        <div className="standings-stat">
          <div className="sstat-num">{eliminated.length}</div>
          <div className="sstat-label">Eliminated</div>
        </div>
        <div className="standings-divider" />
        <div className="standings-stat">
          <div className="sstat-num">${totalPot}</div>
          <div className="sstat-label">Total Pot</div>
        </div>
        <div className="standings-divider" />
        <div className="standings-stat">
          <div className="sstat-num">{participants.length}</div>
          <div className="sstat-label">Paid Entries</div>
        </div>
      </div>

      {/* Alive participants */}
      {alive.length > 0 && (
        <div className="standings-section">
          <h2 className="standings-section-title">🟢 Still Alive ({alive.length})</h2>
          <div className="standings-list">
            {alive.map(p => (
              <div key={p.id} className={`standings-row ${p.id === me?.id ? 'is-me' : ''}`}>
                <div className="standings-row-main" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                  <div className="standings-name">
                    {p.full_name}
                    {p.id === me?.id && <span className="me-badge">you</span>}
                  </div>
                  <div className="standings-picks-summary">
                    {days.map(day => {
                      const dayPicks = getPicksForParticipantOnDay(p.id, day.game_date)
                      return dayPicks.map((pick, i) => (
                        <span
                          key={`${day.game_date}-${i}`}
                          className={`pick-pill ${pick.result}`}
                          title={`${pick.teams?.name} — ${pick.result}`}
                        >
                          {pick.result === 'won' ? '✅' : pick.result === 'lost' ? '❌' : '⏳'}
                        </span>
                      ))
                    })}
                  </div>
                  <div className="standings-expand">{expandedId === p.id ? '▲' : '▼'}</div>
                </div>

                {expandedId === p.id && (
                  <div className="standings-detail">
                    {days.length === 0 ? (
                      <p className="detail-empty">No picks recorded yet.</p>
                    ) : (
                      <table className="detail-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Team</th>
                            <th>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {days.map(day =>
                            getPicksForParticipantOnDay(p.id, day.game_date).map((pick, i) => (
                              <tr key={`${day.game_date}-${i}`}>
                                <td>{formatDate(day.game_date)}</td>
                                <td>
                                  {pick.teams?.name}
                                  {pick.is_auto_assigned && <span className="auto-badge">auto</span>}
                                </td>
                                <td className={`detail-result ${pick.result}`}>
                                  {pick.result === 'won' ? '✅ Won' : pick.result === 'lost' ? '❌ Lost' : '⏳ Pending'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Eliminated participants */}
      {eliminated.length > 0 && (
        <div className="standings-section">
          <h2 className="standings-section-title">💀 Eliminated ({eliminated.length})</h2>
          <div className="standings-list eliminated-list">
            {eliminated.map(p => (
              <div key={p.id} className={`standings-row eliminated ${p.id === me?.id ? 'is-me' : ''}`}>
                <div className="standings-row-main" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                  <div className="standings-name">
                    {p.full_name}
                    {p.id === me?.id && <span className="me-badge">you</span>}
                    {p.eliminated_on_date && (
                      <span className="elim-date">out {formatDate(p.eliminated_on_date)}</span>
                    )}
                  </div>
                  <div className="standings-picks-summary">
                    {days.map(day => {
                      const dayPicks = getPicksForParticipantOnDay(p.id, day.game_date)
                      return dayPicks.map((pick, i) => (
                        <span
                          key={`${day.game_date}-${i}`}
                          className={`pick-pill ${pick.result}`}
                          title={`${pick.teams?.name} — ${pick.result}`}
                        >
                          {pick.result === 'won' ? '✅' : pick.result === 'lost' ? '❌' : '⏳'}
                        </span>
                      ))
                    })}
                  </div>
                  <div className="standings-expand">{expandedId === p.id ? '▲' : '▼'}</div>
                </div>

                {expandedId === p.id && (
                  <div className="standings-detail">
                    <table className="detail-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Team</th>
                          <th>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {days.map(day =>
                          getPicksForParticipantOnDay(p.id, day.game_date).map((pick, i) => (
                            <tr key={`${day.game_date}-${i}`}>
                              <td>{formatDate(day.game_date)}</td>
                              <td>
                                {pick.teams?.name}
                                {pick.is_auto_assigned && <span className="auto-badge">auto</span>}
                              </td>
                              <td className={`detail-result ${pick.result}`}>
                                {pick.result === 'won' ? '✅ Won' : pick.result === 'lost' ? '❌ Lost' : '⏳ Pending'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {participants.length === 0 && (
        <div className="standings-empty">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏀</div>
          <h2>No paid entries yet</h2>
          <p>Standings will appear here once participants have paid their entry fee.</p>
        </div>
      )}

      <button className="refresh-btn" onClick={fetchData}>↻ Refresh</button>
    </div>
  )
}
