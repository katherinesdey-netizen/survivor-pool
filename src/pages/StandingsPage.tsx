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
  teams: { name: string; seed: number } | null
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    try {
      const [{ data: participantsData }, { data: picksData }, { data: daysData }] =
        await Promise.all([
          supabase
            .from('participants')
            .select('id, full_name, is_eliminated, is_paid, eliminated_on_date')
            .eq('is_paid', true)
            .order('full_name', { ascending: true }),
          supabase
            .from('picks')
            .select('participant_id, game_date, result, is_auto_assigned, teams(name, seed)')
            .order('game_date', { ascending: true }),
          supabase
            .from('tournament_days')
            .select('game_date, round_name')
            .order('game_date', { ascending: true }),
        ])

      setParticipants(participantsData || [])
      setPicks((picksData as any) || [])
      setDays(daysData || [])
    } catch (err) {
      console.error('fetchData error:', err)
    } finally {
      setLoading(false)
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  function getPick(participantId: string, gameDate: string): Pick | null {
    return picks.find(p => p.participant_id === participantId && p.game_date === gameDate) || null
  }

  const today = new Date().toISOString().split('T')[0]
  const pastDays = days.filter(d => d.game_date <= today)

  const alive = participants
    .filter(p => !p.is_eliminated)
    .sort((a, b) => a.full_name.localeCompare(b.full_name))

  // Eliminated: sorted so the most recently eliminated (lasted longest) comes first
  const eliminated = participants
    .filter(p => p.is_eliminated)
    .sort((a, b) => {
      if (!a.eliminated_on_date) return 1
      if (!b.eliminated_on_date) return -1
      return b.eliminated_on_date.localeCompare(a.eliminated_on_date)
    })

  const totalPot = participants.length * 25

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

  return (
    <div className="standings-page">
      {/* Stats bar */}
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
          <div className="sstat-label">Entries</div>
        </div>
      </div>

      {/* Spreadsheet grid */}
      {participants.length === 0 ? (
        <div className="standings-empty">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏀</div>
          <h2>No entries yet</h2>
          <p>Standings will appear here once participants have paid their entry fee.</p>
        </div>
      ) : (
        <div className="standings-table-wrap">
          <table className="standings-grid">
            <thead>
              <tr>
                <th className="col-name col-sticky">Participant</th>
                {pastDays.map(day => (
                  <th key={day.game_date} className="col-day">
                    <div className="day-round">{day.round_name}</div>
                    <div className="day-date">{formatDate(day.game_date)}</div>
                  </th>
                ))}
                <th className="col-status">Status</th>
              </tr>
            </thead>
            <tbody>
              {/* ── Alive section ── */}
              <tr className="section-header-row">
                <td colSpan={pastDays.length + 2}>
                  <span className="section-label alive-label">🟢 Still Alive — {alive.length}</span>
                </td>
              </tr>

              {alive.map(p => (
                <tr key={p.id} className={`grid-row ${p.id === me?.id ? 'row-me' : ''}`}>
                  <td className="col-name col-sticky name-cell">
                    <span className="name-text">{p.full_name}</span>
                    {p.id === me?.id && <span className="me-badge">you</span>}
                  </td>
                  {pastDays.map(day => {
                    const pick = getPick(p.id, day.game_date)
                    const cls = pick ? `cell-${pick.result}` : 'cell-empty'
                    return (
                      <td key={day.game_date} className={`pick-cell ${cls}`}>
                        {pick ? (
                          <>
                            <span className="cell-seed">
                              {pick.teams?.seed ? `#${pick.teams.seed}` : ''}
                            </span>
                            <span className="cell-team">{pick.teams?.name ?? '—'}</span>
                            {pick.is_auto_assigned && (
                              <span className="auto-dot" title="Auto-assigned" />
                            )}
                          </>
                        ) : (
                          <span className="cell-no-pick">—</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="col-status status-alive">✅ Alive</td>
                </tr>
              ))}

              {/* ── Eliminated section ── */}
              {eliminated.length > 0 && (
                <tr className="section-header-row">
                  <td colSpan={pastDays.length + 2}>
                    <span className="section-label elim-label">
                      💀 Eliminated — {eliminated.length}
                    </span>
                  </td>
                </tr>
              )}

              {eliminated.map(p => (
                <tr key={p.id} className={`grid-row row-eliminated ${p.id === me?.id ? 'row-me' : ''}`}>
                  <td className="col-name col-sticky name-cell">
                    <span className="name-text">{p.full_name}</span>
                    {p.id === me?.id && <span className="me-badge">you</span>}
                    {p.eliminated_on_date && (
                      <span className="elim-date">out {formatDate(p.eliminated_on_date)}</span>
                    )}
                  </td>
                  {pastDays.map(day => {
                    // Shade cells after elimination date
                    if (p.eliminated_on_date && day.game_date > p.eliminated_on_date) {
                      return <td key={day.game_date} className="pick-cell cell-after-elim" />
                    }
                    const pick = getPick(p.id, day.game_date)
                    const cls = pick ? `cell-${pick.result}` : 'cell-empty'
                    return (
                      <td key={day.game_date} className={`pick-cell ${cls}`}>
                        {pick ? (
                          <>
                            <span className="cell-seed">
                              {pick.teams?.seed ? `#${pick.teams.seed}` : ''}
                            </span>
                            <span className="cell-team">{pick.teams?.name ?? '—'}</span>
                            {pick.is_auto_assigned && (
                              <span className="auto-dot" title="Auto-assigned" />
                            )}
                          </>
                        ) : (
                          <span className="cell-no-pick">—</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="col-status status-elim">
                    {p.eliminated_on_date ? `Out ${formatDate(p.eliminated_on_date)}` : 'Out'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button className="refresh-btn" onClick={fetchData}>↻ Refresh</button>
    </div>
  )
}
