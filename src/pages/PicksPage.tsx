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

// Standard NCAA bracket — seed pairings per region, in bracket order (top to bottom)
const R64_PODS: [number,number][] = [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]]

const R32_GROUPS = [
  {top:[1,16],   bottom:[8,9]  }, {top:[5,12],  bottom:[4,13]  },
  {top:[6,11],   bottom:[3,14] }, {top:[7,10],  bottom:[2,15]  },
]
const S16_GROUPS = [
  {top:[1,16,8,9], bottom:[5,12,4,13]  },
  {top:[6,11,3,14],bottom:[7,10,2,15]  },
]
const E8_GROUPS = [
  {top:[1,16,8,9,5,12,4,13], bottom:[6,11,3,14,7,10,2,15]},
]

const REGIONS = ['East','West','South','Midwest']

// Bracket layout constants
const TH   = 34    // team slot height (px)
const TG   = 2     // gap between two teams in same matchup
const MH   = TH*2 + TG   // matchup height = 70
const MG   = 12            // gap between matchups
const UNIT = MH + MG       // 82

const SPACERS = [
  { top: MG/2,          between: MG          }, // R64
  { top: UNIT/2-MH/2,   between: UNIT-MH     }, // R32
  { top: UNIT-MH/2,     between: UNIT*2-MH   }, // S16
  { top: UNIT*2-MH/2,   between: 0           }, // E8
]

// First two days (Rd of 64 Thu + Fri) are always unlocked.
// Each subsequent day unlocks after the previous day's deadline passes.
function isDayUnlocked(days: TournamentDay[], index: number): boolean {
  if (index <= 1) return true
  return new Date() >= new Date(days[index - 1].deadline)
}

