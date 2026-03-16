// Vercel Serverless Function — look up a guest participant by email
// POST /api/lookup-participant
// Body: { email: string }
// Returns: { id, full_name, is_paid, is_eliminated } or error

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service key bypasses RLS
)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email } = req.body || {}
  if (!email) return res.status(400).json({ error: 'Missing email' })

  try {
    const { data: participant, error } = await supabase
      .from('participants')
      .select('id, full_name, is_paid, is_eliminated')
      .ilike('email', email.trim())
      .maybeSingle()

    if (error) throw error

    if (!participant) {
      return res.status(404).json({
        error: 'not_found',
        message: "We don't have that email on file. Check for typos or contact the pool admin."
      })
    }
    if (!participant.is_paid) {
      return res.status(403).json({
        error: 'not_paid',
        message: "Your entry fee hasn't been confirmed yet. Contact the pool admin."
      })
    }
    if (participant.is_eliminated) {
      return res.status(403).json({
        error: 'eliminated',
        message: "You've been eliminated from the pool. Better luck next year! 😢"
      })
    }

    return res.status(200).json({ participant })

  } catch (err) {
    console.error('lookup-participant error:', err)
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' })
  }
}
