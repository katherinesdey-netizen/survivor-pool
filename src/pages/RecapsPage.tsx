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
    const giveUp = setTimeout(() => setLoading(false), 8000)
    try {
      const { data } = await supabase
        .from('recaps')
        .select('*')
        .order('game_date', { ascending: false })
        .order('id', { ascending: false })
        .limit(20)
      setRecaps(data || [])
    } catch (err) {
      console.error('fetchRecaps error:', err)
    } finally {
      clearTimeout(giveUp)
      setLoading(false)
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    })
  }

  function getYouTubeId(url: string): string | null {
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
    return m ? m[1] : null
  }

  function renderBody(body: string) {
    // Group consecutive HTML lines into blocks, then process remaining lines individually
    const lines = body.split('\n')
    const segments: Array<{ type: 'html'; html: string; key: number } | { type: 'line'; text: string; key: number }> = []
    let i = 0
    while (i < lines.length) {
      const trimmed = lines[i].trim()
      if (trimmed.startsWith('<')) {
        // Collect all consecutive HTML lines into one block
        const htmlLines: string[] = []
        while (i < lines.length && lines[i].trim().startsWith('<')) {
          htmlLines.push(lines[i])
          i++
        }
        segments.push({ type: 'html', html: htmlLines.join('\n'), key: segments.length })
      } else {
        segments.push({ type: 'line', text: lines[i], key: segments.length })
        i++
      }
    }

    return segments.map(seg => {
      if (seg.type === 'html') {
        return <div key={seg.key} dangerouslySetInnerHTML={{ __html: seg.html }} />
      }

      const trimmed = seg.text.trim()

      // YouTube URL on its own line → embedded player
      const youtubeId = getYouTubeId(trimmed)
      if (youtubeId && trimmed.match(/^https?:\/\//)) {
        return (
          <div key={seg.key} className="recap-video-wrap">
            <iframe
              src={`https://www.youtube.com/embed/${youtubeId}`}
              title="YouTube video"
              className="recap-youtube"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )
      }

      // [img:URL] tag or bare image/GIF URL on its own line → render as image
      const imgTagMatch = trimmed.match(/^\[img:(.+)\]$/)
      const bareUrl = trimmed.match(/^https?:\/\/\S+$/)
      const imgSrc = imgTagMatch ? imgTagMatch[1] : (bareUrl ? bareUrl[0] : null)

      if (imgSrc) {
        return (
          <div key={seg.key} className="recap-image-wrap">
            <img
              src={imgSrc}
              alt="Recap media"
              className="recap-inline-image"
              onError={e => {
                const wrap = (e.target as HTMLImageElement).parentElement
                if (wrap) wrap.style.display = 'none'
              }}
            />
          </div>
        )
      }

      if (trimmed === '') return <br key={seg.key} />

      // Bold: **text**
      const parts = seg.text.split(/(\*\*[^*]+\*\*)/)
      return (
        <p key={seg.key}>
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
