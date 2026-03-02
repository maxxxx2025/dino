const API = window.location.port === '3000' ? '' : 'http://localhost:3000';
const token = localStorage.getItem('token');

if (!token) window.location.href = 'login.html';

const state = {
  me: null,
  assetsMap: new Map()
};

function setStatus(msg, type = 'ok') {
  const el = document.getElementById('globalStatus');
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

function badge(value) {
  const v = String(value || '').toLowerCase();
  const cls = v.includes('approved') || v.includes('active') ? 'approved' : v.includes('reject') ? 'rejected' : v.includes('review') ? 'review' : 'pending';
  return `<span class="badge ${cls}">${value}</span>`;
}

async function loadMe() {
  const { user } = await api('/me');
  state.me = user;
  if (user.role !== 'user') window.location.href = 'admin.html';
  document.getElementById('welcomeTitle').textContent = `Bienvenue ${user.username}`;

  const kycEl = document.getElementById('kycState');
  kycEl.innerHTML = `Statut KYC: ${badge(user.kycStatus)} ${user.kycReason ? `- ${user.kycReason}` : ''}`;
  document.getElementById('kycForm').classList.toggle('hidden', user.kycStatus === 'approved' || user.kycStatus === 'under_review');
}

async function loadWallet() {
  const wallet = await api('/wallet');
  document.getElementById('walletTotal').textContent = money(wallet.walletBalance);
  document.getElementById('walletLocked').textContent = money(wallet.lockedBalance);
  document.getElementById('walletAvailable').textContent = money(wallet.availableBalance);
}

async function loadAssetsMap() {
  const assets = await api('/assets');
  state.assetsMap = new Map(assets.map((a) => [Number(a.id), a]));
}

async function loadDeposits() {
  const rows = await api('/deposits');
  const body = document.getElementById('depositsBody');
  body.innerHTML = rows.length
    ? rows.map((d) => `<tr><td>${d.id}</td><td>${money(d.amount)}</td><td>${badge(d.status)}</td><td>${d.transferReference}</td></tr>`).join('')
    : '<tr><td colspan="4">Aucun dépôt</td></tr>';
}

async function loadInvestments() {
  const rows = await api('/investments');
  const body = document.getElementById('investmentsBody');
  body.innerHTML = rows.length
    ? rows.map((i) => {
        const asset = i.asset || state.assetsMap.get(Number(i.assetId)) || {};
        const canRefund = i.status === 'active' && asset.fundedPct < 100;
        return `<tr>
          <td>${asset.reference || i.assetId}</td>
          <td>${money(i.amount)}</td>
          <td>${i.ownershipPct}%</td>
          <td>${badge(i.status)}</td>
          <td>${canRefund ? `<button class="btn-warning" data-refund="${i.id}">Demande remboursement</button>` : '-'}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="5">Aucun investissement</td></tr>';
}

async function loadUsage() {
  const rows = await api('/usage-requests');
  const body = document.getElementById('usageBody');
  body.innerHTML = rows.length
    ? rows.map((u) => `<tr><td>${u.id}</td><td>${u.assetId}</td><td>${u.startDate} → ${u.endDate}</td><td>${u.daysRequested}</td><td>${badge(u.status)}</td></tr>`).join('')
    : '<tr><td colspan="5">Aucune demande</td></tr>';
}

async function loadDistributions() {
  const rows = await api('/distributions');
  const body = document.getElementById('distributionsBody');
  const out = [];
  rows.forEach((d) => {
    d.allocations.forEach((a) => {
      out.push(`<tr><td>#${d.id}</td><td>${d.assetId}</td><td>${money(a.amount)}</td><td>${new Date(d.createdAt).toLocaleString('fr-FR')}</td></tr>`);
    });
  });
  body.innerHTML = out.length ? out.join('') : '<tr><td colspan="4">Aucune distribution</td></tr>';
}

async function loadLogs() {
  const rows = await api('/logs');
  const body = document.getElementById('logsBody');
  body.innerHTML = rows.length
    ? rows.slice(-20).reverse().map((l) => `<tr><td class="small">${l.txHash.slice(0, 14)}...</td><td>${l.type}</td><td>${new Date(l.createdAt).toLocaleString('fr-FR')}</td></tr>`).join('')
    : '<tr><td colspan="3">Aucune opération</td></tr>';
}

document.getElementById('kycForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/kyc', {
      method: 'POST',
      body: JSON.stringify({
        idDocument: document.getElementById('idDocument').value.trim(),
        selfie: document.getElementById('selfie').value.trim()
      })
    });
    setStatus('KYC envoyé. En attente de validation admin.');
    await loadMe();
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

document.getElementById('depositForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/deposits', {
      method: 'POST',
      body: JSON.stringify({
        amount: Number(document.getElementById('depositAmount').value),
        transferReference: document.getElementById('depositRef').value.trim(),
        transferDescription: document.getElementById('depositDesc').value.trim()
      })
    });
    setStatus('Dépôt soumis. Attente validation admin.', 'ok');
    e.target.reset();
    await loadDeposits();
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

document.getElementById('usageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/usage-requests', {
      method: 'POST',
      body: JSON.stringify({
        assetId: Number(document.getElementById('usageAssetId').value),
        startDate: document.getElementById('usageStart').value,
        endDate: document.getElementById('usageEnd').value,
        daysRequested: Number(document.getElementById('usageDays').value),
        note: document.getElementById('usageNote').value.trim()
      })
    });
    setStatus('Demande d\'utilisation envoyée.');
    e.target.reset();
    await loadUsage();
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

document.getElementById('investmentsBody').addEventListener('click', async (e) => {
  const id = e.target.dataset.refund;
  if (!id) return;
  try {
    await api(`/investments/${id}/refund-request`, { method: 'POST' });
    setStatus('Demande de remboursement envoyée.');
    await loadInvestments();
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

document.getElementById('openMarketplaceBtn').addEventListener('click', () => {
  window.location.href = 'properties.html';
});

document.getElementById('refreshBtn').addEventListener('click', async () => {
  try {
    await bootstrap();
    setStatus('Données actualisées.');
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    await api('/logout', { method: 'POST' });
  } catch {
  }
  localStorage.clear();
  window.location.href = 'login.html';
});

async function bootstrap() {
  await loadMe();
  await Promise.all([
    loadWallet(),
    loadAssetsMap(),
    loadDeposits(),
    loadInvestments(),
    loadUsage(),
    loadDistributions(),
    loadLogs()
  ]);
}

bootstrap().catch((err) => {
  setStatus(err.message, 'error');
  if (/token|session|403|401/i.test(err.message)) {
    localStorage.clear();
    setTimeout(() => (window.location.href = 'login.html'), 800);
  }
});
