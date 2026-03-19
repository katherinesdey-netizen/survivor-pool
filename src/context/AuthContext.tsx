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
}

interface AuthContextType {
  user: User | null
  session: Session | null
  participant: Participant | null
  loading: boolean
  signOut: () => Promise<void>
  refreshParticipant: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchParticipant(userId: string, userEmail?: string) {
    // 1. Normal lookup by auth UUID
    const { data } = await supabase
      .from('participants')
      .select('*')
      .eq('id', userId)
      .single()

    if (data) { setParticipant(data); return }

    // 2. Fallback: find a pre-loaded row by email and link it to this auth user
    if (!userEmail) { setParticipant(null); return }

    const { data: byEmail } = await supabase
      .from('participants')
      .select('*')
      .ilike('email', userEmail)
      .single()

    if (!byEmail) { setParticipant(null); return }

    // Update placeholder UUID → real auth UUID, and mark as paid (allowed by "Link pre-loaded participant" RLS policy)
    await supabase.from('participants').update({ id: userId, is_paid: true }).ilike('email', userEmail)
    setParticipant({ ...byEmail, id: userId, is_paid: true })
  }

  async function refreshParticipant() {
    if (user) await fetchParticipant(user.id, user.email ?? undefined)
  }

  async function signOut() {
    // Clear local state immediately so the UI responds instantly,
    // even on slow/offline connections. Fire-and-forget the server call.
    setUser(null)
    setSession(null)
    setParticipant(null)
    supabase.auth.signOut().catch(() => {})
  }

  useEffect(() => {
    // Hard timeout — if auth init hangs for any reason, unblock the app
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
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line

  return (
    <AuthContext.Provider value={{ user, session, participant, loading, signOut, refreshParticipant }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
