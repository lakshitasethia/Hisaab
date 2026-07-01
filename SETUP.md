# Hisaab — Supabase Setup Guide

## 1. Create a Supabase Project

Go to [supabase.com](https://supabase.com), sign in, and create a new project. Note your:
- **Project URL** (e.g. `https://xxxx.supabase.co`)
- **Anon public key** (found in Settings → API)

## 2. Create Tables

Run this SQL in the **SQL Editor** (Supabase Dashboard → SQL Editor → New Query):

```sql
-- Worker table
CREATE TABLE worker (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_salary INTEGER NOT NULL,
  join_date DATE NOT NULL,
  weekly_off_day INTEGER NOT NULL CHECK (weekly_off_day >= 0 AND weekly_off_day <= 6),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Attendance table
CREATE TABLE attendance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id UUID NOT NULL REFERENCES worker(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'leave_paid', 'leave_unpaid', 'half_day')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(worker_id, date)
);

-- Transactions table
CREATE TABLE transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id UUID NOT NULL REFERENCES worker(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('advance', 'bonus', 'deduction')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## 3. Enable Row Level Security (RLS)

Run this to lock down access to authenticated users only:

```sql
-- Enable RLS on all tables
ALTER TABLE worker ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access (single-employer app)
CREATE POLICY "Authenticated users can do everything on worker"
  ON worker FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can do everything on attendance"
  ON attendance FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can do everything on transactions"
  ON transactions FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
```

## 4. Create Your User Account

Go to **Authentication → Users → Add User** in Supabase Dashboard.
Enter your email and password. This is the single employer account.

## 5. Update App Credentials

Open `app.js` and replace the placeholder values at the top:

```js
const SUPABASE_URL  = 'https://your-project.supabase.co';
const SUPABASE_ANON = 'your-anon-key-here';
```

## 6. Serve the App

You can serve the app with any static file server. The simplest way:

```bash
# Using Python
python3 -m http.server 8000

# Or using npx
npx -y serve .
```

Then open `http://localhost:8000` in your browser.
