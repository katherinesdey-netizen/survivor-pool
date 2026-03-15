import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL!
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY!

// Bypass Web Navigator Locks — they cause AbortError "Lock broken by another
// request" in some browsers/environments, which makes getSession() and
// Supabase queries hang forever and never resolve or reject.
const noopLock = async (_name: string, _timeout: number, fn: () => Promise<any>) => fn()

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    lock: noopLock,
  },
})
