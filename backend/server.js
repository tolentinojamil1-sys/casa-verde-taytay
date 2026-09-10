import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import nodemailer from 'nodemailer';
import cors from 'cors';
import Database from 'better-sqlite3';
import pg from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = Number(process.env.PORT || 3000);

const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
const usingPostgres = Boolean(process.env.DATABASE_URL);

const paymongoSecretKey = process.env.PAYMONGO_SECRET_KEY || '';
const paymongoWebhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET || '';

const gmailUser = process.env.GMAIL_USER || '';
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD || '';
const bookingNotificationEmail =
  process.env.BOOKING_NOTIFICATION_EMAIL || gmailUser;

const emailConfigured =
  Boolean(gmailUser && gmailAppPassword);

const mailTransporter = emailConfigured
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailAppPassword
      }
    })
  : null;

const paymongoMethods = (
  process.env.PAYMONGO_PAYMENT_METHODS ||
  'qrph,card,gcash,paymaya,dob,brankas'
)
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

const HOLD_MINUTES = 15;

console.log(
  'PayMongo configured:',
  Boolean(process.env.PAYMONGO_SECRET_KEY)
);

function paymongoAuth() {
  return `Basic ${Buffer.from(
    `${paymongoSecretKey}:`
  ).toString('base64')}`;
}

/* ------------------------------------------------------
   PAYMONGO SIGNATURE
------------------------------------------------------ */

function verifyPaymongoSignature(rawBody, signatureHeader) {
  if (!paymongoWebhookSecret || !signatureHeader) {
    return false;
  }

  const parts = Object.fromEntries(
    String(signatureHeader)
      .split(',')
      .map(part => {
        const i = part.indexOf('=');

        return i > 0
          ? [
              part.slice(0, i).trim(),
              part.slice(i + 1).trim()
            ]
          : ['', ''];
      })
      .filter(([k]) => k)
  );

  const timestamp = parts.t;

  const expectedSignature =
    paymongoSecretKey.startsWith('sk_live_')
      ? parts.li
      : parts.te;

  if (!timestamp || !expectedSignature) {
    return false;
  }

  const signedPayload =
    `${timestamp}.${rawBody.toString('utf8')}`;

  const computed = crypto
    .createHmac(
      'sha256',
      paymongoWebhookSecret
    )
    .update(signedPayload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

/* ------------------------------------------------------
   BASIC APP SETUP
------------------------------------------------------ */

app.set('trust proxy', 1);

app.use(
  cors({
    origin(origin, cb) {
      if (
        !origin ||
        !frontendUrl ||
        origin === frontendUrl
      ) {
        return cb(null, true);
      }

      return cb(
        new Error('Origin not allowed by CORS')
      );
    },

    credentials: true
  })
);

/* ------------------------------------------------------
   DATABASE
------------------------------------------------------ */

let pool = null;
let sqlite = null;

const PgSession = connectPgSimple(session);

if (usingPostgres) {
  pool = new Pool({
    connectionString:
      process.env.DATABASE_URL,

    ssl:
      process.env.DATABASE_SSL === 'false'
        ? false
        : {
            rejectUnauthorized: false
          }
  });
} else {
  const dataDir =
    path.join(__dirname, 'data');

  fs.mkdirSync(
    dataDir,
    {
      recursive: true
    }
  );

  sqlite = new Database(
    path.join(
      dataDir,
      'casa-verde.db'
    )
  );

  sqlite.pragma(
    'journal_mode = WAL'
  );
}

async function all(
  sqlPg,
  paramsPg = [],
  sqlLite = sqlPg,
  paramsLite = paramsPg
) {
  if (pool) {
    return (
      await pool.query(
        sqlPg,
        paramsPg
      )
    ).rows;
  }

  return sqlite
    .prepare(sqlLite)
    .all(...paramsLite);
}

async function one(
  sqlPg,
  paramsPg = [],
  sqlLite = sqlPg,
  paramsLite = paramsPg
) {
  if (pool) {
    return (
      await pool.query(
        sqlPg,
        paramsPg
      )
    ).rows[0];
  }

  return sqlite
    .prepare(sqlLite)
    .get(...paramsLite);
}

async function run(
  sqlPg,
  paramsPg = [],
  sqlLite = sqlPg,
  paramsLite = paramsPg
) {
  if (pool) {
    return pool.query(
      sqlPg,
      paramsPg
    );
  }

  return sqlite
    .prepare(sqlLite)
    .run(...paramsLite);
}

/* ------------------------------------------------------
   DATABASE INITIALIZATION
------------------------------------------------------ */

async function initDb() {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookings(
        id TEXT PRIMARY KEY,
        check_in DATE NOT NULL,
        check_out DATE NOT NULL,
        guests INTEGER NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        total INTEGER NOT NULL,
        payment_method TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        paymongo_checkout_id TEXT
      );

      CREATE TABLE IF NOT EXISTS blocked_dates(
        date DATE PRIMARY KEY,
        reason TEXT NOT NULL
      );
    `);

    await pool.query(`
      ALTER TABLE bookings
      ADD COLUMN IF NOT EXISTS
      paymongo_checkout_id TEXT
    `);

    const defaults = {
      nightly_rate: '10000',
      max_guests: '10',
      property_name:
        'Casa Verde Taytay'
    };

    for (
      const [key, value]
      of Object.entries(defaults)
    ) {
      await pool.query(
        `
        INSERT INTO settings(key,value)
        VALUES($1,$2)
        ON CONFLICT(key)
        DO NOTHING
        `,
        [key, value]
      );
    }
  } else {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS settings(
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookings(
        id TEXT PRIMARY KEY,
        check_in TEXT NOT NULL,
        check_out TEXT NOT NULL,
        guests INTEGER NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        total INTEGER NOT NULL,
        payment_method TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        paymongo_checkout_id TEXT
      );

      CREATE TABLE IF NOT EXISTS blocked_dates(
        date TEXT PRIMARY KEY,
        reason TEXT NOT NULL
      );
    `);

    const columns =
      sqlite.prepare(
        'PRAGMA table_info(bookings)'
      ).all();

    const hasCheckoutId =
      columns.some(
        x =>
          x.name ===
          'paymongo_checkout_id'
      );

    if (!hasCheckoutId) {
      sqlite.exec(`
        ALTER TABLE bookings
        ADD COLUMN
        paymongo_checkout_id TEXT
      `);
    }

    const defaults = {
      nightly_rate: '10000',
      max_guests: '10',
      property_name:
        'Casa Verde Taytay'
    };

    for (
      const [key, value]
      of Object.entries(defaults)
    ) {
      sqlite
        .prepare(`
          INSERT OR IGNORE
          INTO settings(key,value)
          VALUES(?,?)
        `)
        .run(key, value);
    }
  }
}

