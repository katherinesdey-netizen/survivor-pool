import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)
// Removed StrictMode — it causes Supabase auth lock conflicts in development
root.render(<App />)
