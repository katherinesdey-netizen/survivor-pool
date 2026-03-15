import React, { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Layout.css'

export default function Layout() {
  const { participant, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleSignOut() {
    setMenuOpen(false)
    await signOut()
    navigate('/login')
  }

  function closeMenu() { setMenuOpen(false) }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="header-brand">
            <span className="brand-icon">🏀</span>
            <span className="brand-name">Survivor Pool <span className="brand-year">'26</span></span>
          </div>

          {/* Desktop nav */}
          <nav className="header-nav desktop-nav">
            <NavLink to="/dashboard" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Headquarters</NavLink>
            <NavLink to="/picks" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Picks</NavLink>
            <NavLink to="/standings" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Standings</NavLink>
            <NavLink to="/recaps" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Recaps</NavLink>
            <NavLink to="/rules" className={({isActive}) => isActive ? 'nav-link active' : 'nav-link'}>Rules</NavLink>
            {participant?.is_admin && (
              <NavLink to="/admin" className={({isActive}) => isActive ? 'nav-link admin-link active' : 'nav-link admin-link'}>Admin</NavLink>
            )}
          </nav>
          <button className="signout-btn desktop-only" onClick={handleSignOut}>Sign out</button>

          {/* Hamburger button — mobile only */}
          <button
            className={`hamburger${menuOpen ? ' open' : ''}`}
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Toggle menu"
          >
            <span /><span /><span />
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <nav className="mobile-nav">
            <NavLink to="/dashboard" className={({isActive}) => isActive ? 'mobile-nav-link active' : 'mobile-nav-link'} onClick={closeMenu}>Headquarters</NavLink>
            <NavLink to="/picks" className={({isActive}) => isActive ? 'mobile-nav-link active' : 'mobile-nav-link'} onClick={closeMenu}>Picks</NavLink>
            <NavLink to="/standings" className={({isActive}) => isActive ? 'mobile-nav-link active' : 'mobile-nav-link'} onClick={closeMenu}>Standings</NavLink>
            <NavLink to="/recaps" className={({isActive}) => isActive ? 'mobile-nav-link active' : 'mobile-nav-link'} onClick={closeMenu}>Recaps</NavLink>
            <NavLink to="/rules" className={({isActive}) => isActive ? 'mobile-nav-link active' : 'mobile-nav-link'} onClick={closeMenu}>Rules</NavLink>
            {participant?.is_admin && (
              <NavLink to="/admin" className={({isActive}) => isActive ? 'mobile-nav-link admin-link active' : 'mobile-nav-link admin-link'} onClick={closeMenu}>Admin</NavLink>
            )}
            <button className="mobile-signout-btn" onClick={handleSignOut}>Sign out</button>
          </nav>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
