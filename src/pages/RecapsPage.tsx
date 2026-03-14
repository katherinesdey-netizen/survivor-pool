import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import './RecapsPage.css'

interface Recap {
  id: number
  title: string
  body: string
  image_urls: string[]
  game_date: string
  created_at: string
}

export default function RecapsPage() {
  const [recaps, setRecaps] = useState<Recap[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchRecaps() }, [])

  async function fetchRecaps() {
    setLoading(true)
    const { data } = await supabase
      .from('recaps')
      .select('*')
      .order('game_date', { ascending: false })
    setRecaps(data || [])
    setLoading(false)
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    })
  }

  function renderBody(body: string) {
    return body
      .split('\n')
      .map((line, i) => {
        // Image tag: [img:URL]
        const imgMatch = line.trim().match(/^\[img:(.+)\]$/)
        if (imgMatch) {
          return (
            <img
              key={i}
              src={imgMatch[1]}
              alt="Recap media"
              className="recap-inline-image"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )
        }

        if (line.trim() === '') return <br key={i} />

        // Bold: **text**
        const parts = line.split(/(\*\*[^*]+\*\*)/)
        return (
          <p key={i}>
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={j}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        )
      })
  }

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>

  if (recaps.length === 0) {
    return (
      <div className="recaps-page">
        <div className="recaps-empty">
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📝</div>
          <h2>No recaps yet</h2>
          <p>Check back after the first games — Adam will post a recap here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="recaps-page">
      <h1 className="recaps-title">Daily Recaps</h1>
      <div className="recaps-list">
        {recaps.map(recap => (
          <div key={recap.id} className="recap-card">
            <div className="recap-date">{formatDate(recap.game_date)}</div>
            <h2 className="recap-heading">{recap.title}</h2>
            <div className="recap-body">{renderBody(recap.body)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
