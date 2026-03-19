import React from 'react'
import './StandingsGrid.css'

export interface GridParticipant {
  id: string
  full_name: string
  is_eliminated: boolean
  is_paid: boolean
  eliminated_on_date: string | null
}

export interface GridPick {
  participant_id: string
  game_date: string
  result: string
  is_auto_assigned: boolean
  teams: { name: string; seed: number } | null
}

export interface GridDay {
  game_date: string
  round_name: string
  deadline: string | null
}

interface Props {
  participants: GridParticipant[]
  picks: GridPick[]
  days: GridDay[]
  meId?: string
  onRefresh?: () => void
}

export default function StandingsGrid({ participants, picks, days, meId, onRefresh }: Props) {

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  function isRevealed(day: GridDay): boolean {
    // Never reveal picks for future game dates (regardless of deadline setting)
    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    if (day.game_date > todayET) return false
    // Past/today: reveal after deadline (or immediately if no deadline)
    if (!day.deadline) return true
    return new Date() >= new Date(day.deadline)
  }

  function isActive(day: GridDay): boolean {
    const today = new Date().toISOString().split('T')[0]
    return day.game_date <= today
  }

  function getPicksForDay(participantId: string, gameDate: string): GridPick[] {
    return picks.filter(p => p.participant_id === participantId && p.game_date === gameDate)
  }

  const alive = participants
    .filter(p => !p.is_eliminated)
    .sort((a, b) => a.full_name.localeCompare(b.full_name))

  const eliminated = participants
    .filter(p => p.is_eliminated)
    .sort((a, b) => {
      if (!a.eliminated_on_date) return 1
      if (!b.eliminated_on_date) return -1
      return b.eliminated_on_date.localeCompare(a.eliminated_on_date)
    })

  const colCount = days.length + 2

  function renderPickCell(p: GridParticipant, day: GridDay) {
    const key = day.game_date
    const afterElim = p.eliminated_on_date && day.game_date > p.eliminated_on_date

    if (afterElim) {
      return <td key={key} className="sg-pick-cell sg-cell-after-elim" />
    }

    const dayPicks = getPicksForDay(p.id, day.game_date)
    const revealed = isRevealed(day)

    if (!revealed) {
      return (
        <td key={key} className="sg-pick-cell sg-cell-locked">
          <span className="sg-cell-lock">🔒</span>
        </td>
      )
    }

    if (!isActive(day) && dayPicks.length === 0) {
      return <td key={key} className="sg-pick-cell sg-cell-upcoming"><span className="sg-upcoming-label">—</span></td>
    }

    if (dayPicks.length === 0) {
      return <td key={key} className="sg-pick-cell sg-cell-empty"><span className="sg-no-pick">—</span></td>
    }

    const hasLost = dayPicks.some(pk => pk.result === 'lost')
    const allWon = dayPicks.every(pk => pk.result === 'won')
    const cellCls = hasLost ? 'sg-cell-lost' : allWon ? 'sg-cell-won' : 'sg-cell-pending'

    return (
      <td key={key} className={`sg-pick-cell ${cellCls}`}>
        {dayPicks.map((pick, i) => (
          <div key={i} className={`sg-pick-row${pick.result === 'lost' ? ' sg-pick-lost' : pick.result === 'won' ? ' sg-pick-won' : ''}`}>
            <span className="sg-seed">{pick.teams?.seed ? `#${pick.teams.seed}` : ''}</span>
            <span className="sg-team">{pick.teams?.name ?? '—'}</span>
            {pick.is_auto_assigned && <span className="sg-auto-dot" title="Auto-assigned" />}
          </div>
        ))}
      </td>
    )
  }

  if (participants.length === 0) {
    return (
      <div className="sg-empty">
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏀</div>
        <p>No entries yet. Standings appear once participants have paid.</p>
      </div>
    )
  }

  return (
    <div className="sg-wrap">
      <div className="sg-table-scroll">
        <table className="sg-table">
          <thead>
            <tr>
              <th className="sg-col-name sg-sticky">Name</th>
              {days.map(day => (
                <th key={day.game_date} className={`sg-col-day ${!isActive(day) ? 'sg-col-future' : ''}`}>
                  <div className="sg-day-round">{day.round_name}</div>
                  <div className="sg-day-date">{formatDate(day.game_date)}</div>
                </th>
              ))}
              <th className="sg-col-status">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr className="sg-section-row">
              <td colSpan={colCount}>
                <span className="sg-section-label sg-alive-label">🟢 Still Alive — {alive.length}</span>
              </td>
            </tr>

            {alive.map(p => (
              <tr key={p.id} className={`sg-row ${p.id === meId ? 'sg-row-me' : ''}`}>
                <td className="sg-col-name sg-sticky sg-name-cell">
                  <span className="sg-name-text">{p.full_name}</span>
                  {p.id === meId && <span className="sg-me-badge">you</span>}
                </td>
                {days.map(day => renderPickCell(p, day))}
                <td className="sg-col-status sg-status-alive">✅ Alive</td>
              </tr>
            ))}

            {eliminated.length > 0 && (
              <tr className="sg-section-row">
                <td colSpan={colCount}>
                  <span className="sg-section-label sg-elim-label">💀 Eliminated — {eliminated.length}</span>
                </td>
              </tr>
            )}

            {eliminated.map(p => (
              <tr key={p.id} className={`sg-row sg-row-elim ${p.id === meId ? 'sg-row-me' : ''}`}>
                <td className="sg-col-name sg-sticky sg-name-cell">
                  <span className="sg-name-text">{p.full_name}</span>
                  {p.id === meId && <span className="sg-me-badge">you</span>}
                  {p.eliminated_on_date && (
                    <span className="sg-elim-date">out {formatDate(p.eliminated_on_date)}</span>
                  )}
                </td>
                {days.map(day => renderPickCell(p, day))}
                <td className="sg-col-status sg-status-elim">
                  {p.eliminated_on_date ? `Out ${formatDate(p.eliminated_on_date)}` : 'Out'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {onRefresh && (
        <button className="sg-refresh-btn" onClick={onRefresh}>↻ Refresh</button>
      )}
    </div>
  )
}
