const API = window.location.port === '3000' ? '' : 'http://localhost:3000';

const authStatus = document.getElementById('authStatus');
const loginTab = document.getElementById('loginTab');
const registerTab = document.getElementById('registerTab');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

function setStatus(msg, type = 'ok') {
  authStatus.textContent = msg;
  authStatus.className = `status ${type}`;
}

function switchTab(tab) {
  const login = tab === 'login';
  loginForm.classList.toggle('hidden', !login);
  registerForm.classList.toggle('hidden', login);
  loginTab.classList.toggle('active', login);
  registerTab.classList.toggle('active', !login);
  setStatus('');
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Erreur API (${res.status})`);
  return data;
}

function redirectByRole(role) {
  if (role === 'admin') {
    window.location.href = 'admin.html';
  } else {
    window.location.href = 'user.html';
  }
}

(async function restoreSession() {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    const me = await api('/me', { headers: { Authorization: `Bearer ${token}` } });
    localStorage.setItem('role', me.user.role);
    localStorage.setItem('username', me.user.username);
    redirectByRole(me.user.role);
  } catch {
    localStorage.clear();
  }
})();

loginTab.addEventListener('click', () => switchTab('login'));
registerTab.addEventListener('click', () => switchTab('register'));

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const payload = {
      username: document.getElementById('loginUsername').value.trim(),
      password: document.getElementById('loginPassword').value
    };
    const data = await api('/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    localStorage.setItem('token', data.token);
    localStorage.setItem('role', data.user.role);
    localStorage.setItem('username', data.user.username);
    localStorage.setItem('userId', String(data.user.id));
    setStatus('Connexion réussie. Redirection...');
    redirectByRole(data.user.role);
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const payload = {
      username: document.getElementById('registerUsername').value.trim(),
      email: document.getElementById('registerEmail').value.trim(),
      password: document.getElementById('registerPassword').value
    };
    await api('/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setStatus('Compte créé. Connectez-vous maintenant.', 'ok');
    switchTab('login');
  } catch (err) {
    setStatus(err.message, 'error');
  }
});
