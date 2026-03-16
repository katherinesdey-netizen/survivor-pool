import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import './LoginPage.css'

type Step = 'login' | 'register' | 'forgot' | 'forgot_sent' | 'register_confirm'

export default function LoginPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [venmo, setVenmo] = useState('')
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

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!fullName.trim()) { setError('Please enter your full name.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }

    setLoading(true)

    // Check if a participant row already exists for this email (pre-loaded or existing)
    const { data: existing } = await supabase
      .from('participants')
      .select('id')
      .ilike('email', email.trim())
      .maybeSingle()

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: undefined }
    })

    if (error) {
      if (error.message.toLowerCase().includes('already registered')) {
        setError('An account with this email already exists. Try logging in.')
      } else {
        setError(error.message)
      }
      setLoading(false)
      return
    }

    if (data.user) {
      if (existing) {
        // Pre-loaded participant: update their row to use the new auth user's ID
        // so AuthContext can find them by user.id
        const { error: updateError } = await supabase
          .from('participants')
          .update({
            id: data.user.id,
            full_name: fullName.trim() || undefined,
            venmo_handle: venmo.trim() || undefined,
          })
          .eq('id', existing.id)

        if (updateError) {
          await supabase.auth.signOut()
          setError('Account linked but profile update failed. Please contact the pool admin.')
          setLoading(false)
          return
        }
      } else {
        // Brand new participant — create a fresh profile row
        const { error: insertError } = await supabase.from('participants').insert({
          id: data.user.id,
          email: email.toLowerCase().trim(),
          full_name: fullName.trim(),
          venmo_handle: venmo.trim() || null,
          is_paid: false,
          is_admin: false,
          is_eliminated: false,
        })

        if (insertError) {
          await supabase.auth.signOut()
          setError('Account created but profile setup failed. Please contact the pool admin.')
          setLoading(false)
          return
        }
      }

      // Sign them in right away
      await supabase.auth.signInWithPassword({ email: email.trim(), password })
    }

    setLoading(false)
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
          <div className="login-bracket">🏀</div>
          <h1>March Madness<br />Survivor Pool</h1>
          <p className="login-subtitle">2026 · Adam's Pool</p>
        </div>

        {step === 'login' && (
          <form onSubmit={handleLogin} className="login-form">
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
              <button type="button" className="link-btn" onClick={() => { setStep('register'); setError('') }}>
                New? Register here
              </button>
              <span className="footer-divider">·</span>
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

        {step === 'register' && (
          <form onSubmit={handleRegister} className="login-form">
            <p className="login-instructions">
              Create your account to join the pool.
            </p>
            <div className="field">
              <label>Full name</label>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                placeholder="Jane Smith" required autoFocus />
            </div>
            <div className="field">
              <label>Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required />
            </div>
            <div className="field">
              <label>Password <span className="optional">(min 6 characters)</span></label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required />
            </div>
            <div className="field">
              <label>Confirm password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••" required />
            </div>
            <div className="field">
              <label>Venmo handle <span className="optional">(optional)</span></label>
              <input type="text" value={venmo} onChange={e => setVenmo(e.target.value)}
                placeholder="@jane-smith" />
            </div>
            <div className="payment-reminder">
              <strong>💵 Entry fee: $25 via Venmo</strong>
              <p>Send payment to <strong>@adam-furtado</strong> before the first game Thursday. Your picks won't count until payment is confirmed.</p>
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating account...' : 'Create Account →'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => { setStep('login'); setError('') }}>
              ← Back to sign in
            </button>
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
