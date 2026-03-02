const state = {
  roomId: null,
  playerId: null,
  playerName: '',
  room: null,
  dinos: [],
  pollTimer: null
};

const el = {
  playerName: document.getElementById('playerName'),
  createRoomBtn: document.getElementById('createRoomBtn'),
  roomCodeInput: document.getElementById('roomCodeInput'),
  joinRoomBtn: document.getElementById('joinRoomBtn'),
  roomCode: document.getElementById('roomCode'),
  youName: document.getElementById('youName'),
  youCoins: document.getElementById('youCoins'),
  raceState: document.getElementById('raceState'),
  dinoGrid: document.getElementById('dinoGrid'),
  betInput: document.getElementById('betInput'),
  setBetBtn: document.getElementById('setBetBtn'),
  startRaceBtn: document.getElementById('startRaceBtn'),
  resetRaceBtn: document.getElementById('resetRaceBtn'),
  message: document.getElementById('message'),
  playersInfo: document.getElementById('playersInfo'),
  raceCanvas: document.getElementById('raceCanvas')
};

const ctx = el.raceCanvas.getContext('2d');

function setMessage(message, isOk = false) {
  el.message.textContent = message || '';
  el.message.style.color = isOk ? '#22c55e' : '#f59e0b';
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || 'Request failed');
  }
  return body;
}

function you() {
  if (!state.room) return null;
  return state.room.players.find((p) => p.id === state.playerId) || null;
}

function updateTopStatus() {
  const me = you();
  el.roomCode.textContent = state.roomId || '-';
  el.youName.textContent = state.playerName || '-';
  el.youCoins.textContent = me ? String(me.coins.toFixed(2)) : '-';
  el.raceState.textContent = state.room ? state.room.status : 'waiting';
}

function renderDinoGrid() {
  const me = you();
  const selected = me ? me.dinoId : null;

  el.dinoGrid.innerHTML = state.dinos
    .map(
      (d) => `
      <button class="dino-card ${selected === d.id ? 'selected' : ''}" data-dino-id="${d.id}" style="border-left:5px solid ${d.color}">
        <div class="dino-name">${d.name}</div>
        <div>Speed ${d.baseSpeed}</div>
      </button>
    `
    )
    .join('');
}

function renderPlayersInfo() {
  if (!state.room) {
    el.playersInfo.textContent = 'Create or join a room.';
    return;
  }

  const lines = state.room.players.map((p, i) => {
    const dino = state.dinos.find((d) => d.id === p.dinoId);
    const dinoName = dino ? dino.name : 'not selected';
    return `P${i + 1} ${p.name} | Coins: ${p.coins.toFixed(2)} | Bet: ${p.bet.toFixed(2)} | Dino: ${dinoName}`;
  });

  if (state.room.winnerName) {
    lines.push(`Winner: ${state.room.winnerName}`);
  }

  el.playersInfo.innerHTML = lines.join('<br>');
}

function drawTrack() {
  const w = el.raceCanvas.width;
  const h = el.raceCanvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, w, h);

  const laneY = [110, 250];
  laneY.forEach((y) => {
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, y + 50);
    ctx.lineTo(w - 30, y + 50);
    ctx.stroke();
  });

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w - 40, 35);
  ctx.lineTo(w - 40, h - 35);
  ctx.stroke();

  if (!state.room) return;

  state.room.players.forEach((p, idx) => {
    const y = laneY[idx] || 110;
    const dino = state.dinos.find((d) => d.id === p.dinoId);
    const color = dino ? dino.color : '#64748b';
    const icon = dino ? dino.icon : '?';
    const progress = Math.min(1, p.position / state.room.trackLength);
    const x = 30 + progress * (w - 110);

    ctx.fillStyle = color;
    ctx.fillRect(x, y, 72, 36);
    ctx.fillStyle = '#0b1220';
    ctx.font = 'bold 20px Trebuchet MS';
    ctx.fillText(icon, x + 28, y + 24);

    ctx.fillStyle = '#0f172a';
    ctx.font = '16px Trebuchet MS';
    ctx.fillText(p.name, 30, y - 12);
  });
}

