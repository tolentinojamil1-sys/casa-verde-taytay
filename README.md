# Casa Verde Taytay — functional booking website

## Run locally
1. Install Node.js 22 LTS.
2. In this folder run `npm install`.
3. Copy `.env.example` to `.env` and set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and a strong `SESSION_SECRET`.
4. Run `npm start`.
5. Open `http://localhost:3000`.
6. Admin: `http://localhost:3000/admin.html`.

## What works now
- Responsive guest website
- Live availability API
- Date conflict prevention
- Reservation database (SQLite)
- Admin login
- Admin reservation list and status changes
- Block dates
- Change nightly rate and max guests
- Booking IDs and totals

## Production payment
The reservation flow intentionally stops at `pending` because real payment credentials and a payment provider account are required. The `/api/webhooks/payment` endpoint is a provider-neutral hook for the final payment callback, but it must be replaced/secured with the exact signature verification and API flow of the chosen provider before accepting real money.

For Philippine payments, choose a payment provider that supports the methods you want (e.g. cards, GCash/Maya, bank options) and configure settlement to the Casa Verde business bank account. Do not put secret payment keys in browser JavaScript.

## Production hosting
Use a Node-compatible host with HTTPS and persistent storage (or move SQLite to managed PostgreSQL). Set environment variables in the host dashboard. Replace the placeholder hero image with Casa Verde's licensed property photos.

## Render
This project is configured for Node.js 22.x. The server creates its SQLite data directory automatically on startup.
