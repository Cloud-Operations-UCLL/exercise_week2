const openList = document.getElementById('open-list');
const resolvedList = document.getElementById('resolved-list');
const openEmpty = document.getElementById('open-empty');
const openCount = document.getElementById('open-count');
const form = document.getElementById('ticket-form');
const formError = document.getElementById('form-error');
const statusEl = document.getElementById('status');

function timeAgo(iso) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return `${Math.floor(seconds / 3600)} h ago`;
}

function renderTicket(ticket) {
  const li = document.createElement('li');
  const who = document.createElement('strong');
  who.textContent = ticket.student;
  const when = document.createElement('span');
  when.className = 'muted';
  when.textContent = ` ${timeAgo(ticket.created_at)}`;
  const question = document.createElement('p');
  question.textContent = ticket.question;
  li.append(who, when, question);

  if (ticket.status === 'open') {
    const button = document.createElement('button');
    button.textContent = 'Helped';
    button.className = 'secondary';
    button.addEventListener('click', async () => {
      button.disabled = true;
      await fetch(`api/tickets/${ticket.id}/resolve`, { method: 'POST' });
      refresh();
    });
    li.append(button);
  }
  return li;
}

async function refresh() {
  try {
    const [infoRes, ticketsRes] = await Promise.all([fetch('api/info'), fetch('api/tickets')]);
    const info = await infoRes.json();
    document.getElementById('hostname').textContent = info.hostname;
    document.getElementById('version').textContent = info.version;
    document.getElementById('title').textContent = info.title;
    document.title = info.title;

    if (!ticketsRes.ok) throw new Error(`API returned ${ticketsRes.status}`);
    const tickets = await ticketsRes.json();
    const open = tickets.filter((t) => t.status === 'open');
    const resolved = tickets
      .filter((t) => t.status === 'resolved')
      .sort((a, b) => new Date(b.resolved_at) - new Date(a.resolved_at))
      .slice(0, 10);

    openList.replaceChildren(...open.map(renderTicket));
    resolvedList.replaceChildren(...resolved.map(renderTicket));
    openEmpty.hidden = open.length > 0;
    openCount.textContent = open.length;
    statusEl.textContent = '';
  } catch (err) {
    statusEl.textContent = `Cannot reach the API: ${err.message}`;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  const data = Object.fromEntries(new FormData(form));
  const res = await fetch('api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    formError.textContent = body.error || `Something went wrong (${res.status})`;
    formError.hidden = false;
    return;
  }
  form.reset();
  refresh();
});

refresh();
setInterval(refresh, 5000);
