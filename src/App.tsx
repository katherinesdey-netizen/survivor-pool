import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import DashboardPage from './pages/DashboardPage'
import AdminPage from './pages/AdminPage'
import StandingsPage from './pages/StandingsPage'
import GuestPickPage from './pages/GuestPickPage'
import PicksPage from './pages/PicksPage'
import RedemptionPicksPage from './pages/RedemptionPicksPage'
import RecapsPage from './pages/RecapsPage'
import RulesPage from './pages/RulesPage'
import Layout from './components/Layout'
import ScrollToTop from './components/ScrollToTop'

// Public paths that don't require authentication
const PUBLIC_PATHS = ['/standings', '/pick', '/rules']

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (!user && !PUBLIC_PATHS.includes(location.pathname)) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { participant, loading } = useAuth()
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>
  if (!participant?.is_admin) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/pick" element={<GuestPickPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="picks" element={<PicksPage />} />
            <Route path="redemption/picks" element={<RedemptionPicksPage />} />
            <Route path="standings" element={<StandingsPage />} />
            <Route path="recaps" element={<RecapsPage />} />
            <Route path="rules" element={<RulesPage />} />
            <Route path="admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
