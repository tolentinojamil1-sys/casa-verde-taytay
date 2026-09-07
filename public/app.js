let cfg = {}, cur = new Date();
cur.setDate(1);
let unavailable = new Set();
const $ = x => document.querySelector(x);
const fmt = n => `₱${Number(n).toLocaleString()}`;

async function load() {
  cfg = await (await fetch('/api/config')).json();
  const sel = $('#guests');
  sel.innerHTML = '';
  for (let i = 1; i <= Number(cfg.max_guests); i++) {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = i + (i === 1 ? ' Guest' : ' Guests');
    if (i === 10) o.selected = true;
    sel.append(o);
  }
  // set min dates to today
  const today = new Date().toISOString().slice(0, 10);
  $('#in').min = today;
  $('#out').min = today;
  calc();
}

function calc() {
  const a = $('#in').value, b = $('#out').value;
  if (!a || !b) {
    $('#summary').textContent = 'Select dates to see your total.';
    return;
  }
  const nights = (new Date(b) - new Date(a)) / 86400000;
  if (nights < 1) {
    $('#summary').textContent = 'Check-out must be after check-in.';
    return;
  }
  const total = nights * Number(cfg.nightly_rate || 10000);
  $('#summary').innerHTML = `<b>${nights} night${nights > 1 ? 's' : ''}</b> · ${fmt(total)} total · ${fmt(cfg.nightly_rate)}/night`;
}

$('#in').onchange = () => {
  if ($('#in').value) {
    const next = new Date($('#in').value);
    next.setDate(next.getDate() + 1);
    $('#out').min = next.toISOString().slice(0, 10);
  }
  calc();
};
$('#out').onchange = calc;

$('#form').onsubmit = async e => {
  e.preventDefault();
  const body = {
    checkIn: $('#in').value,
    checkOut: $('#out').value,
    guests: Number($('#guests').value),
    name: $('#name').value,
    email: $('#email').value,
    phone: $('#phone').value,
    paymentMethod: $('#payment').value
  };
  const r = await fetch('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (r.ok) {
    $('#msg').innerHTML = `<span class="ok">Reservation ${j.id} created! Total ${fmt(j.total)}. Please send payment via GCash or BDO and include your booking ID with the proof.</span>`;
    e.target.reset();
    calc();
  } else {
    $('#msg').innerHTML = `<span class="err">${j.error}</span>`;
  }
};

load();