export default function PicksPage() {
  const { participant, loading: authLoading } = useAuth()
  const [teams, setTeams]                   = useState<Team[]>([])
  const [games, setGames]                   = useState<Game[]>([])
  const [allDays, setAllDays]               = useState<TournamentDay[]>([])
  const [selectedDay, setSelectedDay]       = useState<TournamentDay | null>(null)
  const [existingPicks, setExistingPicks]   = useState<ExistingPick[]>([])
  const [selectedIds, setSelectedIds]       = useState<number[]>([])
  const [savedIds, setSavedIds]             = useState<number[]>([])
  const [loading, setLoading]               = useState(true)
  const [saving, setSaving]                 = useState(false)
  const [msg, setMsg]                       = useState<{type:'success'|'error', text:string}|null>(null)
  const [activeRegion, setActiveRegion]     = useState(REGIONS[0])

  useEffect(() => {
    if (authLoading) return
    if (!participant) { setLoading(false); return }
    fetchData()
    // eslint-disable-next-line
  }, [participant, authLoading])

  async function fetchData() {
    setLoading(true)
    const giveUp = setTimeout(() => setLoading(false), 8000)
    try {
      const [
        { data: daysData },
        { data: teamsData },
        { data: picksData },
        { data: gamesData },
      ] = await Promise.all([
        supabase.from('tournament_days').select('id,game_date,round_name,picks_required,deadline').order('game_date'),
        supabase.from('teams').select('id,name,seed,region,is_eliminated').order('seed'),
        supabase.from('picks').select('id,team_id,game_date').eq('participant_id', participant!.id),
        supabase.from('games').select('id,game_date,team1_id,team2_id'),
      ])

      const days  = daysData  || []
      const picks = picksData || []
      setAllDays(days)
      setTeams(teamsData || [])
      setExistingPicks(picks)
      setGames(gamesData || [])

      // Default to the first unlocked day on or after today, else the last unlocked day
      const today = new Date().toISOString().split('T')[0]
      let defaultDay: TournamentDay | null = null
      for (let i = 0; i < days.length; i++) {
        if (isDayUnlocked(days, i) && days[i].game_date >= today) {
          defaultDay = days[i]; break
        }
      }
      if (!defaultDay) {
        for (let i = days.length - 1; i >= 0; i--) {
          if (isDayUnlocked(days, i)) { defaultDay = days[i]; break }
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

  // Teams playing today — null means no game data yet (show all as available)
  const dayGames = games.filter(g => selectedDay && g.game_date === selectedDay.game_date)
  const availableTeamIds: Set<number> | null = dayGames.length > 0
    ? new Set(dayGames.flatMap(g =>
        [g.team1_id, g.team2_id].filter((id): id is number => id !== null)
      ))
    : null

  const deadlinePassed = selectedDay ? new Date() > new Date(selectedDay.deadline) : false
  // "used" = picked on any OTHER day — can't be re-used
  const usedIds = new Set(
    existingPicks.filter(p => selectedDay && p.game_date !== selectedDay.game_date).map(p => p.team_id)
  )
  const picksRequired = selectedDay?.picks_required ?? 1
  const selectionChanged = !(
    selectedIds.length === savedIds.length && selectedIds.every(id => savedIds.includes(id))
  )

  function toggleTeam(teamId: number) {
    if (!selectedDay || deadlinePassed) return
    if (selectedIds.includes(teamId)) {
      setSelectedIds(prev => prev.filter(id => id !== teamId))
    } else {
      if (selectedIds.length >= picksRequired) {
        setMsg({ type:'error', text:`Max ${picksRequired} pick${picksRequired > 1 ? 's' : ''} — deselect one first.` })
        setTimeout(() => setMsg(null), 3000)
        return
      }
      setSelectedIds(prev => [...prev, teamId])
    }
  }

  async function handleSave() {
    if (!selectedDay || !participant) return
    if (selectedIds.length !== picksRequired) {
      setMsg({ type:'error', text:`Select exactly ${picksRequired} team${picksRequired > 1 ? 's' : ''}.` })
      return
    }
    setSaving(true); setMsg(null)
    await supabase.from('picks').delete().eq('participant_id', participant.id).eq('game_date', selectedDay.game_date)
    const { error } = await supabase.from('picks').insert(
      selectedIds.map(tid => ({
        participant_id: participant.id, team_id: tid,
        game_date: selectedDay.game_date, result: 'pending',
      }))
    )
    if (error) {
      setMsg({ type:'error', text:'Save failed. Please try again.' })
    } else {
      setSavedIds([...selectedIds])
      setMsg({ type:'success', text:'✅ Picks saved! You can update them before the deadline.' })
      const { data: fresh } = await supabase
        .from('picks').select('id,team_id,game_date').eq('participant_id', participant.id)
      setExistingPicks(fresh || [])
    }
    setSaving(false)
  }

  // Build region → seed → team lookup
  const byRegionSeed: Record<string, Record<number, Team>> = {}
  teams.forEach(t => {
    if (!byRegionSeed[t.region]) byRegionSeed[t.region] = {}
    byRegionSeed[t.region][t.seed] = t
  })

  function getWinner(seeds: number[], region: string): Team | null {
    const rt = byRegionSeed[region] || {}
    return seeds.map(s => rt[s]).find(t => t && !t.is_eliminated) || null
  }

  // ── Team slot button ──────────────────────────────────────────────────────
  function TeamSlot({ team, dimmed }: { team: Team | null; dimmed?: boolean }) {
    if (!team) {
      return (
        <div className="b-slot b-slot-tbd" style={{ height: TH }}>
          <span className="b-seed">?</span><span className="b-name">TBD</span>
        </div>
      )
    }
    const isSelected     = selectedIds.includes(team.id)
    const isUsed         = usedIds.has(team.id)
    const isOut          = team.is_eliminated
    const isPlayingToday = availableTeamIds === null || availableTeamIds.has(team.id)
    const canClick       = !deadlinePassed && !isUsed && !isOut && isPlayingToday

    return (
      <button
        className={[
          'b-slot',
          isSelected      ? 'b-selected'   : '',
          isOut           ? 'b-out'         : '',
          isUsed          ? 'b-used'        : '',
          !isPlayingToday ? 'b-not-today'   : '',
          dimmed          ? 'b-dimmed'      : '',
          !canClick       ? 'b-no-click'    : '',
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

  // ── Single matchup ────────────────────────────────────────────────────────
  function Matchup({ grp, ri, region }: {
    grp: { top: number[]; bottom: number[] }
    ri: number
    region: string
  }) {
    const topTeam    = ri === 0
      ? (byRegionSeed[region]?.[grp.top[0]]    || null)
      : getWinner(grp.top, region)
    const bottomTeam = ri === 0
      ? (byRegionSeed[region]?.[grp.bottom[0]] || null)
      : getWinner(grp.bottom, region)

    return (
      <div className={`b-matchup${ri < 3 ? ' b-matchup-has-line' : ''}`} style={{ height: MH }}>
        <TeamSlot team={topTeam}    dimmed={ri > 0 && !topTeam} />
        <div className="b-gap" style={{ height: TG }} />
        <TeamSlot team={bottomTeam} dimmed={ri > 0 && !bottomTeam} />
      </div>
    )
  }

  // ── Full region bracket ───────────────────────────────────────────────────
  function BracketRegion({ region }: { region: string }) {
    const rounds = [
      { label:'R64', groups: R64_PODS.map(([a,b]) => ({ top:[a], bottom:[b] })) },
      { label:'R32', groups: R32_GROUPS },
      { label:'S16', groups: S16_GROUPS },
      { label:'E8',  groups: E8_GROUPS  },
    ]

    return (
      <div className="bracket-region">
        <div className="bracket-round-labels">
          {rounds.map(r => <div key={r.label} className="bracket-round-label">{r.label}</div>)}
        </div>
        <div className="bracket-columns">
          {rounds.map((round, ri) => {
            const sp     = SPACERS[ri]
            const groups = round.groups

            // E8 has 1 group — no pairing needed
            if (groups.length === 1) {
              return (
                <div key={round.label} className="bracket-col">
                  <div style={{ marginTop: sp.top }}>
                    <Matchup grp={groups[0]} ri={ri} region={region} />
                  </div>
                </div>
              )
            }

            // All other rounds: render adjacent groups as pairs so we can draw
            // a vertical connector line between the two matchups that feed the
            // same next-round slot.
            const pairs: React.ReactNode[] = []
            for (let pi = 0; pi * 2 < groups.length; pi++) {
              const gi   = pi * 2
              const grp1 = groups[gi]
              const grp2 = groups[gi + 1]
              pairs.push(
                <div
                  key={gi}
                  className="b-pair"
                  style={{ marginTop: pi === 0 ? sp.top : sp.between }}
                >
                  <Matchup grp={grp1} ri={ri} region={region} />
                  {grp2 && (
                    <>
                      <div style={{ height: MG }} />
                      <Matchup grp={grp2} ri={ri} region={region} />
                    </>
                  )}
                </div>
              )
            }

            return (
              <div key={round.label} className="bracket-col">
                {pairs}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

  if (allDays.length === 0) return (
    <div className="picks-page">
      <div className="no-games-card">
        <div style={{fontSize:'48px',marginBottom:'16px'}}>🏆</div>
        <h2>No upcoming games</h2>
        <p>Check back when the tournament schedule is posted.</p>
      </div>
    </div>
  )

  return (
    <div className="picks-page">

      {/* Header */}
      <div className="picks-header">
        <div>
          <h1 className="picks-page-title">My Picks</h1>
          {selectedDay && <div className="picks-round">{selectedDay.round_name}</div>}
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
          return (
            <button
              key={day.game_date}
              className={[
                'day-pill',
                isActive   ? 'day-pill-active' : '',
                !unlocked  ? 'day-pill-locked' : '',
                isPast && !isActive ? 'day-pill-past' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => unlocked && handleDaySelect(day)}
              disabled={!unlocked}
              title={unlocked ? day.round_name : "Unlocks after the previous day's games close"}
            >
              <span className="day-pill-name">{day.round_name}</span>
              {hasPicks && unlocked && <span className="day-pill-dot" title="Picks submitted" />}
              {!unlocked && <span className="day-pill-lock">🔒</span>}
            </button>
          )
        })}
      </div>

      {!participant?.is_paid && (
        <div className="warning-card">
          <span>⚠️</span>
          <div>
            <strong>Payment not confirmed</strong>
            <p>Your picks won't count until Adam confirms your $25 Venmo to <strong>@adam-furtado</strong>.</p>
          </div>
        </div>
      )}

      {/* Action bar */}
      {!deadlinePassed && selectionChanged && (
        <div className="picks-action-bar">
          <span className={`pick-counter ${selectedIds.length === picksRequired ? 'counter-ready' : 'counter-pending'}`}>
            {selectedIds.length === picksRequired
              ? `✅ ${selectedIds.length}/${picksRequired} selected`
              : `${selectedIds.length}/${picksRequired} — pick ${picksRequired - selectedIds.length} more`}
          </span>
          <button
            className="btn-save"
            onClick={handleSave}
            disabled={saving || selectedIds.length !== picksRequired}
          >
            {saving ? 'Saving…' : 'Save Picks'}
          </button>
        </div>
      )}
      {!deadlinePassed && !selectionChanged && savedIds.length === picksRequired && (
        <div className="picks-saved-banner">✅ Picks saved! Deselect a team to make a change.</div>
      )}
      {deadlinePassed && (
        <div className="picks-locked-banner">
          🔒 Picks locked.{' '}
          {savedIds.length > 0
            ? `You submitted ${savedIds.length} pick${savedIds.length > 1 ? 's' : ''}.`
            : 'No picks submitted — Adam will assign your pick automatically.'}
        </div>
      )}
      {msg && <div className={`save-msg ${msg.type}`}>{msg.text}</div>}

      {/* Legend */}
      <div className="bracket-legend">
        <span className="legend-item"><span className="legend-dot dot-alive" />Playing today</span>
        <span className="legend-item"><span className="legend-dot dot-selected" />Your pick</span>
        <span className="legend-item"><span className="legend-dot dot-used" />Already used</span>
        <span className="legend-item"><span className="legend-dot dot-out" />Eliminated</span>
        {availableTeamIds !== null && (
          <span className="legend-item"><span className="legend-dot dot-not-today" />Not today</span>
        )}
      </div>

      {/* Region tabs */}
      <div className="region-tabs">
        {REGIONS.map(r => (
          <button
            key={r}
            className={`region-tab ${activeRegion === r ? 'active' : ''}`}
            onClick={() => setActiveRegion(r)}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Bracket */}
      <div className="bracket-wrap">
        <BracketRegion region={activeRegion} />
      </div>

    </div>
  )
}
