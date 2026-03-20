import React, { useEffect, useState, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
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
}

interface ExistingPick {
  id: number
  team_id: number
  game_date: string
}

interface Game {
  id: number
  game_date: string
  team1_id: number | null
  team2_id: number | null
}

const R64_PODS: [number, number][] = [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]]
const REGIONS = ['East', 'West', 'South', 'Midwest']
const TH = 34
const TG = 2

// Redemption Island starts from Round of 32 (after Rd of 64 is over)
// Only show days from Mar 21 onward
const REDEMPTION_START_DATE = '2026-03-21'

function isDayUnlocked(days: TournamentDay[], index: number): boolean {
  if (index === 0) return true
  return new Date() >= new Date(days[index - 1].deadline)
}

export default function RedemptionPicksPage() {
  const { redemptionParticipant, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [bracketOpen, setBracketOpen]     = useState(false)
  const [teams, setTeams]                 = useState<Team[]>([])
  const [games, setGames]                 = useState<Game[]>([])
  const [allDays, setAllDays]             = useState<TournamentDay[]>([])
  const [selectedDay, setSelectedDay]     = useState<TournamentDay | null>(null)
  const [existingPicks, setExistingPicks] = useState<ExistingPick[]>([])
  const [selectedIds, setSelectedIds]     = useState<number[]>([])
  const [savedIds, setSavedIds]           = useState<number[]>([])
  const [loading, setLoading]             = useState(true)
  const [saving, setSaving]               = useState(false)
  const [msg, setMsg]                     = useState<{type:'success'|'error', text:string}|null>(null)

  const fetchDataRef = useRef(fetchData)

  useEffect(() => {
    if (authLoading) return
    if (!redemptionParticipant) {
      // Not registered for Redemption Island — redirect to dashboard
      navigate('/dashboard', { replace: true })
      return
    }
    fetchData()
    // eslint-disable-next-line
  }, [redemptionParticipant, authLoading])

  useEffect(() => { fetchDataRef.current = fetchData })

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchDataRef.current()
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) fetchDataRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onPageShow)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchData() {
    if (!redemptionParticipant) return
    await supabase.auth.getSession()
    setLoading(true)
    const giveUp = setTimeout(() => setLoading(false), 8000)
    try {
      const [
        { data: daysData },
        { data: teamsData },
        { data: picksData },
        { data: gamesData },
      ] = await Promise.all([
        supabase.from('tournament_days')
          .select('id,game_date,round_name,picks_required,deadline')
          .gte('game_date', REDEMPTION_START_DATE)  // Only post-Rd64 days
          .order('game_date'),
        supabase.from('teams').select('id,name,seed,region,is_eliminated').order('seed'),
        supabase.from('picks').select('id,team_id,game_date').eq('participant_id', redemptionParticipant.id),
        supabase.from('games').select('id,game_date,team1_id,team2_id'),
      ])

      const days  = daysData  || []
      const picks = picksData || []

      // Redemption Island: always 1 pick per day (Rd of 64 is over)
      const normalizedDays = days.map(d => ({ ...d, picks_required: 1 }))

      setAllDays(normalizedDays)
      setTeams(teamsData || [])
      setExistingPicks(picks)
      setGames(gamesData || [])

      const today = new Date().toISOString().split('T')[0]
      let defaultDay: TournamentDay | null = null
      for (let i = 0; i < normalizedDays.length; i++) {
        if (isDayUnlocked(normalizedDays, i) && normalizedDays[i].game_date >= today) {
          defaultDay = normalizedDays[i]; break
        }
      }
      if (!defaultDay) {
        for (let i = normalizedDays.length - 1; i >= 0; i--) {
          if (isDayUnlocked(normalizedDays, i)) { defaultDay = normalizedDays[i]; break }
        }
      }
      if (defaultDay) applyDay(defaultDay, picks)
    } catch(e) { console.error(e) }
    finally { clearTimeout(giveUp); setLoading(false) }
  }

  function applyDay(day: TournamentDay, picks: ExistingPick[]) {
    setSelectedDay(day)
    const dayPicks = picks.filter(p => p.game_date === day.game_date)
    setSelectedIds(dayPicks.map(p => p.team_id))
    setSavedIds(dayPicks.map(p => p.team_id))
    setMsg(null)
  }

  function handleDaySelect(day: TournamentDay) {
    applyDay(day, existingPicks)
  }

  const dayGames = games.filter(g => selectedDay && g.game_date === selectedDay.game_date)
  const availableTeamIds: Set<number> | null = dayGames.length > 0
    ? new Set(dayGames.flatMap(g => [g.team1_id, g.team2_id].filter((id): id is number => id !== null)))
    : null

  const deadlinePassed = selectedDay ? new Date() > new Date(selectedDay.deadline) : false
  const usedIds = new Set(
    existingPicks.filter(p => selectedDay && p.game_date !== selectedDay.game_date).map(p => p.team_id)
  )
  const picksRequired = 1  // always 1 in Redemption Island
  const selectionChanged = !(
    selectedIds.length === savedIds.length && selectedIds.every(id => savedIds.includes(id))
  )

  function toggleTeam(teamId: number) {
    if (!selectedDay || deadlinePassed) return
    if (selectedIds.includes(teamId)) {
      setSelectedIds(prev => prev.filter(id => id !== teamId))
    } else {
      if (selectedIds.length >= picksRequired) {
        setMsg({ type:'error', text:'Deselect your current pick first.' })
        setTimeout(() => setMsg(null), 3000)
        return
      }
      setSelectedIds(prev => [...prev, teamId])
    }
  }

  async function handleSave() {
    if (!selectedDay || !redemptionParticipant) return
    if (selectedIds.length !== picksRequired) {
      setMsg({ type:'error', text:'Select exactly 1 team.' })
      return
    }
    setSaving(true); setMsg(null)
    try {
      await supabase.from('picks').delete()
        .eq('participant_id', redemptionParticipant.id)
        .eq('game_date', selectedDay.game_date)
      const { error } = await supabase.from('picks').insert(
        selectedIds.map(tid => ({
          participant_id: redemptionParticipant.id,
          team_id: tid,
          game_date: selectedDay.game_date,
          result: 'pending',
        }))
      )
      if (error) {
        console.error('picks insert error:', error)
        setMsg({ type:'error', text:'Save failed. Please try again.' })
      } else {
        setSavedIds([...selectedIds])
        setMsg({ type:'success', text:'✅ Pick saved! You can update it before the deadline.' })
        const { data: fresh } = await supabase
          .from('picks').select('id,team_id,game_date').eq('participant_id', redemptionParticipant.id)
        setExistingPicks(fresh || [])
      }
    } catch (e) {
      console.error('handleSave exception:', e)
      setMsg({ type:'error', text:'Save failed. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const byRegionSeed: Record<string, Record<number, Team>> = {}
  teams.forEach(t => {
    if (!byRegionSeed[t.region]) byRegionSeed[t.region] = {}
    byRegionSeed[t.region][t.seed] = t
  })

  function TeamSlot({ team }: { team: Team | null }) {
    if (!team) return (
      <div className="b-slot b-slot-tbd" style={{ height: TH }}>
        <span className="b-seed">?</span><span className="b-name">TBD</span>
      </div>
    )

    const isSelected     = selectedIds.includes(team.id)
    const isUsed         = usedIds.has(team.id)
    const isOut          = team.is_eliminated
    const isPlayingToday = availableTeamIds === null || availableTeamIds.has(team.id)
    const canClick       = !deadlinePassed && !isUsed && !isOut && isPlayingToday

    return (
      <button
        className={[
          'b-slot',
          isSelected      ? 'b-selected'  : '',
          isOut           ? 'b-out'        : '',
          isUsed          ? 'b-used'       : '',
          !isPlayingToday ? 'b-not-today'  : '',
          !canClick       ? 'b-no-click'   : '',
        ].filter(Boolean).join(' ')}
        onClick={() => canClick && toggleTeam(team.id)}
        disabled={!canClick}
        style={{ height: TH }}
      >
        <span className="b-seed">{team.seed}</span>
        <span className="b-name">{team.name}</span>
        {isSelected && <span className="b-badge b-check">✓</span>}
        {isUsed && !isSelected && <span className="b-badge b-used-tag">used</span>}
        {isOut && !isUsed && <span className="b-badge b-out-tag">✕</span>}
      </button>
    )
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (!redemptionParticipant) return null  // redirect in progress via useEffect

  if (allDays.length === 0) return (
    <div className="picks-page">
      <div className="no-games-card">
        <div style={{fontSize:'48px',marginBottom:'16px'}}>🏝️</div>
        <h2>Redemption Island hasn't started yet</h2>
        <p>Picks open starting Round of 32 (Mar 21).</p>
      </div>
    </div>
  )

  if (redemptionParticipant?.is_eliminated) return (
    <div className="picks-page">
      <div className="no-games-card">
        <div style={{fontSize:'48px',marginBottom:'16px'}}>💀</div>
        <h2>Eliminated from Redemption Island</h2>
        <p>Your run is over. Thanks for playing!</p>
      </div>
    </div>
  )

  return (
    <div className="picks-page">

      {/* Header */}
      <div className="picks-header">
        <div>
          <h1 className="picks-page-title">🏝️ Redemption Island Picks</h1>
          {selectedDay && <div className="picks-round">{selectedDay.round_name}</div>}
          <div className="bracket-links-row">
            <a
              href="https://www.espn.com/mens-college-basketball/tournament/bracket"
              target="_blank"
              rel="noopener noreferrer"
              className="bracket-ext-link"
            >
              📋 View on ESPN ↗
            </a>
            <button className="bracket-lightbox-btn" onClick={() => setBracketOpen(true)}>
              🔍 View Bracket Here
            </button>
          </div>
        </div>
        {selectedDay && (
          <div className="picks-deadline-box">
            <div className="deadline-label">Deadline</div>
            <div className={`deadline-value ${deadlinePassed ? 'passed' : ''}`}>
              {deadlinePassed
                ? '🔒 Locked'
                : new Date(selectedDay.deadline).toLocaleString('en-US', {
                    weekday:'short', month:'short', day:'numeric',
                    hour:'numeric', minute:'2-digit', timeZoneName:'short',
                  })}
            </div>
          </div>
        )}
      </div>

      {/* Day selector */}
      <div className="day-selector">
        {allDays.map((day, i) => {
          const unlocked = isDayUnlocked(allDays, i)
          const isActive = selectedDay?.game_date === day.game_date
          const hasPicks = existingPicks.some(p => p.game_date === day.game_date)
          const isPast   = new Date() > new Date(day.deadline)
          const isDuplicate = allDays.filter(d => d.round_name === day.round_name).length > 1
          const weekday = isDuplicate
            ? new Date(day.game_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
            : null
          const pillLabel = weekday ? `${day.round_name} · ${weekday}` : day.round_name
          return (
            <button
              key={day.game_date}
              className={[
                'day-pill',
                isActive  ? 'day-pill-active' : '',
                !unlocked ? 'day-pill-locked' : '',
                isPast && !isActive ? 'day-pill-past' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => unlocked && handleDaySelect(day)}
              disabled={!unlocked}
              title={unlocked ? day.round_name : "Unlocks after the previous day's games close"}
            >
              <span className="day-pill-name">{pillLabel}</span>
              {hasPicks && unlocked && <span className="day-pill-dot" title="Pick submitted" />}
              {!unlocked && <span className="day-pill-lock">🔒</span>}
            </button>
          )
        })}
      </div>

      {/* Unpaid warning — does NOT block pick submission */}
      {!redemptionParticipant.is_paid && (
        <div className="warning-card">
          <span>⚠️</span>
          <div>
            <strong>Payment not confirmed</strong>
            <p>Your picks are accepted, but won't count until Adam confirms your Venmo to <strong>@adam-furtado</strong>.</p>
          </div>
        </div>
      )}

      {/* Action bar */}
      {!deadlinePassed && selectionChanged && (
        <div className="picks-action-bar">
          <span className={`pick-counter ${selectedIds.length === picksRequired ? 'counter-ready' : 'counter-pending'}`}>
            {selectedIds.length === picksRequired
              ? '✅ 1/1 selected'
              : '0/1 — pick 1 team'}
          </span>
          <button
            className="btn-save"
            onClick={handleSave}
            disabled={saving || selectedIds.length !== picksRequired}
          >
            {saving ? 'Saving…' : 'Save Pick'}
          </button>
        </div>
      )}
      {!deadlinePassed && !selectionChanged && savedIds.length === picksRequired && (
        <div className="picks-saved-banner">✅ Pick saved! Deselect to make a change.</div>
      )}
      {deadlinePassed && (
        <div className="picks-locked-banner">
          🔒 Picks locked.{' '}
          {savedIds.length > 0 ? 'Pick submitted.' : 'No pick submitted — Adam will assign one automatically.'}
        </div>
      )}
      {msg && <div className={`save-msg ${msg.type}`}>{msg.text}</div>}

      {/* Legend */}
      <div className="bracket-legend">
        <span className="legend-item legend-item-bright"><span className="legend-dot dot-alive" />Playing today</span>
        <span className="legend-item"><span className="legend-dot dot-selected" />Your pick</span>
        <span className="legend-item"><span className="legend-dot dot-used" />Already used</span>
        <span className="legend-item"><span className="legend-dot dot-out" />Eliminated</span>
        {availableTeamIds !== null && (
          <span className="legend-item"><span className="legend-dot dot-not-today" />Not today</span>
        )}
      </div>

      {/* 4 regions bracket */}
      <div className="regions-grid">
        {REGIONS.map(region => (
          <div key={region} className="region-section">
            <div className="region-section-header">{region}</div>
            {R64_PODS.map(([seed1, seed2]) => {
              const team1 = byRegionSeed[region]?.[seed1] || null
              const team2 = byRegionSeed[region]?.[seed2] || null
              return (
                <div key={seed1} className="b-matchup">
                  <TeamSlot team={team1} />
                  <div className="b-gap" style={{ height: TG }} />
                  <TeamSlot team={team2} />
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Bracket lightbox */}
      {bracketOpen && (
        <div className="bracket-overlay" onClick={() => setBracketOpen(false)}>
          <div className="bracket-modal" onClick={e => e.stopPropagation()}>
            <div className="bracket-modal-header">
              <span className="bracket-modal-title">📋 Official Bracket</span>
              <button className="bracket-modal-close" onClick={() => setBracketOpen(false)}>✕</button>
            </div>
            <div className="bracket-modal-body">
              <img
                src="https://www.ncaa.com/sites/default/files/public/styles/original/public-s3/images/2025/03/16/2025-NCAA-tournament-bracket.png"
                alt="NCAA Tournament Bracket"
                className="bracket-modal-img"
              />
            </div>
            <div className="bracket-modal-footer">
              <a
                href="https://www.espn.com/mens-college-basketball/tournament/bracket"
                target="_blank"
                rel="noopener noreferrer"
                className="bracket-modal-espn"
              >
                Open full bracket on ESPN ↗
              </a>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
