import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import './GuestPickPage.css'

interface TournamentDay {
  game_date: string
  round_name: string
  deadline: string | null
  picks_required: number
}

interface Team {
  id: number
  name: string
  seed: number
  region: string
}

interface Participant {
  id: string
  full_name: string
  is_paid: boolean
  is_eliminated: boolean
}

interface SubmittedPick {
  team_id: number
  teams: { name: string; seed: number; region: string } | null
}

type Step = 'email' | 'picking' | 'done' | 'already_picked' | 'no_games'

const REGIONS = ['East', 'West', 'South', 'Midwest']

export default function GuestPickPage() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError] = useState('')

  const [participant, setParticipant] = useState<Participant | null>(null)
  const [today, setToday] = useState<TournamentDay | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [usedTeamIds, setUsedTeamIds] = useState<Set<number>>(new Set())
  const [existingPicks, setExistingPicks] = useState<SubmittedPick[]>([])

  // Multi-select: up to picks_required teams
  const [selectedTeams, setSelectedTeams] = useState<Team[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [doneData, setDoneData] = useState<{ picks: { name: string; seed: number; region: string }[]; round: string } | null>(null)

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setEmailError('')
    setEmailLoading(true)

    try {
      const trimmed = email.trim().toLowerCase()

      const { data: p } = await supabase
        .from('participants')
        .select('id, full_name, is_paid, is_eliminated')
        .ilike('email', trimmed)
        .maybeSingle()

      if (!p) {
        setEmailError("We don't have that email on file. Check for typos or contact the pool admin.")
        setEmailLoading(false)
        return
      }
      if (!p.is_paid) {
        setEmailError("Your entry fee hasn't been confirmed yet. Contact the pool admin.")
        setEmailLoading(false)
        return
      }
      if (p.is_eliminated) {
        setEmailError("You've been eliminated from the pool. Better luck next year! 😢")
        setEmailLoading(false)
        return
      }

      setParticipant(p)

      // Find the next open tournament day (today or future, deadline not yet passed)
      const todayStr = new Date().toISOString().split('T')[0]
      const { data: dayData } = await supabase
        .from('tournament_days')
        .select('game_date, round_name, deadline, picks_required')
        .gte('game_date', todayStr)
        .order('game_date', { ascending: true })

      // Find the first day whose deadline hasn't passed
      const now = new Date()
      const day = (dayData || []).find(d =>
        !d.deadline || now < new Date(d.deadline)
      ) ?? null

      if (!day) {
        setToday(dayData?.[0] ?? null) // still set for "deadline passed" message
        setStep('no_games')
        setEmailLoading(false)
        return
      }

      setToday(day)

      // Fetch all non-eliminated teams
      const { data: teamsData } = await supabase
        .from('teams')
        .select('id, name, seed, region, is_eliminated')
        .eq('is_eliminated', false)
        .order('seed', { ascending: true })

      setTeams(teamsData || [])

      // All picks this participant has ever made
      const { data: allPicks } = await supabase
        .from('picks')
        .select('team_id, game_date, teams(name, seed, region)')
        .eq('participant_id', p.id)

      // Teams used on OTHER days (can't reuse)
      const used = new Set<number>(
        (allPicks || [])
          .filter((pk: any) => pk.game_date !== day.game_date)
          .map((pk: any) => pk.team_id)
      )
      setUsedTeamIds(used)

      // Picks already submitted for today
      const todayPicks = (allPicks || []).filter((pk: any) => pk.game_date === day.game_date) as unknown as SubmittedPick[]
      const required = day.picks_required ?? 1

      setExistingPicks(todayPicks)

      if (todayPicks.length >= required) {
        setStep('already_picked')
      } else {
        setStep('picking')
      }

    } catch (err) {
      setEmailError('Something went wrong. Please try again.')
    }

    setEmailLoading(false)
  }

  function toggleTeam(team: Team) {
    const required = today?.picks_required ?? 1
    setSelectedTeams(prev => {
      const already = prev.find(t => t.id === team.id)
      if (already) return prev.filter(t => t.id !== team.id)
      if (prev.length >= required) {
        // Replace the last selection if at max
        return [...prev.slice(0, required - 1), team]
      }
      return [...prev, team]
    })
  }

  async function handleSubmit(clearFirst = false) {
    if (!today || !participant || selectedTeams.length === 0) return
    const required = today.picks_required ?? 1
    if (selectedTeams.length !== required) return

    setSubmitting(true)
    setSubmitError('')

    try {
      const res = await fetch('/api/submit-pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          team_ids: selectedTeams.map(t => t.id),
          game_date: today.game_date,
          clear_first: clearFirst,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        setSubmitError(json.message || 'Failed to submit pick. Please try again.')
        setSubmitting(false)
        return
      }

      setDoneData({ picks: json.picks, round: json.round_name })
      setStep('done')
    } catch (err) {
      setSubmitError('Network error. Please check your connection and try again.')
    }

    setSubmitting(false)
  }

  function startChanging() {
    setExistingPicks([])
    setSelectedTeams([])
    setSubmitError('')
    setStep('picking')
  }

  function formatDeadline(iso: string) {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    })
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'long', day: 'numeric',
    })
  }

  const required = today?.picks_required ?? 1
  const selectionComplete = selectedTeams.length === required
  const firstName = participant?.full_name?.split(' ')[0]

  return (
    <div className="gp-page">
      <div className="gp-bg" />
      <div className="gp-card">

        {/* Header */}
        <div className="gp-header">
          <div className="gp-emoji">🏀</div>
          <h1>March Madness<br />Survivor Pool</h1>
          <p className="gp-subtitle">2026 · Adam's Pool</p>
        </div>

        {/* ── Email ── */}
        {step === 'email' && (
          <div className="gp-section">
            <p className="gp-intro">Enter your email to look up your entry and submit your pick.</p>
            <form onSubmit={handleEmailSubmit} className="gp-form">
              <div className="gp-field">
                <label>Your email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoFocus
                  className="gp-input"
                />
              </div>
              {emailError && <p className="gp-error">{emailError}</p>}
              <button type="submit" className="gp-btn-primary" disabled={emailLoading}>
                {emailLoading ? 'Looking up…' : 'Continue →'}
              </button>
              <a href="/login" className="gp-back-link">← Back to sign in</a>
            </form>
          </div>
        )}

        {/* ── No games / deadline passed ── */}
        {step === 'no_games' && (
          <div className="gp-section gp-center">
            <div className="gp-big-emoji">📅</div>
            <h2>No picks open right now</h2>
            {today ? (
              <p>The deadline for <strong>{today.round_name}</strong> has passed. Check back for the next round!</p>
            ) : (
              <p>There are no tournament games scheduled right now. Check back when the next round begins!</p>
            )}
            <a href="/standings" className="gp-btn-secondary" style={{ marginTop: '16px' }}>
              View Standings →
            </a>
          </div>
        )}

        {/* ── Already picked ── */}
        {step === 'already_picked' && today && (
          <div className="gp-section">
            <div className="gp-greeting">Hey, {firstName}! 👋</div>
            <div className="gp-round-info">
              <div className="gp-round-name">{today.round_name}</div>
              <div className="gp-round-date">{formatDate(today.game_date)}</div>
            </div>
            <div className="gp-already-label-outer">Your pick{existingPicks.length > 1 ? 's' : ''} for today</div>
            <div className="gp-existing-picks">
              {existingPicks.map((pk, i) => (
                <div key={i} className="gp-existing-pick-row">
                  <span className="gp-seed">#{pk.teams?.seed}</span>
                  <span className="gp-team-name">{pk.teams?.name}</span>
                  <span className="gp-region-tag">{pk.teams?.region}</span>
                </div>
              ))}
            </div>
            {today.deadline && new Date() < new Date(today.deadline) && (
              <button className="gp-btn-ghost" onClick={startChanging}>
                Change my picks
              </button>
            )}
            <a href="/standings" className="gp-back-link" style={{ marginTop: '8px' }}>
              View Standings →
            </a>
          </div>
        )}

        {/* ── Pick teams ── */}
        {step === 'picking' && today && (
          <div className="gp-section">
            <div className="gp-greeting">Hey, {firstName}! 👋</div>
            <div className="gp-round-info">
              <div className="gp-round-name">{today.round_name}</div>
              <div className="gp-round-date">{formatDate(today.game_date)}</div>
              {today.deadline && (
                <div className="gp-deadline">⏰ Deadline: <strong>{formatDeadline(today.deadline)}</strong></div>
              )}
            </div>

            <div className="gp-pick-counter">
              {required > 1 ? (
                <>Pick <strong>{required} teams</strong> — {selectedTeams.length} of {required} selected</>
              ) : (
                <>Pick <strong>1 team</strong> to advance today</>
              )}
              <span className="gp-counter-note">You can't reuse a team from a previous day.</span>
            </div>

            {REGIONS.map(region => {
              const regionTeams = teams.filter(t => t.region === region)
              if (regionTeams.length === 0) return null
              return (
                <div key={region} className="gp-region">
                  <div className="gp-region-label">{region}</div>
                  <div className="gp-team-grid">
                    {regionTeams.map(team => {
                      const isUsed = usedTeamIds.has(team.id)
                      const isSelected = selectedTeams.some(t => t.id === team.id)
                      return (
                        <button
                          key={team.id}
                          className={`gp-team-btn ${isSelected ? 'gp-selected' : ''} ${isUsed ? 'gp-used' : ''}`}
                          disabled={isUsed}
                          onClick={() => toggleTeam(team)}
                        >
                          <span className="gp-btn-seed">#{team.seed}</span>
                          <span className="gp-btn-name">{team.name}</span>
                          {isSelected && <span className="gp-check">✓</span>}
                          {isUsed && <span className="gp-used-tag">used</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {/* Sticky confirm bar — shows as selections are made */}
            {selectedTeams.length > 0 && (
              <div className="gp-confirm-bar">
                <div className="gp-confirm-picks">
                  {selectedTeams.map((t, i) => (
                    <div key={i} className="gp-confirm-pick-row">
                      <span className="gp-confirm-seed">#{t.seed}</span>
                      <span className="gp-confirm-name">{t.name}</span>
                      <span className="gp-confirm-region">{t.region}</span>
                    </div>
                  ))}
                  {required > 1 && selectedTeams.length < required && (
                    <div className="gp-confirm-need-more">
                      Pick {required - selectedTeams.length} more team{required - selectedTeams.length > 1 ? 's' : ''}…
                    </div>
                  )}
                </div>
                {submitError && <p className="gp-error">{submitError}</p>}
                <button
                  className="gp-btn-primary"
                  onClick={() => handleSubmit(existingPicks.length > 0)}
                  disabled={submitting || !selectionComplete}
                >
                  {submitting ? 'Submitting…' : selectionComplete ? `Submit Pick${required > 1 ? 's' : ''} →` : `Select ${required - selectedTeams.length} more…`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Done ── */}
        {step === 'done' && doneData && (
          <div className="gp-section gp-center">
            <div className="gp-big-emoji">✅</div>
            <h2>Pick{doneData.picks.length > 1 ? 's' : ''} submitted!</h2>
            <div className="gp-done-card">
              <div className="gp-done-round">{doneData.round}</div>
              {doneData.picks.map((p, i) => (
                <div key={i} className="gp-done-team">
                  <span className="gp-seed">#{p.seed}</span>
                  <span className="gp-team-name">{p.name}</span>
                </div>
              ))}
            </div>
            <p className="gp-done-note">Good luck, {firstName}!</p>
            <a href="/standings" className="gp-btn-secondary" style={{ marginTop: '8px' }}>
              View Standings →
            </a>
          </div>
        )}

      </div>
    </div>
  )
}
