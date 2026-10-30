# Casa Verde Booking v2 — GitHub Pages + Supabase (NO Render)
This version lives in `booking-v2/` so the existing Casa Verde website and Render setup remain untouched until verified.

## Setup (mobile Safari works)
1. Create a Supabase project at https://supabase.com/dashboard. Supabase's Free plan has project inactivity/usage limits.
2. Open SQL Editor; paste the full contents of `booking-v2/schema.sql` and run it.
3. Open Authentication → Users → Add User. Create an admin user with a strong password (do not share it).
4. In SQL Editor run:
   `insert into public.cv_admins(user_id) select id from auth.users where email = 'YOUR-ADMIN-EMAIL@example.com';`
   Replace the email with the admin email you just created. Confirm that one row is inserted.
5. Open Project Settings → API (or Connect/API Keys), copy project URL and **publishable/anon** key.
6. Edit `booking-v2/config.js` in GitHub, put the URL and publishable/anon key. This key is intentionally public; do **not** paste secret/service_role keys.
7. Enable GitHub Pages publishing from branch main / root (only if it does not disrupt the existing live domain). Your test site is `https://<github-username>.github.io/<repo>/booking-v2/` for project Pages. If the custom domain points at this repository and the Pages root is enabled, `https://casaverdetaytay.com/booking-v2/` may be available instead.
8. Test admin sign-in, manual block, guest request, double-book rejection, admin approve/cancel, calendar refresh. Use non-real guest info for tests and remove test reservations before launch.
9. Once verified, migrate the public site's booking links. Do not delete existing backend or historical reservation data until you export and migrate the original bookings and blocked dates.

### Security and operations
- Only the `cv_admins` allowlist can read personal booking details or alter status and date blocks; protected by SECURITY DEFINER functions and SQL permissions.
- Public users can request a booking and see booked date ranges; no contact details are publicly readable.
- Concurrent reservation creation is serialized using a PostgreSQL advisory transaction lock to prevent overlapping requests for the single property.
- Pending bookings also hold dates; admin may cancel to free them.
- This starter does NOT include email notifications, payment verification, automatic expiry, spam protection, rate limits, or data migration. Implement those before heavy public use.
- Restrict guest access with CAPTCHA/rate limiting (e.g. Supabase Edge Function + Turnstile) before production to limit spam and malicious pending-date blocking.
- Never publish personally identifying booking data or admin passwords in the repo.
- Check Philippine privacy obligations when collecting customer names, emails and phone numbers.
