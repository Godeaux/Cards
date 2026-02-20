# Cards (Texas Hold'em MVP)

Minimalist, friends-only Texas Hold'em web app.

## Current status

- React + Vite frontend
- Supabase realtime lobby scaffold
- Shared table settings (blinds, turn timer)
- Initial hand lifecycle scaffold (dealer rotation + turn handoff)

## Local development

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

Run `supabase/schema.sql` in Supabase SQL editor.

Enable Realtime for:
- `lobby_players`
- `table_settings`
- `game_state` (recommended for hand state sync)

## GitHub Pages deployment

This repo uses `.github/workflows/deploy-pages.yml`.

Set repository secrets:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Then push to `main` (or run the workflow manually).

Pages URL should be:

`https://godeaux.github.io/Cards/`
