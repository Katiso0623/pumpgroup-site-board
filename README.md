# Pump Group site board

The site board for the Mashaeng WWTW upgrade (contract TS004-2026): the programme, daily site logs, labour, quality
registers, photos and project documents, for the Pump Group team, the Director and the Engineer.

Open it at **https://katiso0623.github.io/pumpgroup-site-board/** and sign in with the login Katiso gives you.

The requisitions and procurement app for the same site is at
**https://katiso0623.github.io/pumpgroup-site-board/requisitions/**, with the same sign-in, for the Pump Group team
only (see `requisitions-src/README.md`).

This repository holds only the website and its set-up. Every log, photo, figure and person lives in the Pump Group
database behind the sign-in, and is never in these files.

- `site/` the website (published to GitHub Pages by `.github/workflows/pages.yml`)
- `site/requisitions/` the requisitions app as published, built from `requisitions-src/`
- `supabase/` the database set-up and the `site-board-api` server function
- `sync/` sealed files on their way into the database (`.github/workflows/sync.yml` brings them in; only the server
  can open them, and only files signed by `tools/seal.py`'s signing key are accepted)
