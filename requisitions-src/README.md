# Pump Group requisitions

The requisitions and procurement app for the Mashaeng WWTW upgrade (contract TS004-2026). The site team asks for
materials from a phone, with photos, and books deliveries in. The directors approve, record orders, and follow
deliveries, invoices and payments.

Open it at **https://katiso0623.github.io/pumpgroup-site-board/requisitions/** and sign in with the same login as
the site board. It can be installed on a phone or a laptop, and it keeps working without a signal: a requisition or
a delivery written on site is kept on the phone and sent when the signal is back.

Like the site board, this folder holds only the app. Every requisition, photo, amount and person lives in the Pump
Group database behind the sign-in, and is never in these files. The letterhead the app prints on is kept in the
database too.

## Who sees what

| Login | Sees and does |
| --- | --- |
| Owner, directors | Everything: approve, query or refuse, record orders, order values, invoices and payments, the Excel register, the team |
| Site team | Their requisitions and deliveries, the register without amounts, messages. Never an order value or a cost |
| Site board viewers | Nothing. The app stops them at the door and, with the access rule below in the database, the database gives them no requisition |

Order values go into the site board's cost ledger (directors only), each one linked to its requisition.

## What is where

- `src/` the app: `index.html`, `app.css`, `sw.js`, `manifest.webmanifest`, the modules in `src/js/` (joined in
  name order into one `app.js`), fonts, icons, and the two libraries it uses (`vendor/`)
- `tools/build.py` builds `src/` into the published folder; `tools/make_icons.py` draws the app icons
- `../site/requisitions/` the built app, published with the site board by `.github/workflows/pages.yml`
- the access rule for the app's records is `20261110_03_requisitions.sql`; it joins `../supabase/migrations/` on
  the day it goes into the database

The app's records sit in the site board's document store, in groups of their own: `rq` (requisitions, orders,
deliveries, messages), `rq_office` (approvals), `rq_cfg` (the letterhead), and, for the directors only,
`budget/rq.*` (budget rates) and `costs/rq.*` (ledger entries).

## Building

```
python3 requisitions-src/tools/build.py --out ../site/requisitions --terser <path to terser>
```

Every file the page loads carries a short hash of its content in its address, and `sw.js` lists them, so a phone
always runs one complete version. The build stops if a published file holds a placeholder, a register file or a
letterhead.
