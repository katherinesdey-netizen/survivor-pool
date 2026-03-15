import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import './GuestPickPage.css'

interface TournamentDay {
  game_date: string
  round_name: string
  deadline: string | null
}

interface Team {
  id: number
  name: string
  seed: number
  region: string
  is_eliminated: boolean
}

interface Participant {
  id: string
  full_name: string
  is_paid: boolean
  is_eliminated: boolean
}

interface ExistingPick {
  team_id: number
  teams: { name: string; seed: number; region: string } | null
}

type Step = 'email' | 'picking' | 'confirming' | 'done' | 'no_games' | 'already_picked' | 'error'

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
  const [existingPick, setExistingPick] = useState<ExistingPick | null>(null)

  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [doneData, setDoneData] = useState<{ teamName: string; seed: number; round: string } | null>(null)

  const [pageError, setPageError] = useState('')

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setEmailError('')
    setEmailLoading(true)

    try {
      const trimmed = email.trim().toLowerCase()

      // Look up participant
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

      // Find today's (or next upcoming) tournament day
      const todayStr = new Date().toISOString().split('T')[0]
      const { data: dayData } = await supabase
        .from('tournament_days')
        .select('game_date, round_name, deadline')
        .gte('game_date', todayStr)
        .order('game_date', { ascending: true })
        .limit(1)

      const day = dayData?.[0] ?? null

      if (!day) {
        setToday(null)
        setStep('no_games')
        setEmailLoading(false)
        return
      }

      setToday(day)

      // Check if deadline has passed
      if (day.deadline && new Date() > new Date(day.deadline)) {
        setStep('no_games')
        setEmailLoading(false)
        return
      }

      // Fetch all non-eliminated teams
      const { data: teamsData } = await supabase
        .from('teams')
        .select('id, name, seed, region, is_eliminated')
        .eq('is_eliminated', false)
        .order('seed', { ascending: true })

      setTeams(teamsData || [])

      // Fetch this participant's already-used team IDs (all picks ever)
      const { data: allPicks } = await supabase
        .from('picks')
        .select('team_id, game_date, teams(name, seed, region)')
        .eq('participant_id', p.id)

      const used = new Set<number>((allPicks || []).map((pk: any) => pk.team_id))
      setUsedTeamIds(used)

      // Check if they already have a pick for today
      const todayPick = (allPicks || []).find((pk: any) => pk.game_date === day.game_date) as ExistingPick | undefined
      if (todayPick) {
        setExistingPick(todayPick)
        setStep('already_picked')
      } else {
        setStep('picking')
      }

    } catch (err) {
      setEmailError('Something went wrong. Please try again.')
    }

    setEmailLoading(false)
  }

  async function handleSubmit() {
    if (!selectedTeam || !today || !participant) return
    setSubmitting(true)
    setSubmitError('')

    try {
      const res = await fetch('/api/submit-pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          team_id: selectedTeam.id,
          game_date: today.game_date,
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        setSubmitError(json.message || 'Failed to submit pick. Please try again.')
        setSubmitting(false)
        return
      }

      setDoneData({
        teamName: json.team_name,
        seed: json.team_seed,
        round: json.round_name,
      })
      setStep('done')
    } catch (err) {
      setSubmitError('Network error. Please check your connection and try again.')
    }

    setSubmitting(false)
  }

  function formatDeadline(iso: string) {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    })
  }

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

        {/* ── Step: Email ── */}
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

        {/* ── Step: No games / deadline passed ── */}
        {step === 'no_games' && (
          <div className="gp-section gp-center">
            <div className="gp-big-emoji">📅</div>
            <h2>No picks today</h2>
            {today ? (
              <p>The deadline for <strong>{today.round_name}</strong> has passed.</p>
            ) : (
              <p>There are no tournament games scheduled right now. Check back when the next round begins!</p>
            )}
            <a href="/standings" className="gp-btn-secondary" style={{ marginTop: '16px' }}>
              View Standings →
            </a>
          </div>
        )}

        {/* ── Step: Already picked today ── */}
        {step === 'already_picked' && existingPick && today && (
          <div className="gp-section">
            <div className="gp-greeting">Hey, {participant?.full_name?.split(' ')[0]}! 👋</div>
            <div className="gp-already-card">
              <div className="gp-already-label">Your pick for {today.round_name}</div>
              <div className="gp-already-team">
                <span className="gp-seed">#{existingPick.teams?.seed}</span>
                <span className="gp-team-name">{existingPick.teams?.name}</span>
              </div>
              <div className="gp-already-region">{existingPick.teams?.region} Region</div>
            </div>
            {today.deadline && new Date() < new Date(today.deadline) && (
              <button
                className="gp-btn-ghost"
                onClick={() => {
                  setExistingPick(null)
                  setStep('picking')
                }}
              >
                Change my pick
              </button>
            )}
            <a href="/standings" className="gp-back-link" style={{ marginTop: '8px' }}>
              View Standings →
            </a>
          </div>
        )}

        {/* ── Step: Pick a team ── */}
        {step === 'picking' && today && (
          <div className="gp-section">
            <div className="gp-greeting">Hey, {participant?.full_name?.split(' ')[0]}! 👋</div>
            <div className="gp-round-info">
              <div className="gp-round-name">{today.round_name}</div>
              <div className="gp-round-date">{formatDate(today.game_date)}</div>
              {today.deadline && (
                <div className="gp-deadline">
                  ⏰ Deadline: <strong>{formatDeadline(today.deadline)}</strong>
                </div>
              )}
            </div>
            <p className="gp-pick-prompt">Pick one team to advance. You can't reuse a team you've already picked.</p>

            {REGIONS.map(region => {
              const regionTeams = teams.filter(t => t.region === region)
              if (regionTeams.length === 0) return null
              return (
                <div key={region} className="gp-region">
                  <div className="gp-region-label">{region}</div>
                  <div className="gp-team-grid">
                    {regionTeams.map(team => {
                      const isUsed = usedTeamIds.has(team.id)
                      const isSelected = selectedTeam?.id === team.id
                      return (
                        <button
                          key={team.id}
                          className={`gp-team-btn
                            ${isSelected ? 'gp-selected' : ''}
                            ${isUsed ? 'gp-used' : ''}
                          `}
                          disabled={isUsed}
                          onClick={() => setSelectedTeam(isSelected ? null : team)}
                        >
                          <span className="gp-btn-seed">#{team.seed}</span>
                          <span className="gp-btn-name">{team.name}</span>
                          {isUsed && <span className="gp-used-tag">used</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {selectedTeam && (
              <div className="gp-confirm-bar">
                <div className="gp-confirm-pick">
                  <span className="gp-confirm-seed">#{selectedTeam.seed}</span>
                  <span className="gp-confirm-name">{selectedTeam.name}</span>
                  <span className="gp-confirm-region">{selectedTeam.region}</span>
                </div>
                {submitError && <p className="gp-error">{submitError}</p>}
                <button
                  className="gp-btn-primary"
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? 'Submitting…' : 'Submit Pick →'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Step: Done ── */}
        {step === 'done' && doneData && (
          <div className="gp-section gp-center">
            <div className="gp-big-emoji">✅</div>
            <h2>Pick submitted!</h2>
            <div className="gp-done-card">
              <div className="gp-done-round">{doneData.round}</div>
              <div className="gp-done-team">
                <span className="gp-seed">#{doneData.seed}</span>
                <span className="gp-team-name">{doneData.teamName}</span>
              </div>
            </div>
            <p className="gp-done-note">Good luck, {participant?.full_name?.split(' ')[0]}!</p>
            <a href="/standings" className="gp-btn-secondary" style={{ marginTop: '8px' }}>
              View Standings →
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
