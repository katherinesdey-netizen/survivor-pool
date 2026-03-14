import React, { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import './PicksPage.css'

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
  is_complete: boolean
}

interface ExistingPick {
  id: number
  team_id: number
  game_date: string
  result: string
}

export default function PicksPage() {
  const { participant } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [todayInfo, setTodayInfo] = useState<TournamentDay | null>(null)
  const [existingPicks, setExistingPicks] = useState<ExistingPick[]>([])
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{type: 'success'|'error', text: string} | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (!participant) return
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participant])

  async function fetchData() {
    setLoading(true)

    // Get next upcoming tournament day
    const today = new Date().toISOString().split('T')[0]
    const { data: dayData } = await supabase
      .from('tournament_days')
      .select('*')
      .gte('game_date', today)
      .order('game_date', { ascending: true })
      .limit(1)

    if (!dayData || dayData.length === 0) {
      setLoading(false)
      return
    }

    const day = dayData[0]
    setTodayInfo(day)

    // Get all teams still in the tournament
    const { data: teamsData } = await supabase
      .from('teams')
      .select('*')
      .eq('is_eliminated', false)
      .order('seed', { ascending: true })

    setTeams(teamsData || [])

    // Get ALL picks this participant has ever made
    const { data: allPicks } = await supabase
      .from('picks')
      .select('id, team_id, game_date, result')
      .eq('participant_id', participant!.id)

    setExistingPicks(allPicks || [])

    // Pre-select any picks already submitted for today
    const todayPicks = (allPicks || []).filter(p => p.game_date === day.game_date)
    setSelectedTeamIds(todayPicks.map(p => p.team_id))

    setLoading(false)
  }

  function isDeadlinePassed(deadline: string) {
    return new Date() > new Date(deadline)
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    })
  }

  function formatDeadline(deadline: string) {
    return new Date(deadline).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    })
  }

  // Teams already picked in previous days (not today)
  const previouslyPickedTeamIds = new Set(
    existingPicks
      .filter(p => todayInfo && p.game_date !== todayInfo.game_date)
      .map(p => p.team_id)
  )

  // Teams picked today (already saved)
  const todaysSavedPickTeamIds = new Set(
    existingPicks
      .filter(p => todayInfo && p.game_date === todayInfo.game_date)
      .map(p => p.team_id)
  )

  function toggleTeam(teamId: number) {
    if (!todayInfo) return
    const deadlinePassed = isDeadlinePassed(todayInfo.deadline)
    if (deadlinePassed) return

    const picksRequired = todayInfo.picks_required

    if (selectedTeamIds.includes(teamId)) {
      // Deselect
      setSelectedTeamIds(prev => prev.filter(id => id !== teamId))
    } else {
      // Select — enforce max picks
      if (selectedTeamIds.length >= picksRequired) {
        setSaveMsg({
          type: 'error',
          text: `You can only pick ${picksRequired} team${picksRequired > 1 ? 's' : ''} today. Uncheck a selection first to swap it.`
        })
        setTimeout(() => setSaveMsg(null), 4000)
        return
      }
      setSelectedTeamIds(prev => [...prev, teamId])
    }
  }

  async function handleSave() {
    if (!todayInfo || !participant) return
    setSaving(true)
    setSaveMsg(null)

    // Validate
    if (selectedTeamIds.length !== todayInfo.picks_required) {
      setSaveMsg({
        type: 'error',
        text: `Please select exactly ${todayInfo.picks_required} team${todayInfo.picks_required > 1 ? 's' : ''} before saving.`
      })
      setSaving(false)
      return
    }

    // Delete today's existing picks first, then re-insert
    await supabase
      .from('picks')
      .delete()
      .eq('participant_id', participant.id)
      .eq('game_date', todayInfo.game_date)

    const newPicks = selectedTeamIds.map(teamId => ({
      participant_id: participant.id,
      team_id: teamId,
      game_date: todayInfo.game_date,
      result: 'pending'
    }))

    const { error } = await supabase
      .from('picks')
      .insert(newPicks)

    if (error) {
      setSaveMsg({ type: 'error', text: 'Something went wrong saving your picks. Please try again.' })
    } else {
      setSaveMsg({ type: 'success', text: '✅ Picks saved! To change them, uncheck a team below and select a different one. Your most recent submission counts.' })
      await fetchData()
    }

    setSaving(false)
  }

  // Filter teams by search
  const filteredTeams = teams.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.region.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Group by region
  const regions = ['East', 'West', 'South', 'Midwest']

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

  if (!todayInfo) {
    return (
      <div className="picks-page">
        <div className="no-games-card">
          <div style={{fontSize: '48px', marginBottom: '16px'}}>🏆</div>
          <h2>No upcoming games</h2>
          <p>There are no tournament days scheduled yet, or the tournament has ended.</p>
        </div>
      </div>
    )
  }

  const deadlinePassed = isDeadlinePassed(todayInfo.deadline)
  const picksRequired = todayInfo.picks_required
  const picksSelected = selectedTeamIds.length
  const picksRemaining = picksRequired - picksSelected

  return (
    <div className="picks-page">
      {/* Header */}
      <div className="picks-header">
        <div>
          <div className="picks-round">{todayInfo.round_name}</div>
          <h1 className="picks-date">{formatDate(todayInfo.game_date)}</h1>
        </div>
        <div className="picks-deadline-box">
          <div className="deadline-label">Deadline</div>
          <div className={`deadline-value ${deadlinePassed ? 'passed' : ''}`}>
            {deadlinePassed ? '🔒 Locked' : formatDeadline(todayInfo.deadline)}
          </div>
        </div>
      </div>

      {/* Not paid warning */}
      {!participant?.is_paid && (
        <div className="warning-card">
          <span>⚠️</span>
          <div>
            <strong>Payment not confirmed</strong>
            <p>Your picks won't count until Adam confirms your $25 Venmo payment to <strong>@adam-furtado</strong>.</p>
          </div>
        </div>
      )}

      {/* Pick counter + save */}
      {!deadlinePassed ? (
        <div className="picks-action-bar">
          <div className="pick-counter">
            {picksSelected === picksRequired ? (
              <span className="counter-ready">✅ {picksSelected}/{picksRequired} selected — ready to save</span>
            ) : (
              <span className="counter-pending">Select {picksRemaining} more team{picksRemaining !== 1 ? 's' : ''} ({picksSelected}/{picksRequired})</span>
            )}
          </div>
          <button
            className="btn-save"
            onClick={handleSave}
            disabled={saving || picksSelected !== picksRequired}
          >
            {saving ? 'Saving...' : 'Save Picks'}
          </button>
        </div>
      ) : (
        <div className="picks-locked-banner">
          🔒 Picks are locked for this day.
          {selectedTeamIds.length > 0
            ? ` You submitted ${selectedTeamIds.length} pick${selectedTeamIds.length !== 1 ? 's' : ''}.`
            : ' No picks were submitted — Adam will assign your pick automatically.'
          }
        </div>
      )}

      {/* Save message */}
      {saveMsg && (
        <div className={`save-msg ${saveMsg.type}`}>
          {saveMsg.text}
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        className="team-search"
        placeholder="Search teams or regions..."
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
      />

      {/* Teams by region */}
      {regions.map(region => {
        const regionTeams = filteredTeams.filter(t => t.region === region)
        if (regionTeams.length === 0) return null

        return (
          <div key={region} className="region-section">
            <div className="region-title">{region}</div>
            <div className="team-grid">
              {regionTeams.map(team => {
                const isSelected = selectedTeamIds.includes(team.id)
                const isPreviouslyPicked = previouslyPickedTeamIds.has(team.id)
                const isSavedToday = todaysSavedPickTeamIds.has(team.id)

                return (
                  <button
                    key={team.id}
                    className={`team-btn 
                      ${isSelected ? 'selected' : ''} 
                      ${isPreviouslyPicked ? 'used' : ''} 
                      ${deadlinePassed ? 'locked' : ''}
                    `}
                    onClick={() => toggleTeam(team.id)}
                    disabled={isPreviouslyPicked || deadlinePassed}
                    title={isPreviouslyPicked ? 'You already picked this team in a previous round' : ''}
                  >
                    <span className="team-seed">#{team.seed}</span>
                    <span className="team-name">{team.name}</span>
                    {isSelected && <span className="team-check">✓</span>}
                    {isPreviouslyPicked && <span className="team-used">used</span>}
                    {isSavedToday && !isSelected && <span className="team-removed">removed</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
