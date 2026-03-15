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

// Standard NCAA bracket — seed pairings per region, in bracket order (top to bottom)
const R64_PODS: [number,number][] = [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]]

// For each later round, which seed groups feed the top and bottom of each matchup
const R32_GROUPS  = [
  {top:[1,16],   bottom:[8,9]  }, {top:[5,12],  bottom:[4,13]  },
  {top:[6,11],   bottom:[3,14] }, {top:[7,10],  bottom:[2,15]  },
]
const S16_GROUPS  = [
  {top:[1,16,8,9], bottom:[5,12,4,13]  },
  {top:[6,11,3,14],bottom:[7,10,2,15]  },
]
const E8_GROUPS   = [
  {top:[1,16,8,9,5,12,4,13], bottom:[6,11,3,14,7,10,2,15]},
]

const REGIONS = ['East','West','South','Midwest']

// Bracket layout constants
const TH  = 34   // team slot height (px)
const TG  = 2    // gap between two teams in same matchup
const MH  = TH*2 + TG       // matchup height = 70
const MG  = 12              // gap between adjacent R64 matchups
const UNIT = MH + MG        // = 82

// Spacers (top pad before first matchup, gap between matchups per round)
const SPACERS = [
  { top: MG/2,          between: MG          }, // R64
  { top: UNIT/2-MH/2,   between: UNIT-MH     }, // R32
  { top: UNIT-MH/2,     between: UNIT*2-MH   }, // S16
  { top: UNIT*2-MH/2,   between: 0           }, // E8
]

