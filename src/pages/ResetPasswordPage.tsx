import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './LoginPage.css'

type Status = 'waiting' | 'ready' | 'success' | 'expired'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<Status>('waiting')

  useEffect(() => {
    // First check if the URL hash contains an error (e.g. expired link)
    const hash = window.location.hash
    if (hash.includes('error=')) {
      setStatus('expired')
      return
    }

    // Give Supabase a moment to parse the token from the URL hash
    const timer = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        setStatus('ready')
      } else {
        setStatus('expired')
      }
    }, 500)

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setStatus('ready')
      }
    })

    return () => {
      clearTimeout(timer)
      subscription.unsubscribe()
    }
  }, [])

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }

    setLoading(true)

    try {
      const { data, error } = await supabase.auth.updateUser({ password })

      if (error) {
        setError(error.message)
        setLoading(false)
      } else if (data) {
        setStatus('success')
        setTimeout(() => navigate('/dashboard'), 2000)
      } else {
        setError('Something went wrong. Please request a new reset link.')
        setLoading(false)
      }
    } catch (err) {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg" />
      <div className="login-card">
        <div className="login-header">
          <div className="login-bracket">🏀</div>
          <h1>Reset Your<br />Password</h1>
          <p className="login-subtitle">2026 · Adam's Pool</p>
        </div>

        {status === 'waiting' && (
          <div className="login-sent">
            <div className="sent-icon">⏳</div>
            <p>Verifying your reset link...</p>
          </div>
        )}

        {status === 'expired' && (
          <div className="login-sent">
            <div className="sent-icon">⚠️</div>
            <h2>Link expired</h2>
            <p>This reset link has expired or already been used.</p>
            <p className="sent-note">
              <button className="link-btn" onClick={() => navigate('/login')}>
                ← Back to sign in
              </button>
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="login-sent">
            <div className="sent-icon">✅</div>
            <h2>Password updated!</h2>
            <p>Redirecting you to the dashboard...</p>
          </div>
        )}

        {status === 'ready' && (
          <form onSubmit={handleReset} className="login-form">
            <div className="field">
              <label>New password <span className="optional">(min 6 characters)</span></label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label>Confirm new password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Set New Password →'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
