# Survivor Pool — Claude Context

## Project Location
**Always work here:** `/Users/katherinedey/downloads/survivor-pool`
Never look in `/Users/katherinedey/Desktop/` or any other folder.

## Dev Server
```bash
cd ~/downloads/survivor-pool
npm start   # http://localhost:3000
```
Note: `/api/*.js` serverless functions do NOT run locally — test those on Vercel after `git push`.

---

## What This Is
An NCAA March Madness survivor pool web app for a private group (~10-15 participants).
Commissioner: Adam. Not a commercial product — keep it simple and maintainable by non-engineers.

---

## Pool Rules (enforce these in code)
- **Round of 64 (Thu Mar 19 & Fri Mar 20):** 2 picks per day
- **All other days:** 1 pick per day
- **12 total picks max** across the tournament
- A team **cannot be picked twice** by the same participant (ever)
- If any pick loses → participant is **eliminated**
- Participants eliminated on the **same day** are tied and split the pot
- **Paid status required** — unpaid participants' picks don't count
- **One entry per person**
- Entry fee: $25 via Venmo (@adam-furtado)
- **Missed pick rule:** auto-assign worst-seeded available team in the last game of the day (walk backward if already used)

---

## Key Dates (2026 Tournament)
| Day | Date | Deadline |
|-----|------|----------|
| Rd of 64 - Thursday | Mar 19 | 11:30 AM ET |
| Rd of 64 - Friday | Mar 20 | 30 min before first tip |
| Rd of 32 - Saturday | Mar 21 | 30 min before first tip |
| Rd of 32 - Sunday | Mar 22 | 30 min before first tip |
| Sweet 16 - Thursday | Mar 27 | 30 min before first tip |
| Sweet 16 - Friday | Mar 28 | 30 min before first tip |
| Elite Eight - Saturday | Mar 29 | 30 min before first tip |
| Elite Eight - Sunday | Mar 30 | 30 min before first tip |
| National Semifinals | Apr 5 | 30 min before first tip |
| National Championship | Apr 7 | 30 min before first tip |

First Four (Tue/Wed before tournament) = NOT part of pool, but winners are eligible picks.

---

## Tech Stack
- **Frontend:** React + TypeScript (Create React App), react-router-dom v7
- **Auth/DB:** Supabase (Postgres + Auth)
- **Serverless API:** Vercel (`/api/*.js`) — uses Supabase service key to bypass RLS
- **Deploy:** Vercel — auto-deploys on `git push` to main
- **Principle:** Simple and maintainable. No over-engineering. Fewer dependencies is better.

## Key Files
- `src/App.tsx` — routes, ProtectedRoute, PUBLIC_PATHS = ['/standings', '/pick']
- `src/pages/` — one .tsx + .css per page
- `api/submit-pick.js` — guest pick submission (serverless, requires Vercel to run)
- `api/update-results.js` — admin result entry (serverless, requires Vercel to run)
- `.env.local` — Supabase keys (not committed to git)
- `supabase_schema.sql` — DB schema reference
- `vercel.json` — Vercel rewrites config

## Database Tables
- `participants` — pool members; no FK to auth.users (dropped intentionally so pre-loaded rows can exist without auth accounts)
- `tournament_days` — game dates, round_name, deadline (TIMESTAMPTZ), picks_required (INT, default 1; set to 2 for Rd of 64)
- `teams` — all tournament teams with seed, region, name
- `picks` — participant picks per game_date (multiple rows allowed per day for Rd of 64)
- `results` — winning team per game_date (set by admin)

## Public Routes (no login required)
- `/standings` — spreadsheet-style standings grid, visible to anyone
- `/pick` — guest pick submission (email lookup → team select → submit)

## Auth / Registration Notes
- Participants are pre-loaded into `participants` table by admin (with email, name, venmo)
- When a pre-loaded participant registers, the app finds their existing row by email and UPDATEs the `id` to the new auth user UUID — preserves their pick history
- Anon RLS policies exist on participants, tournament_days, teams, picks for public pages

---

## Current Build Status (as of Mar 2026)
**Built & deployed:**
- Login / Register / Reset Password
- Dashboard (logged-in participant view)
- Picks page (logged-in pick submission)
- Standings page (public spreadsheet grid, deadline-gated pick reveal)
- Guest pick page `/pick` (no login required, multi-pick support for Rd of 64)
- Admin page (results entry, participant management)
- Recaps page
- Rules page

**Pending / in progress:**
- Bulk invite button (send Supabase auth invites to pre-loaded participants)
- Missed pick auto-assignment (not yet automated)
- Notifications (tabled pending Vercel Pro decision)

---

## How to Work on This Project
- **Ask before assuming** on rules or requirements — pool rules have specific edge cases
- **Prefer working code over perfect code** — get it running, then improve
- **Always tell Adam what to do next** (run this command, paste this SQL, etc.)
- **Flag risks early** — if a decision will be hard to undo, say so first
- **Mobile-first** — many participants use phones; test at mobile widths
- **No over-engineering** — Adam is not an engineer; keep the codebase small and readable
- **Test before reporting done** — use browser automation tools to verify UI actually works
