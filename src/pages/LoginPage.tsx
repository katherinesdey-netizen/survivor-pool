import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import './LoginPage.css'

type Step = 'login' | 'forgot' | 'forgot_sent'

export default function LoginPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (user) navigate('/dashboard')
  }, [user, navigate])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })

    if (error) {
      setError('Incorrect email or password. Need an account? Click "Register" below.')
      setLoading(false)
    }
    // on success, useEffect above redirects to dashboard
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + '/reset-password'
    })

    if (error) {
      setError(error.message)
    } else {
      setStep('forgot_sent')
    }
    setLoading(false)
  }

  return (
    <div className="login-page">
      <div className="login-bg" />
      <div className="login-card">
        <div className="login-header">
          <img src="/logo.png" alt="Pool Logo" className="login-logo" />
          <h1>March Madness<br />Survivor Pool</h1>
          <p className="login-subtitle">2026 · Adam's Pool</p>
        </div>

        {step === 'login' && (
          <form onSubmit={handleLogin} className="login-form">
            <div className="welcome-blurb">
              <p>Welcome to my <strong>10th Annual 2026 NCAA Survivor Pool</strong>.</p>
              <p>Registration is closed. Sign in if you have an account, or use the button below to submit picks with just your email.</p>
              <p>The rules remain the same as previous years — <Link to="/rules" className="rules-link">view the rules here</Link>.</p>
            </div>
            <div className="field">
              <label>Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required autoFocus />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In →'}
            </button>
            <div className="login-footer-links">
              <button type="button" className="link-btn" onClick={() => { setStep('forgot'); setError('') }}>
                Forgot password?
              </button>
            </div>

            <div className="guest-pick-divider">
              <span className="guest-pick-divider-line" />
              <span className="guest-pick-divider-text">or</span>
              <span className="guest-pick-divider-line" />
            </div>

            <button
              type="button"
              className="btn-guest-pick"
              onClick={() => window.location.href = '/pick'}
            >
              🏀 Make picks without an account
            </button>
            <p className="guest-pick-note">No account needed — just enter your email</p>
          </form>
        )}

        {step === 'forgot' && (
          <form onSubmit={handleForgotPassword} className="login-form">
            <p className="login-instructions">
              Enter your email and we'll send you a link to reset your password.
            </p>
            <div className="field">
              <label>Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required autoFocus />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link →'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setStep('login'); setError('') }}>
              ← Back to sign in
            </button>
          </form>
        )}

        {step === 'forgot_sent' && (
          <div className="login-sent">
            <div className="sent-icon">📬</div>
            <h2>Check your email!</h2>
            <p>We sent a password reset link to <strong>{email}</strong>.</p>
            <p className="sent-note">
              <button className="link-btn" onClick={() => { setStep('login'); setError('') }}>
                ← Back to sign in
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
