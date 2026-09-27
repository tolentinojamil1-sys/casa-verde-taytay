let cfg = {}, cur = new Date();
cur.setDate(1);
let unavailable = new Set();
const $ = x => document.querySelector(x);
const fmt = n => `₱${Number(n).toLocaleString()}`;
const API = (window.CASA_VERDE_API_URL || '').replace(/\/$/, '');
function showMessage(message, kind = '') {
  const target = $('#msg');
  target.textContent = message;
  target.className = kind;
}
function showProofLinks(show) {
  const links = $('#proofLinks');
  if (links) links.hidden = !show;
}
function api(path) { return `${API}${path}`; }
function isoLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try { return await fetch(api(path), { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function load() {
  if (!API || API.includes('YOUR-BACKEND-NAME')) {
    showMessage('Website setup is incomplete: backend URL is not configured yet.', 'err');
    return;
  }
  try {
    const r = await apiFetch('/api/config');
    if (!r.ok) throw new Error('Booking service unavailable');
    cfg = await r.json();
    const sel = $('#guests');
    sel.innerHTML = '';
    for (let i = 1; i <= Number(cfg.max_guests); i++) {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = i + (i === 1 ? ' Guest' : ' Guests');
      if (i === Math.min(10, Number(cfg.max_guests))) o.selected = true;
      sel.append(o);
    }
    const today = isoLocal(new Date());
    $('#in').min = today;
    $('#out').min = today;
    calc();
    await renderCalendar();
  } catch (e) {
    showMessage('The booking service is waking up. Please wait a moment and refresh if needed.', 'err');
    renderCalendarShell();
  }
}
function calc() {
  const a = $('#in').value, b = $('#out').value;
  if (!a || !b) {
    $('#summary').textContent = 'Select dates to see your total balance.';
    return;
  }
  const nights = (new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000;
  if (nights < 1) {
    $('#summary').textContent = 'Check-out must be after check-in.';
    return;
  }
  const rate = Number(cfg.nightly_rate || 10000);
  const total = nights * rate;
  $('#summary').innerHTML = `<strong>Total Balance: ${fmt(total)} for ${nights} night${nights > 1 ? 's' : ''}</strong><br><small>${fmt(rate)} per night</small>`;
}
function renderCalendarShell() {
  const title = cur.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  $('#month').textContent = title;
  const firstDay = new Date(cur.getFullYear(), cur.getMonth(), 1).getDay();
  const days = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push('<div class="day empty"></div>');
  for (let d = 1; d <= days; d++) cells.push(`<div class="day">${d}</div>`);
  $('#cal').innerHTML = cells.join('');
}
async function renderCalendar() {
  renderCalendarShell();
  const from = isoLocal(new Date(cur.getFullYear(), cur.getMonth(), 1));
  const to = isoLocal(new Date(cur.getFullYear(), cur.getMonth() + 1, 1));
  try {
    const r = await apiFetch(`/api/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    if (!r.ok) return;
    const data = await r.json();
    unavailable = new Set();
    for (const b of data.booked || []) {
      let d = new Date(`${b.check_in}T00:00:00`);
      const end = new Date(`${b.check_out}T00:00:00`);
      while (d < end) { unavailable.add(isoLocal(d)); d.setDate(d.getDate() + 1); }
    }
    for (const b of data.blocked || []) unavailable.add(b.date);
    [...$('#cal').querySelectorAll('.day:not(.empty)')].forEach(el => {
      const date = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(el.textContent).padStart(2,'0')}`;
      el.classList.add(unavailable.has(date) ? 'booked' : 'available');
    });
  } catch (_) {}
}
$('#prev').onclick = async () => { cur.setMonth(cur.getMonth() - 1); await renderCalendar(); };
$('#next').onclick = async () => { cur.setMonth(cur.getMonth() + 1); await renderCalendar(); };
$('#in').onchange = () => {
  showProofLinks(false);
  if ($('#in').value) {
    const next = new Date(`${$('#in').value}T00:00:00`);
    next.setDate(next.getDate() + 1);
    $('#out').min = isoLocal(next);
    if ($('#out').value && $('#out').value < $('#out').min) $('#out').value = '';
  }
  calc();
};
$('#out').onchange = () => { showProofLinks(false); calc(); };
$('#form').onsubmit = async e => {
  e.preventDefault();
  const btn = e.submitter;
  showProofLinks(false);
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  showMessage('Checking availability and sending your reservation…');
  const body = {
    checkIn: $('#in').value,
    checkOut: $('#out').value,
    guests: Number($('#guests').value),
    name: $('#name').value.trim(),
    email: $('#email').value.trim(),
    phone: $('#phone').value.trim(),
    paymentMethod: $('#payment').value
  };
  try {
    const r = await apiFetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      if (j.checkoutUrl) {
        showMessage(`Reservation ${j.id} created! Total ${fmt(j.total)}. Opening secure payment…`, 'ok');
        window.location.href = j.checkoutUrl;
        return;
      }
      showMessage(`Reservation details sent! Booking ID: ${j.id}. Total ${fmt(j.total)}. Please send payment proof via Viber/WhatsApp to complete your booking.`, 'ok');
      showProofLinks(true);
      e.target.reset();
      calc();
      await renderCalendar();
    } else {
      showMessage(j.error || 'Could not create the reservation.', 'err');
    }
  } catch (err) {
    showMessage('The booking service did not respond in time. Please try again in a moment.', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Reserve now'; }
  }
};
const paymentParams = new URLSearchParams(window.location.search);
if (paymentParams.get('payment') === 'success') {
  const booking = paymentParams.get('booking') || '';
  showMessage(`Payment return received${booking ? ` for booking ${booking}` : ''}. Please contact Casa Verde to confirm your payment.`, 'ok');
  showProofLinks(true);
  document.querySelector('#booking')?.scrollIntoView({ behavior: 'smooth' });
} else if (paymentParams.get('payment') === 'cancelled') {
  const booking = paymentParams.get('booking') || '';
  showMessage(`Payment was not completed${booking ? ` for booking ${booking}` : ''}. Your reservation remains pending; contact Casa Verde to arrange payment.`, 'err');
  document.querySelector('#booking')?.scrollIntoView({ behavior: 'smooth' });
}
load();