/* ------------------------------------------------------
   DATE HELPERS
------------------------------------------------------ */

function validDate(s) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(
      String(s || '')
    ) &&
    !Number.isNaN(
      new Date(
        `${s}T00:00:00`
      ).getTime()
    )
  );
}

function datesBetween(a, b) {
  const out = [];

  let d =
    new Date(
      `${a}T00:00:00`
    );

  const e =
    new Date(
      `${b}T00:00:00`
    );

  while (d < e) {
    out.push(
      d.toISOString().slice(0, 10)
    );

    d.setDate(
      d.getDate() + 1
    );
  }

  return out;
}

function holdCutoffDate() {
  return new Date(
    Date.now() -
      HOLD_MINUTES *
      60 *
      1000
  );
}

/* ------------------------------------------------------
   SETTINGS
------------------------------------------------------ */

async function settings() {
  const rows = await all(
    'SELECT key,value FROM settings',
    [],
    'SELECT key,value FROM settings',
    []
  );

  return Object.fromEntries(
    rows.map(
      x => [
        x.key,
        x.value
      ]
    )
  );
}

/* ------------------------------------------------------
   EMAIL HELPERS
------------------------------------------------------ */

function peso(amount) {
  return new Intl.NumberFormat(
    'en-PH',
    {
      style: 'currency',
      currency: 'PHP',
      maximumFractionDigits: 0
    }
  ).format(Number(amount || 0));
}

function safeText(value) {
  return String(value ?? '').trim();
}

