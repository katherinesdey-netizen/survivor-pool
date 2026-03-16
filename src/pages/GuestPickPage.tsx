import React, { useState } from 'react'
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

interface Game {
  team1_id: number | null
  team2_id: number | null
}

interface Participant {
  id: string
  full_name: string
  is_paid: boolean
  is_eliminated: boolean
}

interface SubmittedPick {
  team_id: number
  game_date: string
  team_name: string | null
  team_seed: number | null
  team_region: string | null
}

type Step = 'email' | 'new_user' | 'picking' | 'done' | 'already_picked' | 'no_games'

const R64_PODS: [number, number][] = [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]]
const REGIONS = ['East', 'West', 'South', 'Midwest']

export default function GuestPickPage() {
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [name, setName] = useState('')
  const [nameLoading, setNameLoading] = useState(false)
  const [nameError, setNameError] = useState('')

  const [participant, setParticipant] = useState<Participant | null>(null)
  const [today, setToday] = useState<TournamentDay | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [games, setGames] = useState<Game[]>([])
  const [usedTeamIds, setUsedTeamIds] = useState<Set<number>>(new Set())
  const [existingPicks, setExistingPicks] = useState<SubmittedPick[]>([])

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

      // Single serverless call returns all data — bypasses RLS
      const res = await fetch('/api/lookup-participant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      })
      const json = await res.json()

      if (!res.ok) {
        setEmailError(json.message || 'Something went wrong. Please try again.')
        setEmailLoading(false)
        return
      }

      // New email — need a name to create the participant
      if (json.needs_name) {
        setStep('new_user')
        setEmailLoading(false)
        return
      }

      const { participant: p, today: day, last_day, teams: teamsData, games: gamesData, picks: allPicks } = json

      setParticipant(p)
      setTeams(teamsData || [])
      setGames(gamesData || [])

      if (!day) {
        setToday(last_day ?? null)
        setStep('no_games')
        setEmailLoading(false)
        return
      }

      setToday(day)

      const used = new Set<number>(
        (allPicks as SubmittedPick[])
          .filter(pk => pk.game_date !== day.game_date)
          .map(pk => pk.team_id)
      )
      setUsedTeamIds(used)

      const todayPicks = (allPicks as SubmittedPick[]).filter(pk => pk.game_date === day.game_date)
      setExistingPicks(todayPicks)

      if (todayPicks.length >= (day.picks_required ?? 1)) {
        setStep('already_picked')
      } else {
        setStep('picking')
      }

    } catch (err) {
      setEmailError('Something went wrong. Please try again.')
    }

    setEmailLoading(false)
  }

  async function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault()
    setNameError('')
    setNameLoading(true)

    try {
      const trimmed = email.trim().toLowerCase()
      const res = await fetch('/api/lookup-participant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, name: name.trim() }),
      })
      const json = await res.json()

      if (!res.ok) {
        setNameError(json.message || 'Something went wrong. Please try again.')
        setNameLoading(false)
        return
      }

      const { participant: p, today: day, last_day, teams: teamsData, games: gamesData, picks: allPicks } = json

      setParticipant(p)
      setTeams(teamsData || [])
      setGames(gamesData || [])

      if (!day) {
        setToday(last_day ?? null)
        setStep('no_games')
        setNameLoading(false)
        return
      }

      setToday(day)
      setUsedTeamIds(new Set())
      setExistingPicks([])
      setStep('picking')

    } catch (err) {
      setNameError('Something went wrong. Please try again.')
    }

    setNameLoading(false)
  }

  function toggleTeam(team: Team) {
    const required = today?.picks_required ?? 1
    setSelectedTeams(prev => {
      if (prev.find(t => t.id === team.id)) return prev.filter(t => t.id !== team.id)
      if (prev.length >= required) return [...prev.slice(0, required - 1), team]
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
        setSubmitError(json.message || 'Failed to submit. Please try again.')
        setSubmitting(false)
        return
      }

      setDoneData({ picks: json.picks, round: json.round_name })
      setStep('done')
    } catch (err) {
      setSubmitError('Submission failed. Please check your connection and try again.')
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
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  }

  // Build lookup maps for matchup display
  const byRegionSeed: Record<string, Record<number, Team>> = {}
  teams.forEach(t => {
    if (!byRegionSeed[t.region]) byRegionSeed[t.region] = {}
    byRegionSeed[t.region][t.seed] = t
  })

  const availableTeamIds: Set<number> | null = games.length > 0
    ? new Set(games.flatMap(g => [g.team1_id, g.team2_id].filter((id): id is number => id !== null)))
    : null

  const required = today?.picks_required ?? 1
  const selectionComplete = selectedTeams.length === required
  const firstName = participant?.full_name?.split(' ')[0]

  function MatchSlot({ team, isLast }: { team: Team | null; isLast?: boolean }) {
    if (!team) return (
      <div className={`gp-match-slot gp-slot-tbd${isLast ? ' gp-slot-last' : ''}`}>
        <span className="gp-match-seed">?</span>
        <span className="gp-match-name">TBD</span>
      </div>
    )
    const isSelected = selectedTeams.some(t => t.id === team.id)
    const isUsed = usedTeamIds.has(team.id)
    const isPlayingToday = availableTeamIds === null || availableTeamIds.has(team.id)
    const canClick = !isUsed && isPlayingToday

    return (
      <button
        className={[
          'gp-match-slot',
          isLast ? 'gp-slot-last' : '',
          isSelected ? 'gp-slot-selected' : '',
          isUsed && !isSelected ? 'gp-slot-used' : '',
          !isPlayingToday ? 'gp-slot-not-today' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => canClick && toggleTeam(team)}
        disabled={!canClick}
      >
        <span className="gp-match-seed">{team.seed}</span>
        <span className="gp-match-name">{team.name}</span>
        {isSelected && <span className="gp-match-check">✓</span>}
        {isUsed && !isSelected && <span className="gp-match-used-tag">used</span>}
      </button>
    )
  }

  return (
    <div className="gp-page">
      <div className="gp-bg" />
      <div className={`gp-card${step === 'picking' ? ' gp-card-wide' : ''}`}>

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

        {/* ── New user — collect name ── */}
        {step === 'new_user' && (
          <div className="gp-section">
            <div className="gp-new-user-badge">🎉 New to the pool!</div>
            <p className="gp-intro">We didn't find <strong>{email}</strong> — enter your name and we'll add you automatically.</p>
            <form onSubmit={handleNameSubmit} className="gp-form">
              <div className="gp-field">
                <label>Your full name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="First Last"
                  required
                  autoFocus
                  className="gp-input"
                />
              </div>
              {nameError && <p className="gp-error">{nameError}</p>}
              <button type="submit" className="gp-btn-primary" disabled={nameLoading || !name.trim()}>
                {nameLoading ? 'Joining…' : 'Join & Pick →'}
              </button>
              <button type="button" className="gp-back-link" onClick={() => { setStep('email'); setNameError('') }}>
                ← Use a different email
              </button>
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
                  <span className="gp-seed">#{pk.team_seed}</span>
                  <span className="gp-team-name">{pk.team_name}</span>
                  <span className="gp-region-tag">{pk.team_region}</span>
                </div>
              ))}
            </div>
            {today.deadline && new Date() < new Date(today.deadline) && (
              <button className="gp-btn-ghost" onClick={startChanging}>Change my picks</button>
            )}
            <a href="/standings" className="gp-back-link" style={{ marginTop: '8px' }}>View Standings →</a>
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
              {required > 1
                ? <>Pick <strong>{required} teams</strong> — {selectedTeams.length} of {required} selected</>
                : <>Pick <strong>1 team</strong> to advance today</>}
              <span className="gp-counter-note">You can't reuse a team from a previous day.</span>
            </div>

            {/* Legend */}
            <div className="gp-legend">
              <span className="gp-legend-item gp-legend-bright"><span className="gp-legend-dot gp-dot-alive" />Playing today</span>
              <span className="gp-legend-item"><span className="gp-legend-dot gp-dot-selected" />Your pick</span>
              <span className="gp-legend-item"><span className="gp-legend-dot gp-dot-used" />Already used</span>
              {availableTeamIds !== null && (
                <span className="gp-legend-item"><span className="gp-legend-dot gp-dot-not-today" />Not today</span>
              )}
            </div>

            {/* Matchup grid — 2 columns (all 4 regions) */}
            <div className="gp-regions-grid">
              {REGIONS.map(region => (
                <div key={region} className="gp-region-section">
                  <div className="gp-region-label">{region}</div>
                  {R64_PODS.map(([seed1, seed2]) => {
                    const team1 = byRegionSeed[region]?.[seed1] || null
                    const team2 = byRegionSeed[region]?.[seed2] || null
                    return (
                      <div key={seed1} className="gp-matchup">
                        <MatchSlot team={team1} />
                        <div className="gp-match-gap" />
                        <MatchSlot team={team2} isLast />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            {/* Sticky confirm bar */}
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
            <a href="/standings" className="gp-btn-secondary" style={{ marginTop: '8px' }}>View Standings →</a>
          </div>
        )}

      </div>
    </div>
  )
}
