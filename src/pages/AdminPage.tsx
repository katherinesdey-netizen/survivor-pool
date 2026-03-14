import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import './AdminPage.css'

interface Participant {
  id: string
  full_name: string
  email: string
  venmo_handle: string | null
  is_paid: boolean
  is_admin: boolean
  is_eliminated: boolean
  eliminated_on_date: string | null
}

interface Team {
  id: number
  name: string
  seed: number
  region: string
  is_eliminated: boolean
}

interface TournamentDay {
  id: number
  game_date: string
  round_name: string
  picks_required: number
  deadline: string
}

interface Pick {
  id: number
  participant_id: string
  team_id: number
  game_date: string
  result: string
  is_auto_assigned: boolean
  teams: { name: string; seed: number }
  participants: { full_name: string }
}

type Tab = 'participants' | 'picks' | 'assign'

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('participants')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [days, setDays] = useState<TournamentDay[]>([])
  const [picks, setPicks] = useState<Pick[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Assign pick form state
  const [assignParticipantId, setAssignParticipantId] = useState('')
  const [assignTeamId, setAssignTeamId] = useState('')
  const [assignDate, setAssignDate] = useState('')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)

    const [{ data: pData }, { data: tData }, { data: dData }, { data: pickData }] = await Promise.all([
      supabase.from('participants').select('*').order('full_name'),
      supabase.from('teams').select('*').eq('is_eliminated', false).order('seed'),
      supabase.from('tournament_days').select('*').order('game_date'),      supabase.from('picks').select('id, participant_id, team_id, game_date, result, is_auto_assigned, teams(name, seed), participants(full_name)').order('game_date', { ascending: false })
    ])

    setParticipants(pData || [])
    setTeams(tData || [])
    setDays(dData || [])
    setPicks((pickData as any) || [])
    setLoading(false)
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  async function togglePaid(participant: Participant) {
    setSaving(participant.id + '_paid')
    const { error } = await supabase
      .from('participants')
      .update({ is_paid: !participant.is_paid })
      .eq('id', participant.id)

    if (error) showMsg('error', 'Failed to update payment status.')
    else showMsg('success', `${participant.full_name} marked as ${!participant.is_paid ? 'paid' : 'unpaid'}.`)
    await fetchData()
    setSaving(null)
  }

  async function toggleEliminated(participant: Participant) {
    setSaving(participant.id + '_elim')
    const newEliminated = !participant.is_eliminated
    const { error } = await supabase
      .from('participants')
      .update({
        is_eliminated: newEliminated,
        eliminated_on_date: newEliminated ? new Date().toISOString().split('T')[0] : null
      })
      .eq('id', participant.id)

    if (error) showMsg('error', 'Failed to update elimination status.')
    else showMsg('success', `${participant.full_name} ${newEliminated ? 'eliminated' : 'reinstated'}.`)
    await fetchData()
    setSaving(null)
  }

  async function deletePick(pickId: number) {
    if (!window.confirm('Delete this pick?')) return
    const { error } = await supabase.from('picks').delete().eq('id', pickId)
    if (error) showMsg('error', 'Failed to delete pick.')
    else showMsg('success', 'Pick deleted.')
    await fetchData()
  }

  async function updatePickResult(pickId: number, result: string) {
    const { error } = await supabase.from('picks').update({ result }).eq('id', pickId)
    if (error) showMsg('error', 'Failed to update result.')
    else showMsg('success', 'Pick result updated.')
    await fetchData()
  }

  async function handleAssignPick(e: React.FormEvent) {
    e.preventDefault()
    if (!assignParticipantId || !assignTeamId || !assignDate) return
    setSaving('assign')

    // Check for duplicate pick (same team already used by this participant ever)
    const alreadyUsed = picks.some(
      p => p.participant_id === assignParticipantId && p.team_id === parseInt(assignTeamId)
    )
    if (alreadyUsed) {
      showMsg('error', 'This participant has already picked that team.')
      setSaving(null)
      return
    }

    // Find how many picks are required for this day
    const day = days.find(d => d.game_date === assignDate)
    const picksRequired = day?.picks_required || 1

    // Count how many picks already exist for this participant on this day
    const existingDayPicks = picks.filter(
      p => p.participant_id === assignParticipantId && p.game_date === assignDate
    )

    if (existingDayPicks.length >= picksRequired) {
      showMsg('error', `This participant already has ${existingDayPicks.length} pick(s) for this day (${picksRequired} required). Delete one first from the All Picks tab before assigning a new one.`)
      setSaving(null)
      return
    }

    // Just insert — don't delete existing picks for the day
    const { error } = await supabase.from('picks').insert({
      participant_id: assignParticipantId,
      team_id: parseInt(assignTeamId),
      game_date: assignDate,
      result: 'pending',
      is_auto_assigned: true
    })

    if (error) showMsg('error', 'Failed to assign pick: ' + error.message)
    else {
      showMsg('success', 'Pick assigned successfully.')
      setAssignParticipantId('')
      setAssignTeamId('')
      setAssignDate('')
    }
    await fetchData()
    setSaving(null)
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric'
    })
  }

  const paidCount = participants.filter(p => p.is_paid).length
  const aliveCount = participants.filter(p => !p.is_eliminated && p.is_paid).length

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <h1 className="admin-title">Admin Panel</h1>
          <div className="admin-stats">
            <span>{participants.length} registered</span>
            <span>·</span>
            <span>{paidCount} paid</span>
            <span>·</span>
            <span>{aliveCount} alive</span>
            <span>·</span>
            <span>${paidCount * 25} pot</span>
          </div>
        </div>
        <button className="refresh-btn" onClick={fetchData}>↻ Refresh</button>
      </div>

      {msg && <div className={`admin-msg ${msg.type}`}>{msg.text}</div>}

      {/* Tabs */}
      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'participants' ? 'active' : ''}`} onClick={() => setTab('participants')}>
          Participants ({participants.length})
        </button>
        <button className={`admin-tab ${tab === 'picks' ? 'active' : ''}`} onClick={() => setTab('picks')}>
          All Picks ({picks.length})
        </button>
        <button className={`admin-tab ${tab === 'assign' ? 'active' : ''}`} onClick={() => setTab('assign')}>
          Assign Pick
        </button>
      </div>

      {/* PARTICIPANTS TAB */}
      {tab === 'participants' && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Venmo</th>
                <th>Paid</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {participants.map(p => (
                <tr key={p.id} className={p.is_eliminated ? 'row-eliminated' : ''}>
                  <td className="td-name">
                    {p.full_name}
                    {p.is_admin && <span className="admin-badge">admin</span>}
                  </td>
                  <td className="td-email">{p.email}</td>
                  <td className="td-venmo">{p.venmo_handle || '—'}</td>
                  <td>
                    <span className={`status-pill ${p.is_paid ? 'paid' : 'unpaid'}`}>
                      {p.is_paid ? '✅ Paid' : '⏳ Unpaid'}
                    </span>
                  </td>
                  <td>
                    <span className={`status-pill ${p.is_eliminated ? 'eliminated' : 'alive'}`}>
                      {p.is_eliminated ? '💀 Out' : '🟢 Alive'}
                    </span>
                  </td>
                  <td className="td-actions">
                    <button
                      className={`action-btn ${p.is_paid ? 'btn-warn' : 'btn-green'}`}
                      onClick={() => togglePaid(p)}
                      disabled={saving === p.id + '_paid'}
                    >
                      {p.is_paid ? 'Mark Unpaid' : 'Mark Paid'}
                    </button>
                    <button
                      className={`action-btn ${p.is_eliminated ? 'btn-green' : 'btn-warn'}`}
                      onClick={() => toggleEliminated(p)}
                      disabled={saving === p.id + '_elim'}
                    >
                      {p.is_eliminated ? 'Reinstate' : 'Eliminate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PICKS TAB — spreadsheet grid */}
      {tab === 'picks' && (
        <div className="admin-table-wrap">
          <table className="admin-table picks-grid">
            <thead>
              <tr>
                <th className="th-name">Participant</th>
                <th className="th-status">Status</th>
                {days.map(d => (
                  <th key={d.game_date} className="th-day">
                    <div>{formatDate(d.game_date)}</div>
                    <div className="th-round">{d.round_name.replace('Round of ', 'R').replace('Sweet ', 'S').replace('Elite ', 'E').replace('Final Four', 'F4').replace('Championship', 'Champ')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {participants.filter(p => p.is_paid).map(p => (
                <tr key={p.id} className={p.is_eliminated ? 'row-eliminated' : ''}>
                  <td className="td-name">{p.full_name}</td>
                  <td>
                    <span className={`status-pill ${p.is_eliminated ? 'eliminated' : 'alive'}`}>
                      {p.is_eliminated ? '💀' : '🟢'}
                    </span>
                  </td>
                  {days.map(d => {
                    const dayPicks = picks.filter(pk => pk.participant_id === p.id && pk.game_date === d.game_date)
                    return (
                      <td key={d.game_date} className="td-pick-cell">
                        {dayPicks.length === 0 ? (
                          <span className="pick-empty">—</span>
                        ) : (
                          dayPicks.map(pick => (
                            <div key={pick.id} className={`pick-cell-item result-${pick.result}`}>
                              <div className="pick-cell-team">
                                {pick.is_auto_assigned && <span className="auto-dot" title="Auto-assigned">⚡</span>}
                                #{pick.teams?.seed} {pick.teams?.name}
                              </div>
                              <select
                                className="result-select-sm"
                                value={pick.result}
                                onChange={e => updatePickResult(pick.id, e.target.value)}
                              >
                                <option value="pending">⏳</option>
                                <option value="won">✅</option>
                                <option value="lost">❌</option>
                              </select>
                            </div>
                          ))
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {days.length === 0 && (
            <div style={{padding: '32px', textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '14px'}}>
              No tournament days have passed yet — picks will appear here once games start.
            </div>
          )}
        </div>
      )}

      {/* ASSIGN PICK TAB */}
      {tab === 'assign' && (
        <div className="assign-form-wrap">
          <p className="assign-description">
            Use this to manually assign a pick for a participant who missed the deadline.
            Per pool rules, this should be the <strong>worst-seed available team</strong> in the last game of the day.
          </p>
          <form onSubmit={handleAssignPick} className="assign-form">
            <div className="assign-field">
              <label>Participant</label>
              <select value={assignParticipantId} onChange={e => setAssignParticipantId(e.target.value)} required>
                <option value="">Select participant...</option>
                {participants.filter(p => p.is_paid && !p.is_eliminated).map(p => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </div>
            <div className="assign-field">
              <label>Tournament Date</label>
              <select value={assignDate} onChange={e => setAssignDate(e.target.value)} required>
                <option value="">Select date...</option>
                {days.map(d => (
                  <option key={d.game_date} value={d.game_date}>
                    {formatDate(d.game_date)} — {d.round_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="assign-field">
              <label>Team to Assign</label>
              <select value={assignTeamId} onChange={e => setAssignTeamId(e.target.value)} required>
                <option value="">Select team...</option>
                {['East','West','South','Midwest'].map(region => (
                  <optgroup key={region} label={region}>
                    {teams.filter(t => t.region === region).map(t => (
                      <option key={t.id} value={t.id}>#{t.seed} {t.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <button type="submit" className="btn-primary" disabled={saving === 'assign'}>
              {saving === 'assign' ? 'Assigning...' : '⚡ Assign Pick'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
