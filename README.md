# Cards (Static HTML)

This repo now deploys as a **static HTML page** to GitHub Pages.

## Hosting
- Deploy source: `site/index.html`
- Workflow: `.github/workflows/deploy-pages.yml`

## Notes
- No Vite build step required for GitHub Pages deploy.
- Supabase URL + anon key are embedded in `site/index.html`.

## Local quick test
Open `site/index.html` in a browser (or run any static file server).
