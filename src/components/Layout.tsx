import React from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Layout.css'

export default function Layout() {
  const { participant, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <span className="brand-icon">🏀</span>
            <span className="brand-name">Survivor Pool <span className="brand-year">'26</span></span>
          </div>
          <nav className="header-nav">
            <NavLink to="/dashboard" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>
              My Status
            </NavLink>
            <NavLink to="/picks" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>
              Picks
            </NavLink>
            <NavLink to="/standings" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>
              Standings
            </NavLink>
            {participant?.is_admin && (
              <NavLink to="/admin" className={({isActive}) => isActive ? 'nav-link admin-link active' : 'nav-link admin-link'}>
                Admin
              </NavLink>
            )}
          </nav>
          <button className="signout-btn" onClick={handleSignOut}>Sign out</button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