function renderAll() {
  updateTopStatus();
  renderDinoGrid();
  renderPlayersInfo();
  drawTrack();
}

async function refreshState(showErrors = false) {
  if (!state.roomId) return;
  try {
    const data = await api(`/api/dino-race/rooms/${state.roomId}/state`);
    state.room = data.room;
    renderAll();
  } catch (error) {
    if (showErrors) setMessage(error.message);
  }
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => refreshState(false), 220);
}

async function loadDinos() {
  const data = await api('/api/dino-race/dinos');
  state.dinos = data.dinos || [];
  renderDinoGrid();
  drawTrack();
}

el.createRoomBtn.addEventListener('click', async () => {
  try {
    const name = (el.playerName.value || '').trim() || 'Player 1';
    const data = await api('/api/dino-race/rooms', {
      method: 'POST',
      body: JSON.stringify({ playerName: name })
    });

    state.roomId = data.roomId;
    state.playerId = data.playerId;
    state.playerName = name;
    state.room = data.room;

    el.roomCodeInput.value = state.roomId;
    startPolling();
    renderAll();
    setMessage(`Room ${state.roomId} created. Share code with Player 2.`, true);
  } catch (error) {
    setMessage(error.message);
  }
});

el.joinRoomBtn.addEventListener('click', async () => {
  try {
    const name = (el.playerName.value || '').trim() || 'Player 2';
    const roomCode = (el.roomCodeInput.value || '').trim().toUpperCase();
    if (!roomCode) {
      setMessage('Enter room code first.');
      return;
    }

    const data = await api(`/api/dino-race/rooms/${roomCode}/join`, {
      method: 'POST',
      body: JSON.stringify({ playerName: name })
    });

    state.roomId = data.roomId;
    state.playerId = data.playerId;
    state.playerName = name;
    state.room = data.room;

    startPolling();
    renderAll();
    setMessage(`Joined room ${state.roomId}.`, true);
  } catch (error) {
    setMessage(error.message);
  }
});

el.dinoGrid.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-dino-id]');
  if (!target || !state.roomId || !state.playerId) return;

  try {
    const dinoId = target.dataset.dinoId;
    const data = await api(`/api/dino-race/rooms/${state.roomId}/select`, {
      method: 'POST',
      body: JSON.stringify({ playerId: state.playerId, dinoId })
    });

    state.room = data.room;
    renderAll();
    setMessage('Dinosaur selected.', true);
  } catch (error) {
    setMessage(error.message);
  }
});

el.setBetBtn.addEventListener('click', async () => {
  if (!state.roomId || !state.playerId) return;
  try {
    const amount = Number(el.betInput.value);
    const data = await api(`/api/dino-race/rooms/${state.roomId}/bet`, {
      method: 'POST',
      body: JSON.stringify({ playerId: state.playerId, amount })
    });

    state.room = data.room;
    renderAll();
    setMessage('Bet confirmed.', true);
  } catch (error) {
    setMessage(error.message);
  }
});

el.startRaceBtn.addEventListener('click', async () => {
  if (!state.roomId || !state.playerId) return;
  try {
    const data = await api(`/api/dino-race/rooms/${state.roomId}/start`, {
      method: 'POST',
      body: JSON.stringify({ playerId: state.playerId })
    });

    state.room = data.room;
    renderAll();
    setMessage('Race started.', true);
  } catch (error) {
    setMessage(error.message);
  }
});

el.resetRaceBtn.addEventListener('click', async () => {
  if (!state.roomId || !state.playerId) return;
  try {
    const data = await api(`/api/dino-race/rooms/${state.roomId}/reset`, {
      method: 'POST',
      body: JSON.stringify({ playerId: state.playerId })
    });

    state.room = data.room;
    renderAll();
    setMessage('Rematch ready.', true);
  } catch (error) {
    setMessage(error.message);
  }
});

loadDinos().catch((error) => setMessage(error.message));
renderPlayersInfo();
drawTrack();
