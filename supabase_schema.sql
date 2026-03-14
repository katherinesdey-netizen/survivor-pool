-- ============================================
-- SURVIVOR POOL DATABASE SCHEMA
-- Run this in Supabase SQL Editor
-- ============================================

-- Participants table (extends Supabase auth.users)
CREATE TABLE participants (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  venmo_handle TEXT,
  is_paid BOOLEAN DEFAULT FALSE,
  is_admin BOOLEAN DEFAULT FALSE,
  is_eliminated BOOLEAN DEFAULT FALSE,
  eliminated_on_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tournament teams table
CREATE TABLE teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  seed INTEGER NOT NULL,
  region TEXT NOT NULL, -- East, West, South, Midwest
  is_eliminated BOOLEAN DEFAULT FALSE,
  eliminated_on DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tournament schedule: one row per tournament day
CREATE TABLE tournament_days (
  id SERIAL PRIMARY KEY,
  game_date DATE NOT NULL UNIQUE,
  round_name TEXT NOT NULL, -- 'Round of 64', 'Round of 32', etc.
  picks_required INTEGER NOT NULL DEFAULT 1, -- 2 for Round of 64 days, 1 otherwise
  deadline TIMESTAMPTZ NOT NULL, -- 30 min before first tip
  is_complete BOOLEAN DEFAULT FALSE
);

-- Games table
CREATE TABLE games (
  id SERIAL PRIMARY KEY,
  tournament_day_id INTEGER REFERENCES tournament_days(id),
  game_date DATE NOT NULL,
  tip_time TIMESTAMPTZ,
  team1_id INTEGER REFERENCES teams(id),
  team2_id INTEGER REFERENCES teams(id),
  winner_id INTEGER REFERENCES teams(id),
  is_complete BOOLEAN DEFAULT FALSE,
  -- For missed pick auto-assignment: track game order within the day
  game_order INTEGER NOT NULL DEFAULT 1
);

-- Picks table
CREATE TABLE picks (
  id SERIAL PRIMARY KEY,
  participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id),
  game_date DATE NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  is_auto_assigned BOOLEAN DEFAULT FALSE, -- true if missed pick rule applied
  result TEXT CHECK (result IN ('pending', 'won', 'lost')) DEFAULT 'pending',
  UNIQUE(participant_id, game_date, team_id)
);

-- ============================================
-- ROW LEVEL SECURITY (who can see/edit what)
-- ============================================

ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE picks ENABLE ROW LEVEL SECURITY;

-- Participants: users can read all, but only edit their own row
CREATE POLICY "Anyone logged in can view participants"
  ON participants FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can update their own profile"
  ON participants FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON participants FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Teams & schedule: everyone logged in can read
CREATE POLICY "Anyone logged in can view teams"
  ON teams FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Anyone logged in can view tournament days"
  ON tournament_days FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Anyone logged in can view games"
  ON games FOR SELECT USING (auth.role() = 'authenticated');

-- Picks: participants can read all picks (for standings), insert/update their own
CREATE POLICY "Anyone logged in can view picks"
  ON picks FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Participants can submit their own picks"
  ON picks FOR INSERT
  WITH CHECK (auth.uid() = participant_id);

CREATE POLICY "Participants can update their own picks"
  ON picks FOR UPDATE
  USING (auth.uid() = participant_id);

-- ============================================
-- SEED: Tournament days for 2025 March Madness
-- ============================================

INSERT INTO tournament_days (game_date, round_name, picks_required, deadline) VALUES
  ('2025-03-20', 'Round of 64', 2, '2025-03-20 11:30:00-04'),
  ('2025-03-21', 'Round of 64', 2, '2025-03-21 11:30:00-04'),
  ('2025-03-22', 'Round of 32', 1, '2025-03-22 11:30:00-04'),
  ('2025-03-23', 'Round of 32', 1, '2025-03-23 11:30:00-04'),
  ('2025-03-27', 'Sweet 16',    1, '2025-03-27 06:30:00-04'),
  ('2025-03-28', 'Sweet 16',    1, '2025-03-28 06:30:00-04'),
  ('2025-03-29', 'Elite 8',     1, '2025-03-29 06:30:00-04'),
  ('2025-03-30', 'Elite 8',     1, '2025-03-30 06:30:00-04'),
  ('2025-04-05', 'Final Four',  1, '2025-04-05 05:30:00-04'),
  ('2025-04-07', 'Championship',1, '2025-04-07 08:00:00-04');

