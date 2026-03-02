const API = window.location.port === '3000' ? '' : 'http://localhost:3000';
const token = localStorage.getItem('token');
const role = localStorage.getItem('role');
if (!token) window.location.href = 'login.html';

const state = { assets: [] };

function setStatus(msg, type = 'ok') {
  const el = document.getElementById('pageStatus');
  el.textContent = msg || '';
  el.className = `status ${type}`;
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Erreur API (${res.status})`);
  return data;
}

function money(v) {
  return `${Number(v || 0).toLocaleString('fr-FR')} AED`;
}

function badgeClass(status) {
  if (status === 'funded') return 'funded';
  if (status === 'funding_in_progress') return 'review';
  if (status === 'pending') return 'pending';
  return 'approved';
}

function currentFilters() {
  return {
    query: document.getElementById('searchInput').value.trim().toLowerCase(),
    category: document.getElementById('categoryFilter').value,
    status: document.getElementById('statusFilter').value,
    minScore: Number(document.getElementById('minScore').value),
    sortBy: document.getElementById('sortBy').value
  };
}

function applyFilters() {
  const f = currentFilters();
  let rows = [...state.assets];

  if (f.query) rows = rows.filter((a) => `${a.reference} ${a.title} ${a.quartier}`.toLowerCase().includes(f.query));
  if (f.category) rows = rows.filter((a) => a.category === f.category);
  if (f.status) rows = rows.filter((a) => a.status === f.status);
  if (!Number.isNaN(f.minScore)) rows = rows.filter((a) => Number(a.score) >= f.minScore);

  rows.sort((a, b) => {
    if (f.sortBy === 'score-asc') return a.score - b.score;
    if (f.sortBy === 'score-desc') return b.score - a.score;
    if (f.sortBy === 'funded-asc') return a.fundedPct - b.fundedPct;
    if (f.sortBy === 'funded-desc') return b.fundedPct - a.fundedPct;
    if (f.sortBy === 'price-asc') return a.prix - b.prix;
    return b.prix - a.prix;
  });

  render(rows);
}

function render(assets) {
  const root = document.getElementById('assetGrid');
  if (!assets.length) {
    root.innerHTML = '<p class="small">Aucun actif trouvé.</p>';
    return;
  }

  root.innerHTML = assets
    .map((a) => {
      const soldOut = a.fundedPct >= 100;
      return `
      <article class="asset-card">
        <img src="${a.photo}" alt="${a.reference}" />
        <div class="asset-body">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
            <strong>${a.title}</strong>
            <span class="badge ${badgeClass(a.status)}">${a.status}</span>
          </div>
          <div class="small">${a.reference} · ${a.category} · ${a.quartier}</div>
          <div class="small">Valeur totale: <strong>${money(a.targetAmount)}</strong></div>
          <div class="small">Min investissement: <strong>${money(a.minInvestment)}</strong></div>
          <div class="small">SPV: <strong>${a.spvStatus}</strong></div>
          <div class="small">Score: <strong>${a.score}</strong> | Rentabilité: ${a.rentabiliteEstimee}</div>
          <div class="progress"><span style="width:${a.fundedPct}%;"></span></div>
          <div class="small">Funding: ${a.fundedPct}% (${money(a.fundedAmount)} / ${money(a.targetAmount)})</div>
          <div class="actions-row">
            <button class="btn-secondary" data-detail="${a.id}">Détails</button>
            ${role === 'user' ? `<button class="btn-primary" data-invest="${a.id}" ${soldOut ? 'disabled' : ''}>${soldOut ? 'Sold out' : 'Investir'}</button>` : ''}
          </div>
        </div>
      </article>`;
    })
    .join('');
}

async function loadAssets() {
  state.assets = await api('/assets');
  applyFilters();
}

document.getElementById('assetGrid').addEventListener('click', async (e) => {
  const detailId = e.target.dataset.detail;
  const investId = e.target.dataset.invest;

  try {
    if (detailId) {
      const a = await api(`/assets/${detailId}`);
      alert([
        `Asset: ${a.title}`,
        `Reference: ${a.reference}`,
        `Category: ${a.category}`,
        `SPV: ${a.spvStatus}`,
        `Investors: ${a.investorsCount}`,
        `Reserve: ${money(a.reserveBalance)}`,
        `Usage limit: ${a.usageLimitDays} days/year`
      ].join('\n'));
      return;
    }

    if (investId) {
      const amount = Number(prompt('Montant à investir (min 50000):', '50000'));
      if (!amount || Number.isNaN(amount)) return;
      await api('/investments', {
        method: 'POST',
        body: JSON.stringify({ assetId: Number(investId), amount })
      });
      setStatus('Investissement enregistré.', 'ok');
      await loadAssets();
    }
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

document.querySelectorAll('#searchInput,#categoryFilter,#statusFilter,#minScore,#sortBy').forEach((el) => {
  el.addEventListener('input', applyFilters);
  el.addEventListener('change', applyFilters);
});

document.getElementById('backBtn').addEventListener('click', () => {
  window.location.href = role === 'admin' ? 'admin.html' : 'user.html';
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await api('/logout', { method: 'POST' });
  } catch {
  }
  localStorage.clear();
  window.location.href = 'login.html';
});

loadAssets().catch((err) => {
  setStatus(err.message, 'error');
  if (/token|session|403|401/i.test(err.message)) {
    localStorage.clear();
    setTimeout(() => (window.location.href = 'login.html'), 700);
  }
});
