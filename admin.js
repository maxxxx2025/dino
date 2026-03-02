const API = window.location.port === '3000' ? '' : 'http://localhost:3000';
const token = localStorage.getItem('token');
if (!token) window.location.href = 'login.html';

const state = {
  users: [],
  assets: [],
  deposits: [],
  kycRequests: [],
  investments: [],
  usageRequests: [],
  distributions: [],
  logs: [],
  metrics: null,
  charts: { funding: null, score: null }
};

function setStatus(msg, type = 'ok') {
  const el = document.getElementById('globalStatus');
  el.textContent = msg || '';
  el.className = `status ${type}`;
}

function money(v) {
  return `${Number(v || 0).toLocaleString('fr-FR')} AED`;
}

function badge(v) {
  const x = String(v || '').toLowerCase();
  const cls = x.includes('approved') || x.includes('active') || x.includes('funded') ? 'approved' : x.includes('reject') ? 'rejected' : x.includes('review') || x.includes('creation') ? 'review' : 'pending';
  return `<span class="badge ${cls}">${v}</span>`;
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

function renderMetrics() {
  const m = state.metrics || {};
  const entries = [
    ['Total users', m.totalUsers || 0],
    ['Total assets', m.totalAssets || 0],
    ['Asset value', money(m.totalAssetValue || 0)],
    ['Funded', money(m.totalFunded || 0)],
    ['Investments', m.totalInvestments || 0],
    ['Pending KYC', m.pendingKyc || 0],
    ['Pending Deposits', m.pendingDeposits || 0]
  ];
  document.getElementById('metricsRow').innerHTML = entries.map(([k, v]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
}

function renderKyc() {
  const body = document.getElementById('kycBody');
  body.innerHTML = state.kycRequests.length
    ? state.kycRequests.map((u) => `
      <tr>
        <td>${u.username}<br/><span class="small">${u.email || ''}</span></td>
        <td>${badge(u.kycStatus)}</td>
        <td class="small">${u.kycDocs ? 'ID + Selfie fournis' : 'Aucun document'}</td>
        <td>
          <button class="btn-secondary" data-kyc-approve="${u.id}">Approve</button>
          <button class="btn-danger" data-kyc-reject="${u.id}">Reject</button>
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="4">Aucun dossier</td></tr>';
}

function renderDeposits() {
  const body = document.getElementById('depositsBody');
  body.innerHTML = state.deposits.length
    ? state.deposits.map((d) => `
      <tr>
        <td>${d.id}</td>
        <td>${d.userId}</td>
        <td>${money(d.amount)}</td>
        <td>${badge(d.status)}</td>
        <td>
          ${d.status === 'pending' ? `
            <button class="btn-secondary" data-dep-approve="${d.id}">Approve</button>
            <button class="btn-danger" data-dep-reject="${d.id}">Reject</button>
          ` : '-'}
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="5">Aucun dépôt</td></tr>';
}

function renderUsers() {
  const body = document.getElementById('usersBody');
  body.innerHTML = state.users.length
    ? state.users.map((u) => `
      <tr>
        <td>${u.id}</td>
        <td>${u.username}</td>
        <td>${u.email || ''}</td>
        <td>${u.role}</td>
        <td>${badge(u.kycStatus)}</td>
        <td>${money(u.walletBalance)} / lock ${money(u.lockedBalance)}</td>
        <td>
          <button class="btn-secondary" data-user-edit="${u.id}">Edit</button>
          <button class="btn-danger" data-user-del="${u.id}">Delete</button>
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="7">Aucun user</td></tr>';
}

function renderAssets() {
  const body = document.getElementById('assetsBody');
  body.innerHTML = state.assets.length
    ? state.assets.map((a) => `
      <tr>
        <td>${a.id}</td>
        <td>${a.reference}<br/><span class="small">${a.title}</span></td>
        <td>${a.category}</td>
        <td>${a.fundedPct}% (${money(a.fundedAmount)} / ${money(a.targetAmount)})</td>
        <td>${a.score}</td>
        <td>${badge(a.spvStatus)}</td>
        <td>
          <button class="btn-secondary" data-asset-edit="${a.id}">Edit</button>
          <button class="btn-warning" data-spv="${a.id}">SPV</button>
          <button class="btn-danger" data-asset-del="${a.id}">Delete</button>
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="7">Aucun actif</td></tr>';
}

function renderDistributions() {
  const body = document.getElementById('distributionsBody');
  body.innerHTML = state.distributions.length
    ? state.distributions.slice().reverse().map((d) => `<tr><td>${d.id}</td><td>${d.assetId}</td><td>${money(d.grossAmount)}</td><td>${money(d.netAmount)}</td><td>${new Date(d.createdAt).toLocaleString('fr-FR')}</td></tr>`).join('')
    : '<tr><td colspan="5">Aucune distribution</td></tr>';
}

function renderOps() {
  const body = document.getElementById('opsBody');
  const refunds = state.investments.filter((i) => i.status === 'refund_requested').map((i) => ({
    kind: 'refund', id: i.id, userId: i.userId, ref: `asset#${i.assetId} ${money(i.amount)}`, status: i.status
  }));
  const usages = state.usageRequests.filter((u) => u.status === 'pending').map((u) => ({
    kind: 'usage', id: u.id, userId: u.userId, ref: `asset#${u.assetId} ${u.startDate}->${u.endDate} (${u.daysRequested}j)`, status: u.status
  }));
  const rows = [...refunds, ...usages];

  body.innerHTML = rows.length
    ? rows.map((r) => `
      <tr>
        <td>${r.kind}</td>
        <td>${r.id}</td>
        <td>${r.userId}</td>
        <td>${r.ref}</td>
        <td>${badge(r.status)}</td>
        <td>
          ${r.kind === 'refund'
            ? `<button class="btn-secondary" data-refund-approve="${r.id}">Approve refund</button>`
            : `<button class="btn-secondary" data-usage-approve="${r.id}">Approve usage</button>
               <button class="btn-danger" data-usage-reject="${r.id}">Reject usage</button>`}
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="6">Aucune opération en attente</td></tr>';
}

function renderLogs() {
  const body = document.getElementById('logsBody');
  body.innerHTML = state.logs.length
    ? state.logs.slice(-30).reverse().map((l) => `<tr><td class="small">${l.txHash.slice(0, 16)}...</td><td>${l.type}</td><td>${l.actorId}</td><td>${new Date(l.createdAt).toLocaleString('fr-FR')}</td></tr>`).join('')
    : '<tr><td colspan="4">Aucun log</td></tr>';
}

function renderCharts() {
  const labels = state.assets.map((a) => a.reference);
  const fundedData = state.assets.map((a) => a.fundedPct);
  const scoreData = state.assets.map((a) => a.score);

  if (state.charts.funding) state.charts.funding.destroy();
  if (state.charts.score) state.charts.score.destroy();

  state.charts.funding = new Chart(document.getElementById('fundingChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Funding %', data: fundedData, backgroundColor: 'rgba(37, 99, 235, 0.6)' }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true, max: 100 } } }
  });

  state.charts.score = new Chart(document.getElementById('scoreChart').getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: 'Score', data: scoreData, borderColor: '#1ac4b2', backgroundColor: 'rgba(26, 196, 178,0.2)', fill: true, tension: 0.25 }]
    },
    options: { responsive: true }
  });
}

async function loadAll() {
  const [me, metrics, users, assets, deposits, kyc, investments, usage, distributions, logs] = await Promise.all([
    api('/me'),
    api('/metrics/overview'),
    api('/users'),
    api('/assets'),
    api('/deposits'),
    api('/kyc/requests'),
    api('/investments'),
    api('/usage-requests'),
    api('/distributions'),
    api('/logs')
  ]);

  if (me.user.role !== 'admin') window.location.href = 'user.html';

  state.metrics = metrics;
  state.users = users;
  state.assets = assets;
  state.deposits = deposits;
  state.kycRequests = kyc;
  state.investments = investments;
  state.usageRequests = usage;
  state.distributions = distributions;
  state.logs = logs;

  renderMetrics();
  renderKyc();
  renderDeposits();
  renderUsers();
  renderAssets();
  renderDistributions();
  renderOps();
  renderLogs();
  renderCharts();
}

function resetUserForm() {
  document.getElementById('userId').value = '';
  document.getElementById('userUsername').value = '';
  document.getElementById('userEmail').value = '';
  document.getElementById('userPassword').value = '';
  document.getElementById('userRole').value = 'user';
  document.getElementById('saveUserBtn').textContent = 'Ajouter utilisateur';
  document.getElementById('userUsername').disabled = false;
  document.getElementById('userEmail').disabled = false;
  document.getElementById('userPassword').required = true;
}

function resetAssetForm() {
  document.getElementById('assetId').value = '';
  document.getElementById('assetReference').value = '';
  document.getElementById('assetTitle').value = '';
  document.getElementById('assetCategory').value = 'real_estate';
  document.getElementById('assetPrix').value = '';
  document.getElementById('assetSuperficie').value = '';
  document.getElementById('assetQuartier').value = '';
  document.getElementById('assetPhoto').value = '';
  document.getElementById('assetDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('assetRentabilite').value = '';
  document.getElementById('assetEvolution').value = '';
  document.getElementById('assetMinInvest').value = '50000';
  document.getElementById('assetReserveRate').value = '0.1';
  document.getElementById('saveAssetBtn').textContent = 'Ajouter asset';
}

document.getElementById('userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const id = document.getElementById('userId').value;
    if (!id) {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('userUsername').value.trim(),
          email: document.getElementById('userEmail').value.trim(),
          password: document.getElementById('userPassword').value,
          role: document.getElementById('userRole').value
        })
      });
      setStatus('Utilisateur créé.');
    } else {
      const payload = { role: document.getElementById('userRole').value };
      const pwd = document.getElementById('userPassword').value;
      if (pwd) payload.password = pwd;
      await api(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      setStatus('Utilisateur mis à jour.');
    }
    resetUserForm();
    await loadAll();
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

document.getElementById('cancelUserBtn').addEventListener('click', resetUserForm);

document.getElementById('assetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const id = document.getElementById('assetId').value;
    const payload = {
      reference: document.getElementById('assetReference').value.trim(),
      title: document.getElementById('assetTitle').value.trim(),
      category: document.getElementById('assetCategory').value,
      prix: Number(document.getElementById('assetPrix').value),
      targetAmount: Number(document.getElementById('assetPrix').value),
      superficie: Number(document.getElementById('assetSuperficie').value || 0),
      quartier: document.getElementById('assetQuartier').value.trim(),
      photo: document.getElementById('assetPhoto').value.trim(),
      dateAjout: document.getElementById('assetDate').value,
      rentabiliteEstimee: Number(document.getElementById('assetRentabilite').value),
      evolutionPrixM2: Number(document.getElementById('assetEvolution').value),
      minInvestment: Number(document.getElementById('assetMinInvest').value),
      reserveRate: Number(document.getElementById('assetReserveRate').value)
    };

    if (!id) {
      await api('/assets', { method: 'POST', body: JSON.stringify(payload) });
      setStatus('Asset créé.');
    } else {
      await api(`/assets/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      setStatus('Asset mis à jour.');
    }

    resetAssetForm();
    await loadAll();
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

document.getElementById('cancelAssetBtn').addEventListener('click', resetAssetForm);

document.getElementById('distributionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/distributions', {
      method: 'POST',
      body: JSON.stringify({
        assetId: Number(document.getElementById('distAssetId').value),
        grossAmount: Number(document.getElementById('distAmount').value),
        note: document.getElementById('distNote').value.trim()
      })
    });
    e.target.reset();
    setStatus('Distribution effectuée.');
    await loadAll();
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

document.body.addEventListener('click', async (e) => {
  try {
    if (e.target.dataset.kycApprove) {
      await api(`/kyc/${e.target.dataset.kycApprove}/approve`, { method: 'PUT' });
      setStatus('KYC approuvé.');
      await loadAll();
      return;
    }
    if (e.target.dataset.kycReject) {
      const reason = prompt('Raison du rejet KYC:');
      if (!reason) return;
      await api(`/kyc/${e.target.dataset.kycReject}/reject`, {
        method: 'PUT',
        body: JSON.stringify({ reason })
      });
      setStatus('KYC rejeté.');
      await loadAll();
      return;
    }

    if (e.target.dataset.depApprove) {
      await api(`/deposits/${e.target.dataset.depApprove}/approve`, { method: 'PUT' });
      setStatus('Dépôt approuvé.');
      await loadAll();
      return;
    }
    if (e.target.dataset.depReject) {
      const reason = prompt('Raison du rejet dépôt:');
      if (!reason) return;
      await api(`/deposits/${e.target.dataset.depReject}/reject`, {
        method: 'PUT',
        body: JSON.stringify({ reason })
      });
      setStatus('Dépôt rejeté.');
      await loadAll();
      return;
    }

    if (e.target.dataset.userEdit) {
      const u = state.users.find((x) => String(x.id) === e.target.dataset.userEdit);
      if (!u) return;
      document.getElementById('userId').value = u.id;
      document.getElementById('userUsername').value = u.username;
      document.getElementById('userEmail').value = u.email || '';
      document.getElementById('userRole').value = u.role;
      document.getElementById('userPassword').value = '';
      document.getElementById('saveUserBtn').textContent = `Update user #${u.id}`;
      document.getElementById('userUsername').disabled = true;
      document.getElementById('userEmail').disabled = true;
      document.getElementById('userPassword').required = false;
      return;
    }
    if (e.target.dataset.userDel) {
      if (!confirm('Confirmer suppression utilisateur ?')) return;
      await api(`/users/${e.target.dataset.userDel}`, { method: 'DELETE' });
      setStatus('Utilisateur supprimé.');
      await loadAll();
      return;
    }

    if (e.target.dataset.assetEdit) {
      const a = state.assets.find((x) => String(x.id) === e.target.dataset.assetEdit);
      if (!a) return;
      document.getElementById('assetId').value = a.id;
      document.getElementById('assetReference').value = a.reference;
      document.getElementById('assetTitle').value = a.title;
      document.getElementById('assetCategory').value = a.category;
      document.getElementById('assetPrix').value = a.targetAmount;
      document.getElementById('assetSuperficie').value = a.superficie || 0;
      document.getElementById('assetQuartier').value = a.quartier;
      document.getElementById('assetPhoto').value = a.photo;
      document.getElementById('assetDate').value = a.dateAjout;
      document.getElementById('assetRentabilite').value = a.rentabiliteEstimee;
      document.getElementById('assetEvolution').value = a.evolutionPrixM2;
      document.getElementById('assetMinInvest').value = a.minInvestment;
      document.getElementById('assetReserveRate').value = a.reserveRate;
      document.getElementById('saveAssetBtn').textContent = `Update asset #${a.id}`;
      return;
    }
    if (e.target.dataset.assetDel) {
      if (!confirm('Confirmer suppression asset ?')) return;
      await api(`/assets/${e.target.dataset.assetDel}`, { method: 'DELETE' });
      setStatus('Asset supprimé.');
      await loadAll();
      return;
    }

    if (e.target.dataset.spv) {
      const next = prompt('Nouveau SPV status: waiting_for_investors | in_creation | active', 'active');
      if (!next) return;
      await api(`/assets/${e.target.dataset.spv}/spv-status`, {
        method: 'PUT',
        body: JSON.stringify({ spvStatus: next })
      });
      setStatus('SPV status mis à jour.');
      await loadAll();
      return;
    }

    if (e.target.dataset.refundApprove) {
      await api(`/investments/${e.target.dataset.refundApprove}/refund-approve`, { method: 'PUT' });
      setStatus('Remboursement approuvé.');
      await loadAll();
      return;
    }

    if (e.target.dataset.usageApprove) {
      await api(`/usage-requests/${e.target.dataset.usageApprove}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'approved' })
      });
      setStatus('Usage approuvé.');
      await loadAll();
      return;
    }

    if (e.target.dataset.usageReject) {
      const reason = prompt('Raison rejet usage:') || '';
      await api(`/usage-requests/${e.target.dataset.usageReject}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'rejected', reason })
      });
      setStatus('Usage rejeté.');
      await loadAll();
    }
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

document.getElementById('openMarketplaceBtn').addEventListener('click', () => {
  window.location.href = 'properties.html';
});

document.getElementById('refreshBtn').addEventListener('click', async () => {
  try {
    await loadAll();
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

resetUserForm();
resetAssetForm();
loadAll().catch((err) => {
  setStatus(err.message, 'error');
  if (/token|session|403|401/i.test(err.message)) {
    localStorage.clear();
    setTimeout(() => (window.location.href = 'login.html'), 700);
  }
});
