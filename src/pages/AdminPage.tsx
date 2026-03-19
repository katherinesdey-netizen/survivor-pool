import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
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

type Tab = 'participants' | 'picks' | 'assign' | 'recaps'

interface Recap {
  id: number
  title: string
  body?: string
  image_urls: string[]
  game_date: string
}

export default function AdminPage() {
  const { session } = useAuth()
  const [tab, setTab] = useState<Tab>('participants')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [days, setDays] = useState<TournamentDay[]>([])
  const [picks, setPicks] = useState<Pick[]>([])
  const [recaps, setRecaps] = useState<Recap[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshLog, setRefreshLog] = useState<string[] | null>(null)
  const [sendingRecapId, setSendingRecapId] = useState<number | null>(null)
  const [recapSentMsg, setRecapSentMsg] = useState<{ [id: number]: string }>({})

  // Assign pick form state
  const [assignParticipantId, setAssignParticipantId] = useState('')
  const [assignTeamId, setAssignTeamId] = useState('')
  const [assignDate, setAssignDate] = useState('')

  // Recap form state
  const [recapTitle, setRecapTitle] = useState('')
  const [recapBody, setRecapBody] = useState('')
  const [recapDate, setRecapDate] = useState(new Date().toISOString().split('T')[0])
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)

    const [{ data: pData }, { data: tData }, { data: dData }, { data: pickData }, { data: recapData }] = await Promise.all([
      supabase.from('participants').select('*').order('full_name'),
      supabase.from('teams').select('*').eq('is_eliminated', false).order('seed'),
      supabase.from('tournament_days').select('*').order('game_date'),
      supabase.from('picks').select('id, participant_id, team_id, game_date, result, is_auto_assigned, teams(name, seed), participants(full_name)').order('game_date', { ascending: false }),
      supabase.from('recaps').select('id, title, game_date, image_urls').order('game_date', { ascending: false }).order('id', { ascending: false })
    ])

    setParticipants(pData || [])
    setTeams(tData || [])
    setDays(dData || [])
    setPicks((pickData as any) || [])
    setRecaps(recapData || [])
    setLoading(false)
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 4000)
  }

  async function refreshResults() {
    setRefreshing(true)
    setRefreshLog(null)
    try {
      const res = await fetch('/api/update-results', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.REACT_APP_CRON_SECRET || ''}` },
      })
      const data = await res.json()
      setRefreshLog(data.log || [])
      if (data.success) {
        showMsg('success', `Results updated — ${data.gamesProcessed} games processed, ${data.picksUpdated} picks updated.`)
        await fetchData()
      } else {
        showMsg('error', `Error: ${data.error}`)
      }
    } catch (err) {
      showMsg('error', 'Failed to reach update function. Is it deployed?')
    }
    setRefreshing(false)
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


  async function updatePickResult(pickId: number, result: string) {
    const { error } = await supabase.from('picks').update({ result }).eq('id', pickId)
    if (error) { showMsg('error', 'Failed to update result.'); return }

    // If marked as lost, auto-eliminate the participant
    if (result === 'lost') {
      const pick = picks.find(p => p.id === pickId)
      if (pick) {
        await supabase.from('participants').update({
          is_eliminated: true,
          eliminated_on_date: pick.game_date,
        }).eq('id', pick.participant_id)
      }
    }

    showMsg('success', 'Pick result updated.')
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

  function cleanText(text: string): string {
    return text
      .replace(/[\u2018\u2019]/g, "'")   // curly single quotes → straight
      .replace(/[\u201C\u201D]/g, '"')   // curly double quotes → straight
      .replace(/\u2013/g, '-')           // en dash → hyphen
      .replace(/\u2014/g, '--')          // em dash → double hyphen
      .replace(/\u2026/g, '...')         // ellipsis → three dots
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric'
    })
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingImage(true)
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage
      .from('recap-media')
      .upload(path, file, { contentType: file.type })
    if (error) {
      showMsg('error', 'Upload failed: ' + error.message)
      setUploadingImage(false)
      e.target.value = ''
      return
    }
    const { data: urlData } = supabase.storage.from('recap-media').getPublicUrl(path)
    const url = urlData.publicUrl
    setRecapBody(prev => prev + (prev === '' || prev.endsWith('\n') ? '' : '\n') + url + '\n')
    showMsg('success', 'Image uploaded — URL added to recap body.')
    setUploadingImage(false)
    e.target.value = ''
  }

  async function handleSaveRecap(e: React.FormEvent) {
    e.preventDefault()
    if (!recapTitle.trim()) { showMsg('error', 'Please enter a title.'); return }
    if (!recapBody.trim()) { showMsg('error', 'Please enter a recap body.'); return }
    if (!recapDate) { showMsg('error', 'Please select a date.'); return }

    setSaving('recap')

    try {
      // Bypass Supabase JS client and use raw fetch with Prefer:return=minimal
      // so the server returns 204 No Content — no response body to hang on.
      // Use session from AuthContext — avoids a second getSession() call that
      // causes Web Lock conflicts with the auth client.
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/rest/v1/recaps`,
        {
          method: 'POST',
          headers: {
            'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY!,
            'Authorization': `Bearer ${session!.access_token}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({
            title: cleanText(recapTitle.trim()),
            body: cleanText(recapBody.trim()),
            game_date: recapDate,
            image_urls: [],
          }),
        }
      )

      if (!res.ok) {
        const errText = await res.text()
        showMsg('error', errText || `Error ${res.status}`)
      } else {
        showMsg('success', 'Recap posted!')
        setRecaps(prev => [{
          id: Date.now(),
          title: cleanText(recapTitle.trim()),
          body: cleanText(recapBody.trim()),
          game_date: recapDate,
          image_urls: [],
        }, ...prev])
        setRecapTitle('')
        setRecapBody('')
        setRecapDate(new Date().toISOString().split('T')[0])
      }
    } catch (err: any) {
      showMsg('error', err.message || 'Network error')
    }

    setSaving(null)
  }

  async function handleSendRecap(id: number, testOnly = false) {
    const confirmMsg = testOnly
      ? 'Send a test email to adamsfurtado@gmail.com?'
      : 'Send this recap to all paid participants via email?'
    if (!window.confirm(confirmMsg)) return
    setSendingRecapId(testOnly ? id * -1 : id)
    try {
      const body: any = { recap_id: id }
      if (testOnly) body.test_email = 'adamsfurtado@gmail.com'
      const res = await fetch('/api/send-recap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.REACT_APP_CRON_SECRET || ''}`,
        },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok) {
        const msg = testOnly ? 'Test sent to adamsfurtado@gmail.com ✓' : `Sent to ${data.sent} participants ✓`
        setRecapSentMsg(prev => ({ ...prev, [id]: msg }))
      } else {
        setRecapSentMsg(prev => ({ ...prev, [id]: `Error: ${data.error || 'Unknown error'}` }))
      }
    } catch (err: any) {
      setRecapSentMsg(prev => ({ ...prev, [id]: 'Network error — is /api/send-recap deployed?' }))
    }
    setSendingRecapId(null)
  }

  async function handleDeleteRecap(id: number) {
    if (!window.confirm('Delete this recap?')) return
    const { error } = await supabase.from('recaps').delete().eq('id', id)
    if (error) showMsg('error', 'Failed to delete recap.')
    else showMsg('success', 'Recap deleted.')
    await fetchData()
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
        <div className="admin-header-btns">
          <button className="refresh-btn" onClick={fetchData}>↻ Refresh Data</button>
          <button 
            className="refresh-results-btn" 
            onClick={refreshResults}
            disabled={refreshing}
          >
            {refreshing ? '⏳ Checking ESPN...' : '🏀 Fetch Game Results'}
          </button>
        </div>
      </div>

      {msg && <div className={`admin-msg ${msg.type}`}>{msg.text}</div>}

      {/* Results log */}
      {refreshLog && (
        <div className="refresh-log">
          <div className="refresh-log-title">Result Update Log</div>
          {refreshLog.map((line, i) => (
            <div key={i} className="refresh-log-line">{line}</div>
          ))}
          <button className="refresh-log-close" onClick={() => setRefreshLog(null)}>✕ Close</button>
        </div>
      )}

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
        <button className={`admin-tab ${tab === 'recaps' ? 'active' : ''}`} onClick={() => setTab('recaps')}>
          Recaps ({recaps.length})
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

      {/* RECAPS TAB */}
      {tab === 'recaps' && (
        <div className="recaps-admin-wrap">

          {/* Post new recap */}
          <div className="recap-form-section">
            <h3 className="recap-form-title">Post a New Recap</h3>
            <form onSubmit={handleSaveRecap} className="recap-form">
              <div className="assign-field">
                <label>Game Date</label>
                <input
                  type="date"
                  value={recapDate}
                  onChange={e => setRecapDate(e.target.value)}
                  required
                />
              </div>
              <div className="assign-field">
                <label>Title</label>
                <input
                  type="text"
                  value={recapTitle}
                  onChange={e => setRecapTitle(e.target.value)}
                  placeholder="Day 1: Chaos Reigns"
                  required
                />
              </div>
              <div className="assign-field">
                <label>Recap <span style={{fontWeight:400, color:'rgba(255,255,255,0.35)'}}>— use **bold** for emphasis, new lines for paragraphs</span></label>
                <div className="recap-img-hint">
                  <strong style={{color:'rgba(255,255,255,0.6)'}}>Media:</strong> Upload a photo/GIF below, or paste a URL on its own line. YouTube links auto-embed.<br/>
                  <code>https://youtu.be/abc123</code> &nbsp;or&nbsp; <code>https://i.imgur.com/abc.gif</code>
                </div>
                <textarea
                  value={recapBody}
                  onChange={e => setRecapBody(e.target.value)}
                  placeholder={`Duke came out firing today.\n\nhttps://youtu.be/abc123\n\nMeanwhile on the other side of the bracket...`}
                  rows={12}
                  required
                />
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.gif"
                  style={{ display: 'none' }}
                  onChange={handleImageUpload}
                />
                <button
                  type="button"
                  className="btn-upload"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage}
                >
                  {uploadingImage ? '⏳ Uploading...' : '📎 Upload Image / GIF'}
                </button>
              </div>
              <button type="submit" className="btn-primary" disabled={saving === 'recap'}>
                {saving === 'recap' ? 'Posting...' : '📝 Post Recap'}
              </button>
            </form>
          </div>

          {/* Existing recaps */}
          {recaps.length > 0 && (
            <div className="recap-list-section">
              <h3 className="recap-form-title">Posted Recaps</h3>
              <div className="recap-admin-list">
                {recaps.map(recap => (
                  <div key={recap.id} className="recap-admin-row">
                    <div className="recap-admin-info">
                      <div className="recap-admin-date">{formatDate(recap.game_date)}</div>
                      <div className="recap-admin-title">{recap.title}</div>
                      <div className="recap-admin-preview">{recap.body ? recap.body.slice(0, 100) + '...' : '(preview not available)'}</div>
                    </div>
                    <div className="recap-admin-actions">
                      {recapSentMsg[recap.id] && (
                        <div className={`recap-sent-msg ${recapSentMsg[recap.id].startsWith('Error') || recapSentMsg[recap.id].startsWith('Network') ? 'recap-sent-error' : 'recap-sent-ok'}`}>
                          {recapSentMsg[recap.id]}
                        </div>
                      )}
                      <button
                        className="action-btn btn-test"
                        onClick={() => handleSendRecap(recap.id, true)}
                        disabled={sendingRecapId === recap.id * -1}
                      >
                        {sendingRecapId === recap.id * -1 ? 'Sending...' : '🧪 Test'}
                      </button>
                      <button
                        className="action-btn btn-email"
                        onClick={() => handleSendRecap(recap.id)}
                        disabled={sendingRecapId === recap.id}
                      >
                        {sendingRecapId === recap.id ? '📧 Sending...' : '📧 Send Email'}
                      </button>
                      <button
                        className="action-btn btn-danger"
                        onClick={() => handleDeleteRecap(recap.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
