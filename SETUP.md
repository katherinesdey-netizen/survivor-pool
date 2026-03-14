# Survivor Pool — Setup Guide

## Run locally
```
cd survivor-pool
npm start
```
Then open http://localhost:3000

## Files you need to know about
- `.env.local` — your Supabase keys (already filled in)
- `supabase_schema.sql` — already run in Supabase ✅
- `src/` — all the app code

## Deploy to Vercel (when ready)
1. Push this folder to a GitHub repo
2. Go to vercel.com, click "New Project", connect your GitHub repo
3. Add environment variables in Vercel dashboard:
   - REACT_APP_SUPABASE_URL
   - REACT_APP_SUPABASE_ANON_KEY
4. Deploy — Vercel auto-rebuilds on every git push
