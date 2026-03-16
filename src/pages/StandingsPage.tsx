import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import StandingsGrid, { GridParticipant, GridPick, GridDay } from '../components/StandingsGrid'
import './StandingsPage.css'

export default function StandingsPage() {
  const { participant: me } = useAuth()
  const [participants, setParticipants] = useState<GridParticipant[]>([])
  const [picks, setPicks] = useState<GridPick[]>([])
  const [days, setDays] = useState<GridDay[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
    const interval = setInterval(() => setDays(d => [...d]), 60_000) // re-render every 60s for deadline checks
    return () => clearInterval(interval)
  }, [])

  async function fetchData() {
    setLoading(true)
    // Safety net — never spin forever
    const giveUp = setTimeout(() => setLoading(false), 8000)
    try {
      const [{ data: participantsData }, { data: picksData }, { data: daysData }] =
        await Promise.all([
          supabase
            .from('participants')
            .select('id, full_name, is_eliminated, is_paid, eliminated_on_date')
            .eq('is_paid', true)
            .order('full_name', { ascending: true }),
          supabase
            .from('picks')
            .select('participant_id, game_date, result, is_auto_assigned, teams(name, seed)')
            .order('game_date', { ascending: true }),
          supabase
            .from('tournament_days')
            .select('game_date, round_name, deadline')
            .order('game_date', { ascending: true }),
        ])

      setParticipants(participantsData || [])
      setPicks((picksData as any) || [])
      setDays(daysData || [])
    } catch (err) {
      console.error('fetchData error:', err)
    } finally {
      clearTimeout(giveUp)
      setLoading(false)
    }
  }

  const totalPot = participants.length * 25
  const alive = participants.filter(p => !p.is_eliminated).length
  const eliminated = participants.filter(p => p.is_eliminated).length

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

  return (
    <div className="standings-page">
      {/* Stats bar */}
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
        days={days}
        meId={me?.id}
        onRefresh={fetchData}
      />
    </div>
  )
}
