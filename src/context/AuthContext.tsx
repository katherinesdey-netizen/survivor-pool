import React, { createContext, useContext, useEffect, useState } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface Participant {
  id: string
  email: string
  full_name: string
  venmo_handle: string | null
  is_paid: boolean
  is_admin: boolean
  is_eliminated: boolean
  eliminated_on_date: string | null
  pool?: string
  auth_user_id?: string
}

interface AuthContextType {
  user: User | null
  session: Session | null
  participant: Participant | null
  redemptionParticipant: Participant | null
  activePool: 'main' | 'redemption'
  setActivePool: (pool: 'main' | 'redemption') => void
  loading: boolean
  signOut: () => Promise<void>
  refreshParticipant: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [redemptionParticipant, setRedemptionParticipant] = useState<Participant | null>(null)
  const [activePool, setActivePool] = useState<'main' | 'redemption'>('main')
  const [loading, setLoading] = useState(true)

  async function fetchParticipant(userId: string, userEmail?: string) {
    // 1. Post-migration path: query by auth_user_id (supports both pools)
    //    Falls back gracefully if the column doesn't exist yet (pre-migration).
    const { data: rows, error: rowsErr } = await supabase
      .from('participants')
      .select('*')
      .eq('auth_user_id', userId)

    if (!rowsErr && rows && rows.length > 0) {
      const mainRow = rows.find(r => r.pool === 'main') ?? rows[0]
      const redemptionRow = rows.find(r => r.pool === 'redemption') ?? null
      setParticipant(mainRow)
      setRedemptionParticipant(redemptionRow)
      return
    }

    // 2. Pre-migration fallback: query by id (single-pool, original behavior)
    const { data } = await supabase
      .from('participants')
      .select('*')
      .eq('id', userId)
      .single()

    if (data) {
      setParticipant(data)
      setRedemptionParticipant(null)
      return
    }

    // 3. Fallback: find a pre-loaded row by email and link it to this auth user
    if (!userEmail) {
      setParticipant(null)
      setRedemptionParticipant(null)
      return
    }

    const { data: byEmail } = await supabase
      .from('participants')
      .select('*')
      .ilike('email', userEmail)
      .eq('pool', 'main')
      .single()

    if (!byEmail) {
      // Try without pool filter (pre-migration)
      const { data: byEmailLegacy } = await supabase
        .from('participants')
        .select('*')
        .ilike('email', userEmail)
        .single()

      if (!byEmailLegacy) {
        setParticipant(null)
        setRedemptionParticipant(null)
        return
      }

      // Update placeholder UUID → real auth UUID (pre-migration path)
      await supabase.from('participants').update({ id: userId, is_paid: true }).ilike('email', userEmail)
      setParticipant({ ...byEmailLegacy, id: userId, is_paid: true })
      setRedemptionParticipant(null)
      return
    }

    // Update placeholder UUID → real auth UUID (post-migration path)
    const oldId = byEmail.id
    await supabase.from('participants').update({
      id: userId,
      auth_user_id: userId,
      is_paid: true,
    }).ilike('email', userEmail).eq('pool', 'main')
    // Re-link any picks that were manually inserted with the placeholder UUID
    if (oldId !== userId) {
      await supabase.from('picks').update({ participant_id: userId }).eq('participant_id', oldId)
    }
    setParticipant({ ...byEmail, id: userId, auth_user_id: userId, is_paid: true })
    setRedemptionParticipant(null)
  }

  async function refreshParticipant() {
    if (user) await fetchParticipant(user.id, user.email ?? undefined)
  }

  async function signOut() {
    setUser(null)
    setSession(null)
    setParticipant(null)
    setRedemptionParticipant(null)
    setActivePool('main')
    supabase.auth.signOut().catch(() => {})
  }

  useEffect(() => {
    const timeout = setTimeout(() => setLoading(false), 3000)

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          fetchParticipant(session.user.id, session.user.email ?? undefined).finally(() => {
            clearTimeout(timeout)
            setLoading(false)
          })
        } else {
          clearTimeout(timeout)
          setLoading(false)
        }
      })
      .catch(() => {
        clearTimeout(timeout)
        setLoading(false)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          await fetchParticipant(session.user.id, session.user.email ?? undefined)
        } else {
          setParticipant(null)
          setRedemptionParticipant(null)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line

  return (
    <AuthContext.Provider value={{ user, session, participant, redemptionParticipant, activePool, setActivePool, loading, signOut, refreshParticipant }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
