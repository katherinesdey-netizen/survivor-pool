// Vercel Serverless Function — register for Redemption Island
// POST /api/register-redemption
// Headers: Authorization: Bearer <supabase access token>
// Creates a pool='redemption' participant row for an eligible user.
// Eligible = eliminated in main pool on 2026-03-19 or 2026-03-20.

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service key — bypasses RLS
)

const ELIGIBLE_DATES = ['2026-03-19', '2026-03-20']

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── 1. Verify the JWT from the Authorization header ───────────────────────
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing authorization token' })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) return res.status(401).json({ error: 'Invalid or expired token' })

  const authUserId = user.id

  try {
    // ── 2. Look up main-pool participant ───────────────────────────────────
    const { data: mainRows, error: mainErr } = await supabase
      .from('participants')
      .select('id, full_name, email, venmo_handle, is_eliminated, eliminated_on_date, pool, auth_user_id')
      .eq('auth_user_id', authUserId)
      .eq('pool', 'main')

    // Fallback for pre-migration: query by id
    let mainParticipant = mainRows?.[0] ?? null
    if (mainErr || !mainParticipant) {
      const { data: byId } = await supabase
        .from('participants')
        .select('id, full_name, email, venmo_handle, is_eliminated, eliminated_on_date')
        .eq('id', authUserId)
        .single()
      mainParticipant = byId ?? null
    }

    if (!mainParticipant) {
      return res.status(404).json({ error: 'not_found', message: 'No main pool entry found for your account.' })
    }

    // ── 3. Check eligibility ──────────────────────────────────────────────
    if (!mainParticipant.is_eliminated) {
      return res.status(403).json({
        error: 'not_eligible',
        message: "You're still alive in the main pool — Redemption Island is for eliminated players only."
      })
    }

    if (!ELIGIBLE_DATES.includes(mainParticipant.eliminated_on_date)) {
      return res.status(403).json({
        error: 'not_eligible',
        message: 'Redemption Island is only open to players eliminated in Round of 64 (Mar 19–20).'
      })
    }

    // ── 4. Check not already registered ──────────────────────────────────
    const authUserIdToCheck = mainParticipant.auth_user_id ?? mainParticipant.id

    const { data: existing } = await supabase
      .from('participants')
      .select('id')
      .eq('auth_user_id', authUserIdToCheck)
      .eq('pool', 'redemption')
      .maybeSingle()

    if (existing) {
      return res.status(409).json({ error: 'already_registered', message: "You're already registered for Redemption Island." })
    }

    // ── 5. Insert redemption participant row ──────────────────────────────
    const newId = crypto.randomUUID()
    const { data: newRow, error: insertErr } = await supabase
      .from('participants')
      .insert({
        id: newId,
        auth_user_id: authUserIdToCheck,
        email: mainParticipant.email,
        full_name: mainParticipant.full_name,
        venmo_handle: mainParticipant.venmo_handle,
        pool: 'redemption',
        is_paid: false,
        is_eliminated: false,
        is_admin: false,
      })
      .select()
      .single()

    if (insertErr) {
      console.error('register-redemption insert error:', insertErr)
      return res.status(500).json({ error: 'insert_failed', message: insertErr.message })
    }

    return res.status(200).json({ success: true, participant: newRow })

  } catch (err) {
    console.error('register-redemption error:', err)
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' })
  }
}
