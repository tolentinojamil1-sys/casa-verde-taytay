# Casa Verde Taytay — split free-hosting version

This version separates the public website from the Node/Express booking API.

## Why this removes the Render loading page

- `frontend/` is deployed as a **Render Static Site**. Static Sites are served from Render's CDN and do not spin down like a Free Web Service.
- `backend/` remains a **Render Free Web Service**. It can still sleep after inactivity, but guests no longer navigate directly to it. The website loads immediately and calls the backend with `fetch()` in the background.
- If the backend is asleep, the guest stays on the Casa Verde website and sees a Casa Verde message such as “Connecting to the booking service…” instead of Render's “Application loading / Service waking up” page.

## Important database change

The backend supports PostgreSQL through `DATABASE_URL`. Use this for real bookings. If `DATABASE_URL` is missing, the backend falls back to SQLite for local testing, but SQLite is NOT safe on Render Free because its local disk is ephemeral.

A free serverless PostgreSQL provider such as Neon is suitable for testing/small early usage. Copy its PostgreSQL connection string into `DATABASE_URL` in Render.

---

# Deploy — exact order

## 1. Put this project on GitHub

Upload the contents of this folder to a GitHub repository. Keep the `frontend` and `backend` folders exactly as they are.

## 2. Create the database

Create a PostgreSQL database and copy its connection string. It normally begins with:

`postgresql://...`

You do NOT need to create tables manually. The backend creates its required tables on first start.

## 3. Create the backend on Render

Render Dashboard → **New** → **Web Service** → connect your GitHub repository.

Use:

- Root Directory: `backend`
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Compute plan: Free
- Health Check Path: `/health`

Add these Environment Variables:

- `ADMIN_EMAIL` = your admin email
- `ADMIN_PASSWORD` = a strong password
- `SESSION_SECRET` = a long random string
- `DATABASE_URL` = your PostgreSQL connection string
- `DATABASE_SSL` = `true`
- `NODE_ENV` = `production`

For now leave `FRONTEND_URL` blank until step 5.

Deploy the backend. Copy its URL, for example:

`https://casa-verde-api.onrender.com`

## 4. Put the backend URL in the frontend

Open:

`frontend/config.js`

Change:

`window.CASA_VERDE_API_URL = 'https://YOUR-BACKEND-NAME.onrender.com';`

to your real backend URL. Commit/push the change to GitHub.

## 5. Create the frontend on Render

Render Dashboard → **New** → **Static Site** → select the same GitHub repository.

Use:

- Root Directory: `frontend`
- Build Command: leave blank (or use `echo ready` if Render requires one)
- Publish Directory: `.`

Deploy it. Copy the Static Site URL, for example:

`https://casa-verde-taytay.onrender.com`

## 6. Set FRONTEND_URL on the backend

Go back to the backend Web Service → Environment.

Set:

`FRONTEND_URL=https://casa-verde-taytay.onrender.com`

Use your exact Static Site URL with no trailing slash.

Save/redeploy the backend.

## 7. Test

Open the Static Site URL, not the backend URL.

Test:

1. Main page opens immediately.
2. Availability calendar loads.
3. Create a test reservation.
4. Open `/admin.html` on the Static Site and sign in.
5. Confirm/cancel the test reservation.
6. Restart/redeploy the backend and verify the reservation still exists (this confirms PostgreSQL persistence).

---

# What changed from your old project

- Static frontend no longer depends on Express to render the website.
- All frontend API calls use the backend URL from `frontend/config.js`.
- Backend CORS is restricted to your `FRONTEND_URL`.
- Admin requests include credentials so login sessions work across frontend/backend origins.
- PostgreSQL support added for persistent bookings.
- SQLite remains only as a local-development fallback.
- Calendar rendering was completed and booked/blocked dates are marked.
- Guest booking button now shows a friendly “connecting” state while a sleeping free backend wakes up.
- Payment webhook is intentionally disabled until a real provider with signature verification is configured.

# Local development

Backend:

```bash
cd backend
npm install
cp .env.example .env
npm start
```

For local frontend testing, set `frontend/config.js` to:

`window.CASA_VERDE_API_URL = 'http://localhost:3000';`

Then serve the `frontend` folder with any static web server.

# Security note

Do not commit a real `.env` file, database password, admin password, payment secret, or API key to GitHub. Use Render Environment Variables instead.
\n\n---\n\n# Secure online payments (PayMongo)\n\nThis version now includes a **Pay Securely Online** flow using PayMongo Hosted Checkout. The guest does **not** enter banking passwords, card numbers, or CVC directly into Casa Verde's own server. The website creates a booking, then redirects the guest to PayMongo's secure checkout. PayMongo can offer the payment channels enabled on your merchant account, including Philippine online banking, GCash, Maya, QR Ph, and Visa/Mastercard.\n\n## Payment setup\n\n1. Create/activate a PayMongo merchant account and complete the required business/KYC review.\n2. In **test mode**, copy your `sk_test_...` key from PayMongo Developer settings.\n3. In Render → backend → Environment, add:\n   - `PAYMONGO_SECRET_KEY=sk_test_...`\n   - `PAYMONGO_PAYMENT_METHODS=qrph,card,gcash,paymaya,dob,brankas`\n   Only keep channels that PayMongo shows as activated for your account.\n4. Deploy the backend and test a booking. The guest should be redirected to PayMongo Hosted Checkout.\n5. In PayMongo → Developers → Webhooks, add this endpoint:\n   `https://YOUR-BACKEND-NAME.onrender.com/api/webhooks/paymongo`\n6. Subscribe to **`checkout_session.payment.paid`**. Copy the webhook signing secret (`whsk_...`) and add it to Render as `PAYMONGO_WEBHOOK_SECRET`. Redeploy.\n7. Test again. When PayMongo sends a valid signed paid event, the matching booking status changes from `pending` to `paid` automatically.\n8. Only after test mode works, replace the test API key/webhook with your approved live credentials.\n\n**Important:** Do not put `PAYMONGO_SECRET_KEY` or `PAYMONGO_WEBHOOK_SECRET` in `frontend/config.js`, HTML, GitHub, or any public file. They belong only in Render backend Environment Variables.\n\n## How money reaches you\n\nThe guest pays PayMongo, and PayMongo settles eligible funds to the payout/settlement account configured on your merchant account, subject to PayMongo's settlement schedule, fees, account approval, and payment-method rules. Casa Verde does not need to collect a guest's bank login credentials.\n\n## Recommended launch improvements\n\nBefore public launch, also consider:\n\n- Add Terms & Conditions, cancellation/refund policy, privacy notice, and check-in/house rules.\n- Add email confirmation for new reservations, successful payment, cancellation, and upcoming stay reminders.\n- Add a pending-booking expiry (for example 20–30 minutes) so an unpaid booking does not hold dates forever.\n- Add minimum/maximum stay rules and optional cleaning/add-on fees if needed.\n- Add automated admin notifications for new booking/payment.\n- Add basic bot/rate-limit protection to login and booking endpoints.\n- Add a real custom domain and HTTPS before launch.\n- Test the full booking/payment/refund process in PayMongo test mode before accepting real money.\n