export default function PicksPage() {
  const { participant } = useAuth()
  const [teams, setTeams]               = useState<Team[]>([])
  const [todayInfo, setTodayInfo]       = useState<TournamentDay | null>(null)
  const [existingPicks, setExistingPicks] = useState<ExistingPick[]>([])
  const [selectedIds, setSelectedIds]   = useState<number[]>([])
  const [savedIds, setSavedIds]         = useState<number[]>([])
  const [loading, setLoading]           = useState(true)
  const [saving, setSaving]             = useState(false)
  const [msg, setMsg] = useState<{type:'success'|'error', text:string}|null>(null)
  const [activeRegion, setActiveRegion] = useState(REGIONS[0])

  useEffect(() => {
    if (!participant) return
    fetchData()
    // eslint-disable-next-line
  }, [participant])

  async function fetchData() {
    setLoading(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      const { data: dayData } = await supabase
        .from('tournament_days')
        .select('id, game_date, round_name, picks_required, deadline')
        .gte('game_date', today).order('game_date').limit(1)

      if (!dayData?.length) { setLoading(false); return }
      const day = dayData[0]
      setTodayInfo(day)

      const [{ data: teamsData }, { data: picksData }] = await Promise.all([
        supabase.from('teams').select('id,name,seed,region,is_eliminated').order('seed'),
        supabase.from('picks').select('id,team_id,game_date').eq('participant_id', participant!.id),
      ])

      setTeams(teamsData || [])
      setExistingPicks(picksData || [])
      const todayPicks = (picksData || []).filter(p => p.game_date === day.game_date)
      setSelectedIds(todayPicks.map(p => p.team_id))
      setSavedIds(todayPicks.map(p => p.team_id))
    } catch(e) { console.error(e) }
    finally { setLoading(false) }
  }

  const deadlinePassed = todayInfo ? new Date() > new Date(todayInfo.deadline) : false
  const usedIds = new Set(existingPicks.filter(p => todayInfo && p.game_date !== todayInfo.game_date).map(p => p.team_id))
  const selectionChanged = !(selectedIds.length === savedIds.length && selectedIds.every(id => savedIds.includes(id)))

  function toggleTeam(teamId: number) {
    if (!todayInfo || deadlinePassed) return
    if (selectedIds.includes(teamId)) {
      setSelectedIds(p => p.filter(id => id !== teamId))
    } else {
      if (selectedIds.length >= todayInfo.picks_required) {
        setMsg({ type:'error', text:`Max ${todayInfo.picks_required} pick${todayInfo.picks_required>1?'s':''} — deselect one first.` })
        setTimeout(() => setMsg(null), 3000)
        return
      }
      setSelectedIds(p => [...p, teamId])
    }
  }

  async function handleSave() {
    if (!todayInfo || !participant) return
    if (selectedIds.length !== todayInfo.picks_required) {
      setMsg({ type:'error', text:`Select exactly ${todayInfo.picks_required} team${todayInfo.picks_required>1?'s':''}.` })
      return
    }
    setSaving(true); setMsg(null)
    await supabase.from('picks').delete().eq('participant_id', participant.id).eq('game_date', todayInfo.game_date)
    const { error } = await supabase.from('picks').insert(
      selectedIds.map(tid => ({ participant_id: participant.id, team_id: tid, game_date: todayInfo.game_date, result:'pending' }))
    )
    if (error) {
      setMsg({ type:'error', text:'Save failed. Please try again.' })
    } else {
      setSavedIds([...selectedIds])
      setMsg({ type:'success', text:'✅ Picks saved! You can update them before the deadline.' })
      await fetchData()
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

  function TeamSlot({ team, dimmed }: { team: Team | null; dimmed?: boolean }) {
    if (!team) {
      return <div className="b-slot b-slot-tbd"><span className="b-seed">?</span><span className="b-name">TBD</span></div>
    }
    const isSelected = selectedIds.includes(team.id)
    const isUsed     = usedIds.has(team.id)
    const isOut      = team.is_eliminated
    const canClick   = !deadlinePassed && !isUsed && !isOut

    return (
      <button
        className={[
          'b-slot',
          isSelected  ? 'b-selected'  : '',
          isOut       ? 'b-out'        : '',
          isUsed      ? 'b-used'       : '',
          dimmed      ? 'b-dimmed'     : '',
          !canClick   ? 'b-no-click'  : '',
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
            const sp = SPACERS[ri]
            return (
              <div key={round.label} className="bracket-col">
                {round.groups.map((grp, gi) => {
                  const topTeam    = ri === 0
                    ? (byRegionSeed[region]?.[grp.top[0]]    || null)
                    : getWinner(grp.top,    region)
                  const bottomTeam = ri === 0
                    ? (byRegionSeed[region]?.[grp.bottom[0]] || null)
                    : getWinner(grp.bottom, region)

                  return (
                    <React.Fragment key={gi}>
                      {/* Top spacer before first, between-matchup gap after */}
                      <div style={{ height: gi === 0 ? sp.top : sp.between }} />
                      <div className={`b-matchup ${ri < 3 ? 'b-matchup-has-line' : ''}`} style={{ height: MH }}>
                        <TeamSlot team={topTeam}    dimmed={ri > 0 && !topTeam} />
                        <div className="b-gap" style={{ height: TG }} />
                        <TeamSlot team={bottomTeam} dimmed={ri > 0 && !bottomTeam} />
                      </div>
                    </React.Fragment>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

  if (!todayInfo) return (
    <div className="picks-page">
      <div className="no-games-card">
        <div style={{fontSize:'48px',marginBottom:'16px'}}>🏆</div>
        <h2>No upcoming games</h2>
        <p>Check back when the tournament schedule is posted.</p>
      </div>
    </div>
  )

  const picksRequired = todayInfo.picks_required

  return (
    <div className="picks-page">
      <div className="picks-header">
        <div>
          <h1 className="picks-page-title">My Picks</h1>
          <div className="picks-round">{todayInfo.round_name}</div>
        </div>
        <div className="picks-deadline-box">
          <div className="deadline-label">Deadline</div>
          <div className={`deadline-value ${deadlinePassed ? 'passed' : ''}`}>
            {deadlinePassed ? '🔒 Locked' : new Date(todayInfo.deadline).toLocaleString('en-US', {
              weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'
            })}
          </div>
        </div>
      </div>

      {!participant?.is_paid && (
        <div className="warning-card">
          <span>⚠️</span>
          <div><strong>Payment not confirmed</strong>
            <p>Your picks won't count until Adam confirms your $25 Venmo to <strong>@adam-furtado</strong>.</p>
          </div>
        </div>
      )}

      {/* Action bar */}
      {!deadlinePassed && selectionChanged && (
        <div className="picks-action-bar">
          <span className={`pick-counter ${selectedIds.length===picksRequired?'counter-ready':'counter-pending'}`}>
            {selectedIds.length===picksRequired
              ? `✅ ${selectedIds.length}/${picksRequired} selected`
              : `${selectedIds.length}/${picksRequired} — pick ${picksRequired-selectedIds.length} more`}
          </span>
          <button className="btn-save" onClick={handleSave} disabled={saving||selectedIds.length!==picksRequired}>
            {saving ? 'Saving…' : 'Save Picks'}
          </button>
        </div>
      )}
      {!deadlinePassed && !selectionChanged && savedIds.length===picksRequired && (
        <div className="picks-saved-banner">✅ Picks saved! Deselect a team to make a change.</div>
      )}
      {deadlinePassed && (
        <div className="picks-locked-banner">
          🔒 Picks locked.{' '}
          {savedIds.length > 0 ? `You submitted ${savedIds.length} pick${savedIds.length>1?'s':''}.`
            : 'No picks submitted — Adam will assign your pick automatically.'}
        </div>
      )}
      {msg && <div className={`save-msg ${msg.type}`}>{msg.text}</div>}

      {/* Legend */}
      <div className="bracket-legend">
        <span className="legend-item"><span className="legend-dot dot-alive" />Available</span>
        <span className="legend-item"><span className="legend-dot dot-selected" />Selected</span>
        <span className="legend-item"><span className="legend-dot dot-used" />Already used</span>
        <span className="legend-item"><span className="legend-dot dot-out" />Eliminated</span>
      </div>

      {/* Region tabs */}
      <div className="region-tabs">
        {REGIONS.map(r => (
          <button key={r} className={`region-tab ${activeRegion===r?'active':''}`} onClick={() => setActiveRegion(r)}>
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