async function sendPaidBookingEmails(booking) {
  if (!mailTransporter || !emailConfigured) {
    console.warn(
      'Booking email not sent: Gmail is not configured.'
    );
    return;
  }

  const bookingId = safeText(booking.id);
  const guestName = safeText(booking.name);
  const guestEmail = safeText(booking.email);
  const phone = safeText(booking.phone) || 'Not provided';
  const checkIn = safeText(booking.check_in);
  const checkOut = safeText(booking.check_out);
  const guests = safeText(booking.guests);
  const total = peso(booking.total);

  const guestSubject =
    `Booking Confirmed — Casa Verde Taytay (${bookingId})`;

  const guestText =
`Hi ${guestName},

Your Casa Verde Taytay reservation is confirmed and your payment has been received.

Booking ID: ${bookingId}
Check-in: ${checkIn}
Check-out: ${checkOut}
Guests: ${guests}
Total paid: ${total}
Status: Paid

Please keep your Booking ID for your records.

Thank you for choosing Casa Verde Taytay.`;

  const guestHtml = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#222;max-width:640px;margin:auto">
      <h2 style="margin-bottom:8px">Booking Confirmed</h2>
      <p>Hi ${guestName},</p>
      <p>Your <strong>Casa Verde Taytay</strong> reservation is confirmed and your payment has been received.</p>
      <table style="border-collapse:collapse;width:100%;margin:20px 0">
        <tr><td style="padding:8px;border-bottom:1px solid #ddd"><strong>Booking ID</strong></td><td style="padding:8px;border-bottom:1px solid #ddd">${bookingId}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #ddd"><strong>Check-in</strong></td><td style="padding:8px;border-bottom:1px solid #ddd">${checkIn}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #ddd"><strong>Check-out</strong></td><td style="padding:8px;border-bottom:1px solid #ddd">${checkOut}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #ddd"><strong>Guests</strong></td><td style="padding:8px;border-bottom:1px solid #ddd">${guests}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #ddd"><strong>Total paid</strong></td><td style="padding:8px;border-bottom:1px solid #ddd">${total}</td></tr>
        <tr><td style="padding:8px"><strong>Status</strong></td><td style="padding:8px"><strong>Paid</strong></td></tr>
      </table>
      <p>Please keep your Booking ID for your records.</p>
      <p>Thank you for choosing Casa Verde Taytay.</p>
    </div>
  `;

  const ownerSubject =
    `New Paid Booking — ${bookingId} — ${guestName}`;

  const ownerText =
`A new Casa Verde Taytay booking has been paid.

Booking ID: ${bookingId}
Guest: ${guestName}
Email: ${guestEmail}
Phone: ${phone}
Check-in: ${checkIn}
Check-out: ${checkOut}
Guests: ${guests}
Total paid: ${total}
Status: Paid`;

  const jobs = [];

  if (guestEmail) {
    jobs.push(
      mailTransporter.sendMail({
        from: `"Casa Verde Taytay" <${gmailUser}>`,
        to: guestEmail,
        subject: guestSubject,
        text: guestText,
        html: guestHtml
      })
    );
  }

  if (bookingNotificationEmail) {
    jobs.push(
      mailTransporter.sendMail({
        from: `"Casa Verde Taytay Website" <${gmailUser}>`,
        to: bookingNotificationEmail,
        subject: ownerSubject,
        text: ownerText
      })
    );
  }

  if (!jobs.length) {
    console.warn(
      `No email recipients for booking ${bookingId}`
    );
    return;
  }

  const results = await Promise.allSettled(jobs);

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(
        `Booking email ${index + 1} failed for ${bookingId}:`,
        result.reason
      );
    }
  });

  console.log(
    `Booking email processing completed for ${bookingId}`
  );
}

/* ------------------------------------------------------
   PAYMONGO CHECKOUT MANAGEMENT
------------------------------------------------------ */

async function expirePaymongoCheckout(
  checkoutId
) {
  if (
    !checkoutId ||
    !paymongoSecretKey
  ) {
    return false;
  }

  try {
    const response =
      await fetch(
        `https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(
          checkoutId
        )}/expire`,
        {
          method: 'POST',
          headers: {
            Authorization:
              paymongoAuth(),
            'Content-Type':
              'application/json'
          }
        }
      );

    if (response.ok) {
      console.log(
        `Expired PayMongo checkout ${checkoutId}`
      );

      return true;
    }

    const body =
      await response
        .json()
        .catch(
          () => ({})
        );

    console.warn(
      'Could not expire PayMongo checkout:',
      checkoutId,
      body
    );

    return false;
  } catch (e) {
    console.error(
      'PayMongo checkout expiration error:',
      e
    );

    return false;
  }
}

/* ------------------------------------------------------
   EXPIRE OLD PENDING BOOKINGS
------------------------------------------------------ */

async function cleanupExpiredPendingBookings() {
  const cutoff =
    holdCutoffDate();

  let expiredBookings;

  if (pool) {
    expiredBookings =
      await all(
        `
        SELECT
          id,
          paymongo_checkout_id,
          created_at
        FROM bookings
        WHERE
          status='pending'
          AND created_at < $1
        `,
        [cutoff.toISOString()]
      );
  } else {
    expiredBookings =
      await all(
        `
        SELECT
          id,
          paymongo_checkout_id,
          created_at
        FROM bookings
        WHERE
          status='pending'
          AND created_at < ?
        `,
        [
          cutoff.toISOString()
        ]
      );
  }

  for (
    const booking
    of expiredBookings
  ) {
    /*
      If the booking has a PayMongo
      checkout, expire it FIRST.

      We do not release the booking
      dates unless the old checkout
      is no longer usable.
    */

    if (
      booking.paymongo_checkout_id
    ) {
      const expired =
        await expirePaymongoCheckout(
          booking.paymongo_checkout_id
        );

      if (!expired) {
        continue;
      }
    }

    await run(
      `
      UPDATE bookings
      SET status='cancelled'
      WHERE
        id=$1
        AND status='pending'
      `,
      [booking.id],

      `
      UPDATE bookings
      SET status='cancelled'
      WHERE
        id=?
        AND status='pending'
      `,
      [booking.id]
    );

    console.log(
      `Expired pending reservation ${booking.id}`
    );
  }
}

/* ------------------------------------------------------
   CONFLICT CHECK
------------------------------------------------------ */

async function conflicts(a, b) {
  await cleanupExpiredPendingBookings();

  const ds =
    datesBetween(a, b);

  if (!ds.length) {
    return true;
  }

  const booking =
    await one(
      `
      SELECT 1
      FROM bookings
      WHERE
        status IN (
          'pending',
          'paid',
          'confirmed'
        )
        AND check_in < $1
        AND check_out > $2
      LIMIT 1
      `,
      [b, a],

      `
      SELECT 1
      FROM bookings
      WHERE
        status IN (
          'pending',
          'paid',
          'confirmed'
        )
        AND check_in < ?
        AND check_out > ?
      LIMIT 1
      `,
      [b, a]
    );

  if (booking) {
    return true;
  }

  if (pool) {
    const r =
      await pool.query(
        `
        SELECT
          date::text AS date
        FROM blocked_dates
        WHERE
          date = ANY($1::text[])
        `,
        [ds]
      );

    const blocked =
      new Set(
        r.rows.map(
          x => x.date
        )
      );

    return ds.some(
      x => blocked.has(x)
    );
  }

  const placeholders =
    ds.map(() => '?').join(',');

  const blocked =
    new Set(
      sqlite
        .prepare(
          `
          SELECT date
          FROM blocked_dates
          WHERE date IN (${placeholders})
          `
        )
        .all(...ds)
        .map(
          x => x.date
        )
    );

  return ds.some(
    x => blocked.has(x)
  );
}

/* ------------------------------------------------------
   PAYMONGO WEBHOOK
------------------------------------------------------ */

app.post(
  '/api/webhooks/paymongo',

  express.raw({
    type: 'application/json',
    limit: '250kb'
  }),

  async (req, res) => {
    try {
      if (
        !verifyPaymongoSignature(
          req.body,
          req.headers[
            'paymongo-signature'
          ]
        )
      ) {
        return res
          .status(401)
          .json({
            error:
              'Invalid webhook signature.'
          });
      }

      const event =
        JSON.parse(
          req.body.toString('utf8')
        );

      const eventType =
        event?.data?.attributes
          ?.type ||
        event?.data?.type;

      const sessionData =
        event?.data?.attributes
          ?.data ||
        event?.data?.data;

      if (
        eventType ===
        'checkout_session.payment.paid'
      ) {
        const ref =
          sessionData?.attributes
            ?.reference_number;

        if (ref) {
          const updateResult =
            await run(
              `
              UPDATE bookings
              SET status='paid'
              WHERE
                id=$1
                AND status NOT IN (
                  'cancelled',
                  'paid'
                )
              `,
              [ref],

              `
              UPDATE bookings
              SET status='paid'
              WHERE
                id=?
                AND status NOT IN (
                  'cancelled',
                  'paid'
                )
              `,
              [ref]
            );

          const changed =
            pool
              ? updateResult.rowCount > 0
              : updateResult.changes > 0;

          if (changed) {
            console.log(
              `Booking ${ref} marked paid`
            );

            const paidBooking =
              await one(
                `
                SELECT
                  id,
                  check_in::text AS check_in,
                  check_out::text AS check_out,
                  guests,
                  name,
                  email,
                  phone,
                  total,
                  status
                FROM bookings
                WHERE id=$1
                `,
                [ref],

                `
                SELECT
                  id,
                  check_in,
                  check_out,
                  guests,
                  name,
                  email,
                  phone,
                  total,
                  status
                FROM bookings
                WHERE id=?
                `,
                [ref]
              );

            if (paidBooking) {
              try {
                await sendPaidBookingEmails(
                  paidBooking
                );
              } catch (emailError) {
                console.error(
                  `Booking email error for ${ref}:`,
                  emailError
                );
              }
            }
          } else {
            console.log(
              `Booking ${ref} was already paid or cancelled; no duplicate email sent`
            );
          }
        }
      }

      return res
        .status(200)
        .json({
          received: true
        });

    } catch (e) {
      console.error(
        'PayMongo webhook error:',
        e
      );

      return res
        .status(400)
        .json({
          error:
            'Invalid webhook payload.'
        });
    }
  }
);

/* ------------------------------------------------------
   JSON + SESSION
------------------------------------------------------ */

app.use(
  express.json({
    limit: '100kb'
  })
);

const sessionOptions = {
  secret:
    process.env.SESSION_SECRET ||
    'dev-only-change-me',

  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true,

    secure:
      process.env.NODE_ENV ===
      'production',

    sameSite:
      process.env.NODE_ENV ===
      'production'
        ? 'none'
        : 'lax',

    maxAge:
      8 *
      60 *
      60 *
      1000
  }
};

if (pool) {
  sessionOptions.store =
    new PgSession({
      pool,
      tableName: 'user_sessions',
      createTableIfMissing: true
    });
}

app.use(
  session(sessionOptions)
);

/* ------------------------------------------------------
   HEALTH
------------------------------------------------------ */

app.get(
  '/health',
  (_req, res) =>
    res.json({
      ok: true,
      database:
        pool
          ? 'postgres'
          : 'sqlite',
      pending_hold_minutes:
        HOLD_MINUTES
    })
);

/* ------------------------------------------------------
   CONFIG
------------------------------------------------------ */

app.get(
  '/api/config',

  async (
    _req,
    res,
    next
  ) => {
    try {
      res.json(
        await settings()
      );
    } catch (e) {
      next(e);
    }
  }
);

/* ------------------------------------------------------
   AVAILABILITY
------------------------------------------------------ */

app.get(
  '/api/availability',

  async (
    req,
    res,
    next
  ) => {
    try {
      await cleanupExpiredPendingBookings();

      const today =
        new Date()
          .toISOString()
          .slice(0, 10);

      const later =
        new Date(
          Date.now() +
            120 *
            86400000
        )
          .toISOString()
          .slice(0, 10);

      const from =
        validDate(
          req.query.from
        )
          ? req.query.from
          : today;

      const to =
        validDate(
          req.query.to
        )
          ? req.query.to
          : later;

      const booked =
        await all(
          `
          SELECT
            check_in::text
              AS check_in,
            check_out::text
              AS check_out,
            status
          FROM bookings
          WHERE
            status IN (
              'pending',
              'paid',
              'confirmed'
            )
            AND check_out > $1
            AND check_in < $2
          `,
          [from, to],

          `
          SELECT
            check_in,
            check_out,
            status
          FROM bookings
          WHERE
            status IN (
              'pending',
              'paid',
              'confirmed'
            )
            AND check_out > ?
            AND check_in < ?
          `,
          [from, to]
        );

      const blocked =
        await all(
          `
          SELECT
            date::text AS date,
            reason
          FROM blocked_dates
          WHERE
            date >= $1
            AND date < $2
          `,
          [from, to],

          `
          SELECT
            date,
            reason
          FROM blocked_dates
          WHERE
            date >= ?
            AND date < ?
          `,
          [from, to]
        );

      res.json({
        booked,
        blocked
      });

    } catch (e) {
      next(e);
    }
  }
);

/* ------------------------------------------------------
   CREATE PAYMONGO CHECKOUT
------------------------------------------------------ */

async function createPaymongoCheckout(
  booking
) {
  if (!paymongoSecretKey) {
    return null;
  }

  const successUrl =
    `${frontendUrl}/?payment=success&booking=${encodeURIComponent(
      booking.id
    )}`;

  const cancelUrl =
    `${frontendUrl}/?payment=cancelled&booking=${encodeURIComponent(
      booking.id
    )}`;

  const response =
    await fetch(
      'https://api.paymongo.com/v2/checkout_sessions',
      {
        method: 'POST',

        headers: {
          Authorization:
            paymongoAuth(),

          'Content-Type':
            'application/json',

          'Idempotency-Key':
            `casa-verde-${booking.id}`
        },

        body: JSON.stringify({
          data: {
            attributes: {
              line_items: [
                {
                  name:
                    `Casa Verde Taytay — ${booking.nights} night${
                      booking.nights === 1
                        ? ''
                        : 's'
                    }`,

                  description:
                    `${booking.checkIn} to ${booking.checkOut} · ${booking.guests} guest${
                      booking.guests === 1
                        ? ''
                        : 's'
                    }`,

                  amount:
                    Math.round(
                      Number(
                        booking.total
                      ) * 100
                    ),

                  currency: 'PHP',
                  quantity: 1
                }
              ],

              payment_method_types:
                paymongoMethods,

              success_url:
                successUrl,

              cancel_url:
                cancelUrl,

              reference_number:
                booking.id,

              description:
                `Casa Verde Taytay reservation ${booking.id}`,

              billing: {
                name:
                  booking.name,

                email:
                  booking.email,

                phone:
                  booking.phone
              },

              send_email_receipt:
                true,

              show_description:
                true,

              show_line_items:
                true
            }
          }
        })
      }
    );

  const body =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    console.error(
      'PayMongo checkout creation failed:',
      body
    );

    throw new Error(
      body?.errors?.[0]?.detail ||
      'Unable to start secure payment checkout.'
    );
  }

  return {
    id:
      body?.data?.id,

    url:
      body?.data?.attributes
        ?.checkout_url
  };
}

/* ------------------------------------------------------
   CREATE BOOKING
------------------------------------------------------ */

app.post(
  '/api/bookings',

  async (
    req,
    res,
    next
  ) => {
    try {
      await cleanupExpiredPendingBookings();

      const {
        checkIn,
        checkOut,
        guests,
        name,
        email,
        phone,
        paymentMethod
      } =
        req.body || {};

      const s =
        await settings();

      if (
        !validDate(
          checkIn
        ) ||
        !validDate(
          checkOut
        ) ||
        !name?.trim() ||
        !email?.trim() ||
        !phone?.trim()
      ) {
        return res
          .status(400)
          .json({
            error:
              'Please complete all required fields.'
          });
      }

      const guestCount =
        Number(guests);

      if (
        !Number.isInteger(
          guestCount
        ) ||
        guestCount < 1 ||
        guestCount >
          Number(
            s.max_guests
          )
      ) {
        return res
          .status(400)
          .json({
            error:
              `Maximum guests: ${s.max_guests}.`
          });
      }

      const nights =
        datesBetween(
          checkIn,
          checkOut
        ).length;

      if (nights < 1) {
        return res
          .status(400)
          .json({
            error:
              'Check-out must be after check-in.'
          });
      }

      if (
        await conflicts(
          checkIn,
          checkOut
        )
      ) {
        return res
          .status(409)
          .json({
            error:
              'Those dates are not available.'
          });
      }

      const total =
        nights *
        Number(
          s.nightly_rate
        );

      const id =
        'CV-' +
        crypto
          .randomBytes(4)
          .toString('hex')
          .toUpperCase();

      const createdAt =
        new Date()
          .toISOString();

      const method =
        [
          'online',
          'gcash',
          'bdo'
        ].includes(
          paymentMethod
        )
          ? paymentMethod
          : 'online';

      await run(
        `
        INSERT INTO bookings(
          id,
          check_in,
          check_out,
          guests,
          name,
          email,
          phone,
          total,
          payment_method,
          status,
          created_at,
          paymongo_checkout_id
        )
        VALUES(
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,$10,$11,$12
        )
        `,
        [
          id,
          checkIn,
          checkOut,
          guestCount,
          name.trim(),
          email.trim(),
          phone.trim(),
          total,
          method,
          'pending',
          createdAt,
          null
        ],

        `
        INSERT INTO bookings(
          id,
          check_in,
          check_out,
          guests,
          name,
          email,
          phone,
          total,
          payment_method,
          status,
          created_at,
          paymongo_checkout_id
        )
        VALUES(
          ?,?,?,?,?,?,?,?,?,?,?,?
        )
        `,
        [
          id,
          checkIn,
          checkOut,
          guestCount,
          name.trim(),
          email.trim(),
          phone.trim(),
          total,
          method,
          'pending',
          createdAt,
          null
        ]
      );

      let checkout = null;

      if (
        method === 'online'
      ) {
        try {
          checkout =
            await createPaymongoCheckout(
              {
                id,
                total,
                nights,
                checkIn,
                checkOut,
                guests:
                  guestCount,
                name:
                  name.trim(),
                email:
                  email.trim(),
                phone:
                  phone.trim()
              }
            );

          if (
            checkout?.id
          ) {
            await run(
              `
              UPDATE bookings
              SET
                paymongo_checkout_id=$1
              WHERE id=$2
              `,
              [
                checkout.id,
                id
              ],

              `
              UPDATE bookings
              SET
                paymongo_checkout_id=?
              WHERE id=?
              `,
              [
                checkout.id,
                id
              ]
            );
          }

        } catch (
          paymentError
        ) {
          console.error(
            paymentError
          );

          /*
            If checkout creation fails,
            cancel the reservation so
            dates are not held forever.
          */

          await run(
            `
            UPDATE bookings
            SET status='cancelled'
            WHERE id=$1
            `,
            [id],

            `
            UPDATE bookings
            SET status='cancelled'
            WHERE id=?
            `,
            [id]
          );

          return res
            .status(502)
            .json({
              error:
                'Unable to start secure payment. Please try again.'
            });
        }
      }

      res
        .status(201)
        .json({
          id,
          total,
          nights,
          status:
            'pending',

          holdMinutes:
            HOLD_MINUTES,

          checkoutUrl:
            checkout?.url ||
            null,

          paymentConfigured:
            Boolean(
              paymongoSecretKey
            ),

          message:
            checkout?.url
              ? `Reservation created. Complete payment within ${HOLD_MINUTES} minutes.`
              : 'Reservation created. Online payment is not configured yet; contact Casa Verde to pay manually.'
        });

    } catch (e) {
      next(e);
    }
  }
);

/* ------------------------------------------------------
   GET BOOKING
------------------------------------------------------ */

app.get(
  '/api/booking/:id',

  async (
    req,
    res,
    next
  ) => {
    try {
      await cleanupExpiredPendingBookings();

      const b =
        await one(
          `
          SELECT
            id,
            check_in::text AS check_in,
            check_out::text AS check_out,
            guests,
            name,
            email,
            phone,
            total,
            payment_method,
            status,
            created_at
          FROM bookings
          WHERE id=$1
          `,
          [
            req.params.id
          ],

          `
          SELECT
            id,
            check_in,
            check_out,
            guests,
            name,
            email,
            phone,
            total,
            payment_method,
            status,
            created_at
          FROM bookings
          WHERE id=?
          `,
          [
            req.params.id
          ]
        );

      if (!b) {
        return res
          .status(404)
          .json({
            error:
              'Booking not found'
          });
      }

      res.json(b);

    } catch (e) {
      next(e);
    }
  }
);

/* ------------------------------------------------------
   ADMIN AUTH
------------------------------------------------------ */

function auth(
  req,
  res,
  next
) {
  if (
    req.session.admin
  ) {
    return next();
  }

  res
    .status(401)
    .json({
      error:
        'Admin login required.'
    });
}

app.post(
  '/api/admin/login',

  (req, res) => {
    const configured =
      process.env.ADMIN_EMAIL &&
      process.env.ADMIN_PASSWORD;

    if (
      configured &&
      req.body.email ===
        process.env.ADMIN_EMAIL &&
      req.body.password ===
        process.env.ADMIN_PASSWORD
    ) {
      req.session.admin =
        true;

      return res.json({
        ok: true
      });
    }

    res
      .status(401)
      .json({
        error:
          'Invalid login.'
      });
  }
);

app.post(
  '/api/admin/logout',

  (req, res) =>
    req.session.destroy(
      () =>
        res.json({
          ok: true
        })
    )
);

/* ------------------------------------------------------
   ADMIN BOOKINGS
------------------------------------------------------ */

app.get(
  '/api/admin/bookings',

  auth,

  async (
    _req,
    res,
    next
  ) => {
    try {
      await cleanupExpiredPendingBookings();

      const rows =
        await all(
          `
          SELECT
            id,
            check_in::text AS check_in,
            check_out::text AS check_out,
            guests,
            name,
            email,
            phone,
            total,
            payment_method,
            status,
            created_at
          FROM bookings
          ORDER BY check_in ASC
          `,
          [],

          `
          SELECT *
          FROM bookings
          ORDER BY check_in ASC
          `,
          []
        );

      res.json(rows);

    } catch (e) {
      next(e);
    }
  }
);

/* ------------------------------------------------------
   ADMIN BLOCK DATE
------------------------------------------------------ */

app.post(
  '/api/admin/block',

  auth,

  async (
    req,
    res,
    next
  ) => {
    try {
      const {
        date,
        reason = 'Blocked'
      } =
        req.body || {};

      if (
        !validDate(date)
      ) {
        return res
          .status(400)
          .json({
            error:
              'Valid date required'
          });
      }

      await run(
        `
        INSERT INTO blocked_dates(
          date,
          reason
        )
        VALUES($1,$2)
        ON CONFLICT(date)
        DO UPDATE SET
          reason=EXCLUDED.reason
        `,
        [
          date,
          reason ||
            'Blocked'
        ],

        `
        INSERT OR REPLACE
        INTO blocked_dates(
          date,
          reason
        )
        VALUES(?,?)
        `,
        [
          date,
          reason ||
            'Blocked'
        ]
      );

      res.json({
        ok: true
      });

    } catch (e) {
      next(e);
    }
  }
);

/* ------------------------------------------------------
   DELETE BLOCKED DATE
------------------------------------------------------ */

app.delete(
  '/api/admin/block/:date',

  auth,

  async (
    req,
    res,
    next
  ) => {
    try {
      await run(
        `
        DELETE FROM blocked_dates
        WHERE date=$1
        `,
        [
          req.params.date
        ],

        `
        DELETE FROM blocked_dates
        WHERE date=?
        `,
        [
          req.params.date
        ]
      );

      res.json({
        ok: true
      });

    } catch (e) {
      next(e);
    }
  }
);

/* ------------------------------------------------------
   ADMIN BOOKING STATUS
------------------------------------------------------ */

app.post(
  '/api/admin/booking-status',

  auth,

  async (
    req,
    res,
    next
  ) => {
    try {
      const {
        id,
        status
      } =
        req.body || {};

      if (
        ![
          'pending',
          'paid',
          'confirmed',
          'cancelled'
        ].includes(status)
      ) {
        return res
          .status(400)
          .json({
            error:
              'Invalid status'
          });
      }

      const booking =
        await one(
          `
          SELECT
            id,
            status,
            paymongo_checkout_id
          FROM bookings
          WHERE id=$1
          `,
          [id],

          `
          SELECT
            id,
            status,
            paymongo_checkout_id
          FROM bookings
          WHERE id=?
          `,
          [id]
        );

      if (!booking) {
        return res
          .status(404)
          .json({
            error:
              'Booking not found'
          });
      }

      /*
        If an admin cancels a
        pending booking, expire
        its PayMongo checkout first.
      */

      if (
        status ===
          'cancelled' &&
        booking.status ===
          'pending' &&
        booking
          .paymongo_checkout_id
      ) {
        const expired =
          await expirePaymongoCheckout(
            booking
              .paymongo_checkout_id
          );

        if (!expired) {
          return res
            .status(502)
            .json({
              error:
                'Could not safely expire the active payment checkout. Booking was not cancelled.'
            });
        }
      }

      await run(
        `
        UPDATE bookings
        SET status=$1
        WHERE id=$2
        `,
        [
          status,
          id
        ],

        `
        UPDATE bookings
        SET status=?
        WHERE id=?
        `,
        [
          status,
          id
        ]
      );

      res.json({
        ok: true
      });

    } catch (e) {
      next(e);
    }
  }
);

/* ------------------------------------------------------
   SETTINGS
------------------------------------------------------ */

app.post(
  '/api/admin/settings',

  auth,

  async (
    req,
    res,
    next
  ) => {
    try {
      for (
        const [k, v]
        of Object.entries(
          req.body || {}
        )
      ) {
        if (
          ![
            'nightly_rate',
            'max_guests'
          ].includes(k)
        ) {
          continue;
        }

        const n =
          Number(v);

        if (
          !Number.isFinite(n) ||
          n <= 0
        ) {
          continue;
        }

        await run(
          `
          INSERT INTO settings(
            key,
            value
          )
          VALUES($1,$2)
          ON CONFLICT(key)
          DO UPDATE SET
            value=EXCLUDED.value
          `,
          [
            k,
            String(
              Math.floor(n)
            )
          ],

          `
          INSERT OR REPLACE
          INTO settings(
            key,
            value
          )
          VALUES(?,?)
          `,
          [
            k,
            String(
              Math.floor(n)
            )
          ]
        );
      }

      res.json(
        await settings()
      );

    } catch (e) {
      next(e);
    }
  }
);

/* ------------------------------------------------------
   ERROR HANDLER
------------------------------------------------------ */

app.use(
  (
    err,
    _req,
    res,
    _next
  ) => {
    console.error(err);

    res
      .status(500)
      .json({
        error:
          'Server error. Please try again.'
      });
  }
);

/* ------------------------------------------------------
   START SERVER
------------------------------------------------------ */

await initDb();

app.listen(
  port,
  '0.0.0.0',

  () => {
    console.log(
      `Casa Verde API running on port ${port} using ${
        pool
          ? 'PostgreSQL'
          : 'SQLite'
      }`
    );

    console.log(
      `Pending reservation hold: ${HOLD_MINUTES} minutes`
    );

    console.log(
      'Booking email configured:',
      emailConfigured
    );

    if (!pool) {
      console.warn(
        'WARNING: SQLite is not persistent on a free Render Web Service. Set DATABASE_URL for production.'
      );
    }
  }
);
