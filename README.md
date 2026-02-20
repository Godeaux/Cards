# Cards (Texas Hold'em MVP)

Playable multiplayer Hold'em prototype using:
- React + Vite frontend
- Supabase realtime state

## Features now

- Lobby + seat assignment (up to 8)
- Shared table settings (blinds, turn timer)
- Playable hand flow:
  - preflop / flop / turn / river
  - fold / check / call / raise-to / all-in
  - showdown + payout
- Text-first table UI with seat-by-seat state
- Personal hand/action panel

## Local dev

```bash
npm install
npm run dev
```

Create `.env.local`:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Supabase setup

Use **one file**:

- `supabase/full-setup.sql`

Paste it into Supabase SQL editor and run.

## Deploy

GitHub Pages workflow is in `.github/workflows/deploy-pages.yml`.

Set repository secrets:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
