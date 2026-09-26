const $ = selector => document.querySelector(selector);

async function request(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function cell(row, value) {
  const td = document.createElement('td');
  td.textContent = String(value ?? '');
  row.append(td);
}

async function setStatus(id, status) {
  try {
    await request('/api/admin/booking-status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status })
    });
    await load();
  } catch (error) { $('#panel-msg').textContent = error.message; }
}

function renderBookings(bookings) {
  const table = document.createElement('table');
  const header = document.createElement('tr');
  for (const title of ['Booking ID', 'Guest', 'Dates', 'Total', 'Status', 'Actions']) {
    const th = document.createElement('th');
    th.textContent = title;
    header.append(th);
  }
  table.append(header);
  for (const booking of bookings) {
    const row = document.createElement('tr');
    cell(row, booking.id);
    cell(row, booking.name);
    cell(row, `${booking.check_in} → ${booking.check_out}`);
    cell(row, `₱${Number(booking.total).toLocaleString()}`);
    cell(row, booking.status);
    const actions = document.createElement('td');
    for (const status of ['confirmed', 'cancelled']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = status === 'confirmed' ? 'Confirm' : 'Cancel';
      button.addEventListener('click', () => setStatus(booking.id, status));
      actions.append(button, ' ');
    }
    row.append(actions);
    table.append(row);
  }
  $('#table').replaceChildren(table);
}

async function load() {
  try {
    const bookings = await request('/api/admin/bookings');
    $('#login').hidden = true;
    $('#panel').hidden = false;
    renderBookings(bookings);
  } catch (error) {
    if (error.message !== 'Admin login required.') $('#msg').textContent = error.message;
  }
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await request('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#email').value, password: $('#password').value })
    });
    $('#password').value = '';
    $('#msg').textContent = '';
    await load();
  } catch (error) { $('#msg').textContent = error.message; }
});

$('#block-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await request('/api/admin/block', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: $('#date').value, reason: $('#reason').value })
    });
    $('#panel-msg').textContent = 'Date blocked.';
    await load();
  } catch (error) { $('#panel-msg').textContent = error.message; }
});

$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await request('/api/admin/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nightly_rate: $('#rate').value, max_guests: $('#max').value })
    });
    $('#panel-msg').textContent = 'Settings saved.';
  } catch (error) { $('#panel-msg').textContent = error.message; }
});

$('#logout').addEventListener('click', async () => {
  await request('/api/admin/logout', { method: 'POST' });
  location.reload();
});

load();
