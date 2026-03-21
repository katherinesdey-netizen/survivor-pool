import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import StandingsGrid, { GridParticipant, GridPick, GridDay } from '../components/StandingsGrid'
import './StandingsPage.css'

type PoolTab = 'main' | 'redemption'

export default function StandingsPage() {
  const { participant: me, redemptionParticipant: myRedemption, activePool } = useAuth()
  const activeTab: PoolTab = activePool === 'redemption' ? 'redemption' : 'main'

  // Main pool data
  const [participants, setParticipants] = useState<GridParticipant[]>([])
  const [picks, setPicks] = useState<GridPick[]>([])
  const [days, setDays] = useState<GridDay[]>([])

  // Redemption pool data
  const [rParticipants, setRParticipants] = useState<GridParticipant[]>([])
  const [rPicks, setRPicks] = useState<GridPick[]>([])

  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
    const interval = setInterval(() => setDays(d => [...d]), 60_000)
    return () => clearInterval(interval)
  }, [])

  async function fetchData() {
    setLoading(true)
    const giveUp = setTimeout(() => setLoading(false), 8000)
    try {
      const [
        { data: participantsData },
        [{ data: picksPage1 }, { data: picksPage2 }],
        { data: daysData },
        { data: rParticipantsData },
        { data: rPicksData },
      ] = await Promise.all([
        // Main pool participants
        supabase
          .from('participants')
          .select('id, full_name, is_eliminated, is_paid, eliminated_on_date')
          .eq('is_paid', true)
          .eq('pool', 'main')
          .order('full_name', { ascending: true }),

        // All picks in two parallel pages to bypass the 1000-row server cap
        Promise.all([
          supabase
            .from('picks')
            .select('participant_id, game_date, result, is_auto_assigned, teams(name, seed)')
            .order('game_date', { ascending: true })
            .order('id', { ascending: true })
            .range(0, 999),
          supabase
            .from('picks')
            .select('participant_id, game_date, result, is_auto_assigned, teams(name, seed)')
            .order('game_date', { ascending: true })
            .order('id', { ascending: true })
            .range(1000, 1999),
        ]),

        // Tournament days
        supabase
          .from('tournament_days')
          .select('game_date, round_name, deadline')
          .order('game_date', { ascending: true }),

        // Redemption pool participants — HIDDEN (pool not running; queries preserved for future re-enable)
        Promise.resolve({ data: [] }),

        // Redemption picks — HIDDEN
        Promise.resolve({ data: [] }),
      ])

      const picksData = [...(picksPage1 || []), ...(picksPage2 || [])]
      setParticipants(participantsData || [])
      setPicks((picksData as any) || [])
      setDays(daysData || [])
      setRParticipants(rParticipantsData || [])
      // Filter picks to only redemption participants
      const rIds = new Set((rParticipantsData || []).map((p: any) => p.id))
      setRPicks(((rPicksData as any) || []).filter((pk: any) => rIds.has(pk.participant_id)))
    } catch (err) {
      console.error('fetchData error:', err)
    } finally {
      clearTimeout(giveUp)
      setLoading(false)
    }
  }

  // Main pool stats
  const totalPot = participants.length * 25
  const alive = participants.filter(p => !p.is_eliminated).length
  const eliminated = participants.filter(p => p.is_eliminated).length

  // Redemption pool stats
  const rAlive = rParticipants.filter(p => !p.is_eliminated).length
  const rEliminated = rParticipants.filter(p => p.is_eliminated).length

  // Redemption Island: only show days from Round of 32 onward (Mar 21+)
  const redemptionDays = days.filter(d => d.game_date >= '2026-03-21')

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

  return (
    <div className="standings-page">

      {activeTab === 'main' && (
        <>
          <div className="standings-stats">
            <div className="standings-stat">
              <div className="sstat-num">{alive}</div>
              <div className="sstat-label">Still Alive</div>
            </div>
            <div className="standings-divider" />
            <div className="standings-stat">
              <div className="sstat-num">{eliminated}</div>
              <div className="sstat-label">Eliminated</div>
            </div>
            <div className="standings-divider" />
            <div className="standings-stat">
              <div className="sstat-num">${totalPot}</div>
              <div className="sstat-label">Total Pot</div>
            </div>
            <div className="standings-divider" />
            <div className="standings-stat">
              <div className="sstat-num">{participants.length}</div>
              <div className="sstat-label">Entries</div>
            </div>
          </div>

          <StandingsGrid
            participants={participants}
            picks={picks}
            days={days.filter(d => d.game_date !== '2026-03-22')}
            meId={me?.id}
            onRefresh={fetchData}
          />
        </>
      )}

      {false && activeTab === 'redemption' && ( /* REDEMPTION HIDDEN */
        <>
          {rParticipants.length === 0 ? (
            <div className="redemption-empty">
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏝️</div>
              <h2>Redemption Island</h2>
              <p>No registered participants yet. Check back after Round of 64 eliminations register.</p>
            </div>
          ) : (
            <>
              <div className="standings-stats">
                <div className="standings-stat">
                  <div className="sstat-num">{rAlive}</div>
                  <div className="sstat-label">Still Alive</div>
                </div>
                <div className="standings-divider" />
                <div className="standings-stat">
                  <div className="sstat-num">{rEliminated}</div>
                  <div className="sstat-label">Eliminated</div>
                </div>
                <div className="standings-divider" />
                <div className="standings-stat">
                  <div className="sstat-num">{rParticipants.length}</div>
                  <div className="sstat-label">Entries</div>
                </div>
              </div>

              <StandingsGrid
                participants={rParticipants}
                picks={rPicks}
                days={redemptionDays}
                meId={myRedemption?.id}
                onRefresh={fetchData}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
