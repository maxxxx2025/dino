const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = 'replace_this_with_a_strong_secret';
const STABLECOIN_SYMBOL = 'AEDkeys';
const MIN_INVESTMENT = 50000;
const REFUND_WAIT_DAYS = 60;

const DB = {
  users: path.join(__dirname, 'users.json'),
  assets: path.join(__dirname, 'properties.json'),
  deposits: path.join(__dirname, 'deposits.json'),
  investments: path.join(__dirname, 'investments.json'),
  distributions: path.join(__dirname, 'distributions.json'),
  usageRequests: path.join(__dirname, 'usage_requests.json'),
  logs: path.join(__dirname, 'audit_logs.json')
};

const tokenBlacklist = new Set();

app.use(
  cors({
    origin(origin, callback) {
      const allowed = ['http://localhost:3000', 'http://localhost:49387'];
      if (!origin || allowed.includes(origin)) return callback(null, true);
      return callback(new Error('Origin not allowed'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);
app.use(bodyParser.json({ limit: '12mb' }));
app.use(express.json({ limit: '12mb' }));
app.use(express.static(__dirname));

function nowIso() {
  return new Date().toISOString();
}

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]', 'utf8');
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeJsonArray(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readUsers() {
  return readJsonArray(DB.users);
}
function writeUsers(users) {
  writeJsonArray(DB.users, users);
}
function readAssets() {
  return readJsonArray(DB.assets).map((a) => ({ ...a, score: calculateScore(a) }));
}
function writeAssets(assets) {
  writeJsonArray(
    DB.assets,
    assets.map((a) => ({ ...a, score: calculateScore(a) }))
  );
}
function readDeposits() {
  return readJsonArray(DB.deposits);
}
function writeDeposits(v) {
  writeJsonArray(DB.deposits, v);
}
function readInvestments() {
  return readJsonArray(DB.investments);
}
function writeInvestments(v) {
  writeJsonArray(DB.investments, v);
}
function readDistributions() {
  return readJsonArray(DB.distributions);
}
function writeDistributions(v) {
  writeJsonArray(DB.distributions, v);
}
function readUsageRequests() {
  return readJsonArray(DB.usageRequests);
}
function writeUsageRequests(v) {
  writeJsonArray(DB.usageRequests, v);
}
function readLogs() {
  return readJsonArray(DB.logs);
}
function writeLogs(v) {
  writeJsonArray(DB.logs, v);
}

function normalizeBcryptHash(hash) {
  if (typeof hash !== 'string') return '';
  return hash.startsWith('$2y$') ? `$2a$${hash.slice(4)}` : hash;
}

function nextId(list) {
  return list.length ? Math.max(...list.map((x) => Number(x.id) || 0)) + 1 : 1;
}

function calculateScore(asset) {
  const rentabilite = Number(asset.rentabiliteEstimee || 0);
  const evolution = Number(asset.evolutionPrixM2 || 0);
  return Number(((rentabilite + evolution) / 2).toFixed(2));
}

function availableBalance(user) {
  const wallet = Number(user.walletBalance || 0);
  const locked = Number(user.lockedBalance || 0);
  return Number((wallet - locked).toFixed(2));
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    role: user.role,
    kycStatus: user.kycStatus || 'pending',
    kycReason: user.kycReason || '',
    walletBalance: Number(user.walletBalance || 0),
    lockedBalance: Number(user.lockedBalance || 0),
    availableBalance: availableBalance(user),
    createdAt: user.createdAt
  };
}

function logEvent(type, actorId, details = {}) {
  const logs = readLogs();
  logs.push({
    id: nextId(logs),
    txHash: `0x${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`,
    type,
    actorId,
    details,
    createdAt: nowIso(),
    network: 'Arbitrum (simulated)'
  });
  writeLogs(logs);
}

function getUserById(id) {
  return readUsers().find((u) => Number(u.id) === Number(id));
}

function updateAssetFundingState(asset) {
  const pct = asset.targetAmount > 0 ? Math.min(100, (asset.fundedAmount / asset.targetAmount) * 100) : 0;
  asset.fundedPct = Number(pct.toFixed(2));
  if (asset.fundedPct >= 100) {
    asset.status = 'funded';
    if (asset.spvStatus === 'waiting_for_investors') {
      asset.spvStatus = 'in_creation';
    }
  } else if (asset.fundedPct > 0) {
    asset.status = 'funding_in_progress';
    asset.spvStatus = 'waiting_for_investors';
  } else {
    asset.status = 'pending';
    asset.spvStatus = 'waiting_for_investors';
  }
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Token manquant.' });
  if (tokenBlacklist.has(token)) return res.status(401).json({ message: 'Session expirée.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    req.token = token;
    return next();
  } catch {
    return res.status(403).json({ message: 'Token invalide.' });
  }
}

function verifyAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Accès admin requis.' });
  return next();
}

function requireKycApproved(req, res, next) {
  const user = getUserById(req.user.id);
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });
  if (user.kycStatus !== 'approved') {
    return res.status(403).json({ message: 'KYC non approuvé.' });
  }
  return next();
}

const DINO_START_COINS = 100;
const DINO_TRACK_LENGTH = 1000;
const DINO_ROOM_TTL_MS = 60 * 60 * 1000;
const DINO_RACE_TICK_MS = 120;
const DINO_TYPES = [
  { id: 'raptor', name: 'Raptor', color: '#ff6b6b', baseSpeed: 16, variance: 6, icon: 'R' },
  { id: 'trex', name: 'T-Rex', color: '#ff922b', baseSpeed: 15, variance: 7, icon: 'T' },
  { id: 'triceratops', name: 'Triceratops', color: '#ffd43b', baseSpeed: 13, variance: 5, icon: 'C' },
  { id: 'stegosaurus', name: 'Stegosaurus', color: '#82c91e', baseSpeed: 12, variance: 5, icon: 'S' },
  { id: 'ankylosaurus', name: 'Ankylosaurus', color: '#2f9e44', baseSpeed: 11, variance: 4, icon: 'A' },
  { id: 'iguanodon', name: 'Iguanodon', color: '#15aabf', baseSpeed: 14, variance: 6, icon: 'I' },
  { id: 'spinosaurus', name: 'Spinosaurus', color: '#4c6ef5', baseSpeed: 14, variance: 7, icon: 'P' },
  { id: 'diplodocus', name: 'Diplodocus', color: '#7048e8', baseSpeed: 10, variance: 4, icon: 'D' },
  { id: 'parasaurolophus', name: 'Parasaurolophus', color: '#ae3ec9', baseSpeed: 13, variance: 5, icon: 'L' },
  { id: 'carnotaurus', name: 'Carnotaurus', color: '#e64980', baseSpeed: 15, variance: 6, icon: 'N' }
];
const dinoRooms = new Map();

function randomId(size = 8) {
  return Math.random()
    .toString(36)
    .slice(2, 2 + size)
    .toUpperCase();
}

function dinoById(id) {
  return DINO_TYPES.find((d) => d.id === id);
}

function sanitizePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    coins: player.coins,
    dinoId: player.dinoId,
    bet: player.bet,
    position: Number(player.position.toFixed(1))
  };
}

function sanitizeRoom(room) {
  return {
    id: room.id,
    status: room.status,
    trackLength: room.trackLength,
    winnerId: room.winnerId,
    winnerName: room.winnerName,
    players: room.players.map(sanitizePlayer),
    dinos: DINO_TYPES
  };
}

function getRoom(roomId) {
  return dinoRooms.get(String(roomId || '').trim().toUpperCase());
}

function createRoom(playerName) {
  let roomId = randomId(6);
  while (dinoRooms.has(roomId)) roomId = randomId(6);

  const room = {
    id: roomId,
    status: 'waiting',
    trackLength: DINO_TRACK_LENGTH,
    winnerId: null,
    winnerName: null,
    players: [
      {
        id: randomId(10),
        name: String(playerName || 'Player 1').trim().slice(0, 20) || 'Player 1',
        coins: DINO_START_COINS,
        dinoId: null,
        bet: 0,
        position: 0
      }
    ],
    startedAt: null,
    finishedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  dinoRooms.set(roomId, room);
  return room;
}

function findPlayer(room, playerId) {
  return room.players.find((p) => p.id === String(playerId || '').trim());
}

function bothPlayersReady(room) {
  return (
    room.players.length === 2 &&
    room.players.every((p) => p.dinoId && Number(p.bet) > 0 && Number(p.bet) <= Number(p.coins))
  );
}

function raceTick() {
  for (const room of dinoRooms.values()) {
    if (room.status !== 'running') continue;

    for (const player of room.players) {
      const dino = dinoById(player.dinoId);
      if (!dino) continue;
      const boost = (Math.random() * 2 - 1) * dino.variance;
      const step = Math.max(2, dino.baseSpeed + boost);
      player.position += step;
      if (player.position > room.trackLength) player.position = room.trackLength;
    }

    room.updatedAt = Date.now();
    const leaders = room.players.filter((p) => p.position >= room.trackLength);
    if (!leaders.length) continue;

    room.status = 'finished';
    room.finishedAt = Date.now();

    if (leaders.length > 1) {
      room.winnerId = null;
      room.winnerName = 'Draw';
      for (const p of room.players) {
        p.coins = Number((p.coins + p.bet).toFixed(2));
      }
    } else {
      const winner = leaders[0];
      room.winnerId = winner.id;
      room.winnerName = winner.name;
      const pot = room.players.reduce((sum, p) => sum + Number(p.bet || 0), 0);
      winner.coins = Number((winner.coins + pot).toFixed(2));
    }
  }

  const now = Date.now();
  for (const [roomId, room] of dinoRooms.entries()) {
    if (now - room.updatedAt > DINO_ROOM_TTL_MS) dinoRooms.delete(roomId);
  }
}

setInterval(raceTick, DINO_RACE_TICK_MS);

app.get('/api/dino-race/dinos', (req, res) => {
  return res.json({ dinos: DINO_TYPES });
});

app.post('/api/dino-race/rooms', (req, res) => {
  const room = createRoom(req.body.playerName || 'Player 1');
  return res.status(201).json({
    roomId: room.id,
    playerId: room.players[0].id,
    room: sanitizeRoom(room)
  });
});

app.post('/api/dino-race/rooms/:roomId/join', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (room.players.length >= 2) return res.status(409).json({ message: 'Room is full.' });
  if (room.status !== 'waiting') return res.status(400).json({ message: 'Race already started.' });

  const player = {
    id: randomId(10),
    name: String(req.body.playerName || 'Player 2').trim().slice(0, 20) || 'Player 2',
    coins: DINO_START_COINS,
    dinoId: null,
    bet: 0,
    position: 0
  };
  room.players.push(player);
  room.updatedAt = Date.now();

  return res.status(201).json({
    roomId: room.id,
    playerId: player.id,
    room: sanitizeRoom(room)
  });
});

app.post('/api/dino-race/rooms/:roomId/select', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (room.status !== 'waiting') return res.status(400).json({ message: 'Selection is locked after start.' });

  const player = findPlayer(room, req.body.playerId);
  if (!player) return res.status(404).json({ message: 'Player not found.' });

  const dinoId = String(req.body.dinoId || '').trim();
  if (!dinoById(dinoId)) return res.status(400).json({ message: 'Invalid dinosaur.' });

  player.dinoId = dinoId;
  room.updatedAt = Date.now();
  return res.json({ room: sanitizeRoom(room) });
});

app.post('/api/dino-race/rooms/:roomId/bet', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (room.status !== 'waiting') return res.status(400).json({ message: 'Bet is locked after start.' });

  const player = findPlayer(room, req.body.playerId);
  if (!player) return res.status(404).json({ message: 'Player not found.' });

  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: 'Invalid bet amount.' });
  if (amount > player.coins) return res.status(400).json({ message: 'Bet exceeds your coins.' });

  player.bet = Number(amount.toFixed(2));
  room.updatedAt = Date.now();
  return res.json({ room: sanitizeRoom(room) });
});

app.post('/api/dino-race/rooms/:roomId/start', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (room.status !== 'waiting') return res.status(400).json({ message: 'Race already started.' });
  if (!findPlayer(room, req.body.playerId)) return res.status(404).json({ message: 'Player not found.' });
  if (!bothPlayersReady(room)) {
    return res.status(400).json({ message: 'Both players must choose dinosaurs and set valid bets.' });
  }

  for (const p of room.players) {
    p.position = 0;
    p.coins = Number((p.coins - p.bet).toFixed(2));
  }
  room.status = 'running';
  room.winnerId = null;
  room.winnerName = null;
  room.startedAt = Date.now();
  room.updatedAt = Date.now();

  return res.json({ room: sanitizeRoom(room) });
});

app.get('/api/dino-race/rooms/:roomId/state', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  return res.json({ room: sanitizeRoom(room) });
});

app.post('/api/dino-race/rooms/:roomId/reset', (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ message: 'Room not found.' });
  if (!findPlayer(room, req.body.playerId)) return res.status(404).json({ message: 'Player not found.' });

  room.status = 'waiting';
  room.winnerId = null;
  room.winnerName = null;
  room.startedAt = null;
  room.finishedAt = null;
  for (const p of room.players) {
    p.dinoId = null;
    p.bet = 0;
    p.position = 0;
  }
  room.updatedAt = Date.now();

  return res.json({ room: sanitizeRoom(room) });
});

app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ message: 'username, email, password requis.' });
  }

  const users = readUsers();
  if (users.some((u) => u.username === username || u.email === email)) {
    return res.status(409).json({ message: 'Utilisateur déjà existant.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: nextId(users),
    username: String(username).trim(),
    email: String(email).trim().toLowerCase(),
    password: hashedPassword,
    role: 'user',
    kycStatus: 'pending',
    kycReason: '',
    kycDocs: null,
    walletBalance: 0,
    lockedBalance: 0,
    createdAt: nowIso()
  };
  users.push(user);
  writeUsers(users);
  logEvent('USER_REGISTERED', user.id, { email: user.email });
  return res.status(201).json({ message: 'Compte créé.', user: sanitizeUser(user) });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ message: 'Identifiants requis.' });

  const users = readUsers();
  const user = users.find((u) => u.username === username || u.email === username);
  if (!user) return res.status(401).json({ message: 'Identifiants invalides.' });

  const ok = await bcrypt.compare(password, normalizeBcryptHash(user.password));
  if (!ok) return res.status(401).json({ message: 'Identifiants invalides.' });

  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, {
    expiresIn: '8h'
  });

  logEvent('USER_LOGIN', user.id, { role: user.role });
  return res.json({ token, user: sanitizeUser(user), stablecoin: STABLECOIN_SYMBOL });
});

app.post('/logout', verifyToken, (req, res) => {
  tokenBlacklist.add(req.token);
  logEvent('USER_LOGOUT', req.user.id, {});
  return res.json({ message: 'Déconnexion effectuée.' });
});

app.get('/me', verifyToken, (req, res) => {
  const user = getUserById(req.user.id);
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });
  return res.json({ user: sanitizeUser(user), stablecoin: STABLECOIN_SYMBOL });
});

app.post('/kyc', verifyToken, (req, res) => {
  const { idDocument, selfie } = req.body;
  if (!idDocument || !selfie) return res.status(400).json({ message: 'ID document et selfie requis.' });

  const users = readUsers();
  const user = users.find((u) => Number(u.id) === Number(req.user.id));
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

  user.kycStatus = 'under_review';
  user.kycReason = '';
  user.kycDocs = {
    idDocument,
    selfie,
    submittedAt: nowIso()
  };
  writeUsers(users);
  logEvent('KYC_SUBMITTED', user.id, {});
  return res.json({ message: 'KYC soumis.', kycStatus: user.kycStatus });
});

app.get('/kyc/requests', verifyToken, verifyAdmin, (req, res) => {
  const users = readUsers()
    .filter((u) => ['pending', 'under_review', 'rejected'].includes(u.kycStatus || 'pending'))
    .map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      kycStatus: u.kycStatus,
      kycReason: u.kycReason || '',
      kycDocs: u.kycDocs || null
    }));
  return res.json(users);
});

app.put('/kyc/:userId/approve', verifyToken, verifyAdmin, (req, res) => {
  const users = readUsers();
  const user = users.find((u) => Number(u.id) === Number(req.params.userId));
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

  user.kycStatus = 'approved';
  user.kycReason = '';
  writeUsers(users);
  logEvent('KYC_APPROVED', req.user.id, { targetUserId: user.id });
  return res.json({ message: 'KYC approuvé.' });
});

app.put('/kyc/:userId/reject', verifyToken, verifyAdmin, (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ message: 'Raison de rejet requise.' });

  const users = readUsers();
  const user = users.find((u) => Number(u.id) === Number(req.params.userId));
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

  user.kycStatus = 'rejected';
  user.kycReason = String(reason).trim();
  writeUsers(users);
  logEvent('KYC_REJECTED', req.user.id, { targetUserId: user.id, reason: user.kycReason });
  return res.json({ message: 'KYC rejeté.' });
});

app.get('/users', verifyToken, verifyAdmin, (req, res) => {
  return res.json(readUsers().map(sanitizeUser));
});

app.post('/users', verifyToken, verifyAdmin, async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password || !role) {
    return res.status(400).json({ message: 'username, email, password, role requis.' });
  }
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ message: 'Role invalide.' });

  const users = readUsers();
  if (users.some((u) => u.username === username || u.email === email)) {
    return res.status(409).json({ message: 'Utilisateur déjà existant.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: nextId(users),
    username,
    email: String(email).trim().toLowerCase(),
    password: hashedPassword,
    role,
    kycStatus: role === 'admin' ? 'approved' : 'pending',
    kycReason: '',
    kycDocs: null,
    walletBalance: 0,
    lockedBalance: 0,
    createdAt: nowIso()
  };

  users.push(user);
  writeUsers(users);
  logEvent('USER_CREATED_BY_ADMIN', req.user.id, { targetUserId: user.id, role });
  return res.status(201).json(sanitizeUser(user));
});

app.put('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
  const { password, role } = req.body;
  if (!password && !role) return res.status(400).json({ message: 'Aucune mise à jour.' });

  const users = readUsers();
  const user = users.find((u) => Number(u.id) === Number(req.params.id));
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

  if (role) {
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ message: 'Role invalide.' });
    user.role = role;
  }
  if (password) user.password = await bcrypt.hash(password, 10);

  writeUsers(users);
  logEvent('USER_UPDATED_BY_ADMIN', req.user.id, { targetUserId: user.id });
  return res.json(sanitizeUser(user));
});

app.delete('/users/:id', verifyToken, verifyAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === 1) return res.status(400).json({ message: 'Suppression admin principal interdite.' });
  if (id === Number(req.user.id)) return res.status(400).json({ message: 'Auto-suppression interdite.' });

  const users = readUsers();
  if (!users.some((u) => Number(u.id) === id)) return res.status(404).json({ message: 'Introuvable.' });

  writeUsers(users.filter((u) => Number(u.id) !== id));
  logEvent('USER_DELETED_BY_ADMIN', req.user.id, { targetUserId: id });
  return res.json({ message: 'Utilisateur supprimé.' });
});

app.get('/wallet', verifyToken, (req, res) => {
  const user = getUserById(req.user.id);
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });
  return res.json({
    symbol: STABLECOIN_SYMBOL,
    walletBalance: Number(user.walletBalance || 0),
    lockedBalance: Number(user.lockedBalance || 0),
    availableBalance: availableBalance(user)
  });
});

app.post('/deposits', verifyToken, requireKycApproved, (req, res) => {
  const { amount, transferDescription, transferReference } = req.body;
  const amt = Number(amount);
  if (Number.isNaN(amt) || amt <= 0 || !transferDescription || !transferReference) {
    return res.status(400).json({ message: 'Montant, description et référence requis.' });
  }

  const deposits = readDeposits();
  const deposit = {
    id: nextId(deposits),
    userId: req.user.id,
    amount: Number(amt.toFixed(2)),
    transferDescription,
    transferReference,
    iban: 'AE070331234567890123456',
    status: 'pending',
    createdAt: nowIso(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: ''
  };
  deposits.push(deposit);
  writeDeposits(deposits);
  logEvent('DEPOSIT_SUBMITTED', req.user.id, { depositId: deposit.id, amount: deposit.amount });
  return res.status(201).json(deposit);
});

app.get('/deposits', verifyToken, (req, res) => {
  const deposits = readDeposits();
  if (req.user.role === 'admin') return res.json(deposits);
  return res.json(deposits.filter((d) => Number(d.userId) === Number(req.user.id)));
});

app.put('/deposits/:id/approve', verifyToken, verifyAdmin, (req, res) => {
  const deposits = readDeposits();
  const deposit = deposits.find((d) => Number(d.id) === Number(req.params.id));
  if (!deposit) return res.status(404).json({ message: 'Dépôt introuvable.' });
  if (deposit.status !== 'pending') return res.status(400).json({ message: 'Dépôt déjà traité.' });

  const users = readUsers();
  const user = users.find((u) => Number(u.id) === Number(deposit.userId));
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

  user.walletBalance = Number((Number(user.walletBalance || 0) + Number(deposit.amount)).toFixed(2));
  deposit.status = 'approved';
  deposit.reviewedAt = nowIso();
  deposit.reviewedBy = req.user.id;

  writeUsers(users);
  writeDeposits(deposits);
  logEvent('DEPOSIT_APPROVED_AND_STABLECOIN_MINTED', req.user.id, {
    depositId: deposit.id,
    userId: user.id,
    amount: deposit.amount,
    stablecoin: STABLECOIN_SYMBOL
  });

  return res.json({ message: 'Dépôt approuvé et stablecoin émis.' });
});

app.put('/deposits/:id/reject', verifyToken, verifyAdmin, (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ message: 'Raison requise.' });

  const deposits = readDeposits();
  const deposit = deposits.find((d) => Number(d.id) === Number(req.params.id));
  if (!deposit) return res.status(404).json({ message: 'Dépôt introuvable.' });
  if (deposit.status !== 'pending') return res.status(400).json({ message: 'Dépôt déjà traité.' });

  deposit.status = 'rejected';
  deposit.reviewedAt = nowIso();
  deposit.reviewedBy = req.user.id;
  deposit.rejectionReason = String(reason).trim();
  writeDeposits(deposits);
  logEvent('DEPOSIT_REJECTED', req.user.id, { depositId: deposit.id, reason: deposit.rejectionReason });
  return res.json({ message: 'Dépôt rejeté.' });
});

app.get('/assets', verifyToken, (req, res) => {
  const { category, status, search } = req.query;
  let assets = readAssets();
  if (category) assets = assets.filter((a) => a.category === category);
  if (status) assets = assets.filter((a) => a.status === status);
  if (search) {
    const q = String(search).toLowerCase();
    assets = assets.filter((a) => `${a.reference} ${a.title} ${a.quartier}`.toLowerCase().includes(q));
  }
  return res.json(assets);
});

app.get('/assets/:id', verifyToken, (req, res) => {
  const asset = readAssets().find((a) => Number(a.id) === Number(req.params.id));
  if (!asset) return res.status(404).json({ message: 'Actif introuvable.' });

  const investments = readInvestments().filter((i) => Number(i.assetId) === Number(asset.id) && i.status !== 'refunded');
  return res.json({
    ...asset,
    investorsCount: new Set(investments.map((i) => i.userId)).size,
    totalInvested: Number(investments.reduce((sum, i) => sum + Number(i.amount), 0).toFixed(2))
  });
});

app.post('/assets', verifyToken, verifyAdmin, (req, res) => {
  const body = req.body;
  if (!body.reference || !body.title || !body.photo || !body.category || !body.quartier) {
    return res.status(400).json({ message: 'reference, title, photo, category, quartier requis.' });
  }
  if (!['real_estate', 'cars'].includes(body.category)) {
    return res.status(400).json({ message: 'category doit être real_estate ou cars.' });
  }

  const targetAmount = Number(body.targetAmount || body.prix);
  const asset = {
    id: nextId(readAssets()),
    reference: String(body.reference).trim(),
    title: String(body.title).trim(),
    category: body.category,
    prix: Number(body.prix || targetAmount),
    superficie: Number(body.superficie || 0),
    photo: String(body.photo).trim(),
    quartier: String(body.quartier).trim(),
    dateAjout: body.dateAjout || nowIso().slice(0, 10),
    rentabiliteEstimee: Number(body.rentabiliteEstimee || 0),
    evolutionPrixM2: Number(body.evolutionPrixM2 || 0),
    minInvestment: Number(body.minInvestment || MIN_INVESTMENT),
    targetAmount,
    fundedAmount: Number(body.fundedAmount || 0),
    fundedPct: 0,
    status: 'pending',
    spvStatus: 'waiting_for_investors',
    reserveRate: Number(body.reserveRate || 0.1),
    reserveBalance: Number(body.reserveBalance || 0),
    usageLimitDays: 20,
    metadata: body.metadata || {}
  };

  updateAssetFundingState(asset);
  const assets = readAssets();
  assets.push(asset);
  writeAssets(assets);
  logEvent('ASSET_CREATED', req.user.id, { assetId: asset.id, category: asset.category });
  return res.status(201).json(asset);
});

app.put('/assets/:id', verifyToken, verifyAdmin, (req, res) => {
  const assets = readAssets();
  const asset = assets.find((a) => Number(a.id) === Number(req.params.id));
  if (!asset) return res.status(404).json({ message: 'Actif introuvable.' });

  const allowed = [
    'reference',
    'title',
    'category',
    'prix',
    'superficie',
    'photo',
    'quartier',
    'dateAjout',
    'rentabiliteEstimee',
    'evolutionPrixM2',
    'minInvestment',
    'targetAmount',
    'reserveRate',
    'metadata'
  ];
  allowed.forEach((k) => {
    if (req.body[k] !== undefined) asset[k] = req.body[k];
  });

  asset.prix = Number(asset.prix);
  asset.superficie = Number(asset.superficie || 0);
  asset.rentabiliteEstimee = Number(asset.rentabiliteEstimee || 0);
  asset.evolutionPrixM2 = Number(asset.evolutionPrixM2 || 0);
  asset.minInvestment = Number(asset.minInvestment || MIN_INVESTMENT);
  asset.targetAmount = Number(asset.targetAmount || asset.prix);
  asset.reserveRate = Number(asset.reserveRate || 0.1);

  updateAssetFundingState(asset);
  writeAssets(assets);
  logEvent('ASSET_UPDATED', req.user.id, { assetId: asset.id });
  return res.json(asset);
});

app.delete('/assets/:id', verifyToken, verifyAdmin, (req, res) => {
  const id = Number(req.params.id);
  const investments = readInvestments();
  if (investments.some((i) => Number(i.assetId) === id && i.status !== 'refunded')) {
    return res.status(400).json({ message: 'Impossible de supprimer un actif avec investissements.' });
  }

  const assets = readAssets();
  if (!assets.some((a) => Number(a.id) === id)) return res.status(404).json({ message: 'Actif introuvable.' });

  writeAssets(assets.filter((a) => Number(a.id) !== id));
  logEvent('ASSET_DELETED', req.user.id, { assetId: id });
  return res.json({ message: 'Actif supprimé.' });
});

app.put('/assets/:id/spv-status', verifyToken, verifyAdmin, (req, res) => {
  const { spvStatus } = req.body;
  if (!['waiting_for_investors', 'in_creation', 'active'].includes(spvStatus)) {
    return res.status(400).json({ message: 'spvStatus invalide.' });
  }

  const assets = readAssets();
  const asset = assets.find((a) => Number(a.id) === Number(req.params.id));
  if (!asset) return res.status(404).json({ message: 'Actif introuvable.' });

  asset.spvStatus = spvStatus;
  writeAssets(assets);
  logEvent('SPV_STATUS_UPDATED', req.user.id, { assetId: asset.id, spvStatus });
  return res.json(asset);
});

app.post('/investments', verifyToken, requireKycApproved, (req, res) => {
  const assetId = Number(req.body.assetId);
  const amount = Number(req.body.amount);

  if (Number.isNaN(assetId) || Number.isNaN(amount)) {
    return res.status(400).json({ message: 'assetId et amount requis.' });
  }

  const users = readUsers();
  const user = users.find((u) => Number(u.id) === Number(req.user.id));
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

  const assets = readAssets();
  const asset = assets.find((a) => Number(a.id) === assetId);
  if (!asset) return res.status(404).json({ message: 'Actif introuvable.' });
  if (asset.fundedPct >= 100) return res.status(400).json({ message: 'Actif déjà financé à 100%.' });

  if (amount < MIN_INVESTMENT || amount < Number(asset.minInvestment || MIN_INVESTMENT)) {
    return res.status(400).json({ message: `Investissement minimum: ${Math.max(MIN_INVESTMENT, asset.minInvestment)}.` });
  }

  if (availableBalance(user) < amount) {
    return res.status(400).json({ message: 'Solde insuffisant.' });
  }

  const remaining = Number(asset.targetAmount) - Number(asset.fundedAmount || 0);
  if (amount > remaining) {
    return res.status(400).json({ message: `Montant maximum possible: ${remaining}.` });
  }

  const investments = readInvestments();
  const inv = {
    id: nextId(investments),
    userId: user.id,
    assetId,
    amount: Number(amount.toFixed(2)),
    ownershipPct: Number(((amount / Number(asset.targetAmount)) * 100).toFixed(4)),
    status: 'active',
    createdAt: nowIso(),
    refundRequestedAt: null,
    refundedAt: null
  };
  investments.push(inv);

  user.lockedBalance = Number((Number(user.lockedBalance || 0) + amount).toFixed(2));

  asset.fundedAmount = Number((Number(asset.fundedAmount || 0) + amount).toFixed(2));
  updateAssetFundingState(asset);

  writeInvestments(investments);
  writeUsers(users);
  writeAssets(assets);

  logEvent('INVESTMENT_LOCKED', req.user.id, {
    investmentId: inv.id,
    assetId,
    amount,
    ownershipPct: inv.ownershipPct
  });

  return res.status(201).json(inv);
});

app.get('/investments', verifyToken, (req, res) => {
  const investments = readInvestments();
  const assets = readAssets();
  const users = readUsers();

  const scoped = req.user.role === 'admin'
    ? investments
    : investments.filter((i) => Number(i.userId) === Number(req.user.id));

  const enriched = scoped.map((i) => ({
    ...i,
    user: users.find((u) => Number(u.id) === Number(i.userId))
      ? sanitizeUser(users.find((u) => Number(u.id) === Number(i.userId)))
      : null,
    asset: assets.find((a) => Number(a.id) === Number(i.assetId)) || null
  }));

  return res.json(enriched);
});

app.post('/investments/:id/refund-request', verifyToken, (req, res) => {
  const investments = readInvestments();
  const inv = investments.find((i) => Number(i.id) === Number(req.params.id));
  if (!inv) return res.status(404).json({ message: 'Investissement introuvable.' });
  if (req.user.role !== 'admin' && Number(inv.userId) !== Number(req.user.id)) {
    return res.status(403).json({ message: 'Non autorisé.' });
  }
  if (inv.status !== 'active') return res.status(400).json({ message: 'Investissement non éligible.' });

  const asset = readAssets().find((a) => Number(a.id) === Number(inv.assetId));
  if (!asset) return res.status(404).json({ message: 'Actif introuvable.' });
  if (asset.fundedPct >= 100) return res.status(400).json({ message: 'Actif financé à 100%, remboursement indisponible.' });

  const ageDays = Math.floor((Date.now() - new Date(inv.createdAt).getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays < REFUND_WAIT_DAYS) {
    return res.status(400).json({ message: `Remboursement possible après ${REFUND_WAIT_DAYS} jours.` });
  }

  inv.status = 'refund_requested';
  inv.refundRequestedAt = nowIso();
  writeInvestments(investments);
  logEvent('REFUND_REQUESTED', req.user.id, { investmentId: inv.id });
  return res.json({ message: 'Demande de remboursement envoyée.' });
});

app.put('/investments/:id/refund-approve', verifyToken, verifyAdmin, (req, res) => {
  const investments = readInvestments();
  const inv = investments.find((i) => Number(i.id) === Number(req.params.id));
  if (!inv) return res.status(404).json({ message: 'Investissement introuvable.' });
  if (inv.status !== 'refund_requested') return res.status(400).json({ message: 'Aucune demande de remboursement.' });

  const users = readUsers();
  const user = users.find((u) => Number(u.id) === Number(inv.userId));
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable.' });

  const assets = readAssets();
  const asset = assets.find((a) => Number(a.id) === Number(inv.assetId));
  if (!asset) return res.status(404).json({ message: 'Actif introuvable.' });

  user.lockedBalance = Number((Number(user.lockedBalance || 0) - Number(inv.amount)).toFixed(2));
  if (user.lockedBalance < 0) user.lockedBalance = 0;

  asset.fundedAmount = Number((Number(asset.fundedAmount || 0) - Number(inv.amount)).toFixed(2));
  if (asset.fundedAmount < 0) asset.fundedAmount = 0;
  updateAssetFundingState(asset);

  inv.status = 'refunded';
  inv.refundedAt = nowIso();

  writeUsers(users);
  writeAssets(assets);
  writeInvestments(investments);
  logEvent('REFUND_APPROVED', req.user.id, { investmentId: inv.id, userId: user.id, amount: inv.amount });
  return res.json({ message: 'Remboursement validé.' });
});

app.post('/usage-requests', verifyToken, requireKycApproved, (req, res) => {
  const { assetId, startDate, endDate, daysRequested, note } = req.body;
  const aid = Number(assetId);
  const days = Number(daysRequested);
  if (Number.isNaN(aid) || Number.isNaN(days) || !startDate || !endDate) {
    return res.status(400).json({ message: 'assetId, startDate, endDate, daysRequested requis.' });
  }
  if (days <= 0) return res.status(400).json({ message: 'daysRequested invalide.' });

  const investments = readInvestments();
  const hasInvestment = investments.some(
    (i) => Number(i.userId) === Number(req.user.id) && Number(i.assetId) === aid && i.status === 'active'
  );
  if (!hasInvestment) return res.status(403).json({ message: 'Investissement requis sur cet actif.' });

  const year = new Date(startDate).getUTCFullYear();
  const usage = readUsageRequests();
  const alreadyUsed = usage
    .filter((u) => Number(u.userId) === Number(req.user.id) && Number(u.assetId) === aid && u.status === 'approved')
    .filter((u) => new Date(u.startDate).getUTCFullYear() === year)
    .reduce((sum, u) => sum + Number(u.daysRequested || 0), 0);

  if (alreadyUsed + days > 20) {
    return res.status(400).json({ message: `Limite de 20 jours/an dépassée (déjà ${alreadyUsed}).` });
  }

  const entry = {
    id: nextId(usage),
    userId: req.user.id,
    assetId: aid,
    startDate,
    endDate,
    daysRequested: days,
    note: note || '',
    status: 'pending',
    createdAt: nowIso(),
    reviewedAt: null,
    reviewedBy: null,
    reviewReason: ''
  };

  usage.push(entry);
  writeUsageRequests(usage);
  logEvent('USAGE_REQUEST_SUBMITTED', req.user.id, { usageRequestId: entry.id, assetId: aid, days });
  return res.status(201).json(entry);
});

app.get('/usage-requests', verifyToken, (req, res) => {
  const usage = readUsageRequests();
  if (req.user.role === 'admin') return res.json(usage);
  return res.json(usage.filter((u) => Number(u.userId) === Number(req.user.id)));
});

app.put('/usage-requests/:id/status', verifyToken, verifyAdmin, (req, res) => {
  const { status, reason } = req.body;
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ message: 'Status invalide.' });

  const usage = readUsageRequests();
  const request = usage.find((u) => Number(u.id) === Number(req.params.id));
  if (!request) return res.status(404).json({ message: 'Demande introuvable.' });

  request.status = status;
  request.reviewedAt = nowIso();
  request.reviewedBy = req.user.id;
  request.reviewReason = reason || '';
  writeUsageRequests(usage);
  logEvent('USAGE_REQUEST_REVIEWED', req.user.id, { usageRequestId: request.id, status });
  return res.json({ message: 'Demande mise à jour.' });
});

app.post('/distributions', verifyToken, verifyAdmin, (req, res) => {
  const assetId = Number(req.body.assetId);
  const grossAmount = Number(req.body.grossAmount);
  const note = req.body.note || '';

  if (Number.isNaN(assetId) || Number.isNaN(grossAmount) || grossAmount <= 0) {
    return res.status(400).json({ message: 'assetId et grossAmount valides requis.' });
  }

  const assets = readAssets();
  const asset = assets.find((a) => Number(a.id) === assetId);
  if (!asset) return res.status(404).json({ message: 'Actif introuvable.' });
  if (asset.spvStatus !== 'active') return res.status(400).json({ message: 'SPV non actif.' });

  const investments = readInvestments().filter((i) => Number(i.assetId) === assetId && i.status === 'active');
  const total = investments.reduce((sum, i) => sum + Number(i.amount), 0);
  if (total <= 0) return res.status(400).json({ message: 'Aucun investisseur actif.' });

  const reservePart = Number((grossAmount * Number(asset.reserveRate || 0)).toFixed(2));
  const netAmount = Number((grossAmount - reservePart).toFixed(2));
  asset.reserveBalance = Number((Number(asset.reserveBalance || 0) + reservePart).toFixed(2));

  const users = readUsers();
  const allocations = investments.map((i) => {
    const share = Number(((Number(i.amount) / total) * netAmount).toFixed(2));
    const user = users.find((u) => Number(u.id) === Number(i.userId));
    if (user) user.walletBalance = Number((Number(user.walletBalance || 0) + share).toFixed(2));
    return { investmentId: i.id, userId: i.userId, amount: share };
  });

  const distributions = readDistributions();
  const dist = {
    id: nextId(distributions),
    assetId,
    grossAmount: Number(grossAmount.toFixed(2)),
    reservePart,
    netAmount,
    allocations,
    note,
    createdAt: nowIso(),
    createdBy: req.user.id,
    stablecoin: STABLECOIN_SYMBOL
  };
  distributions.push(dist);

  writeUsers(users);
  writeAssets(assets);
  writeDistributions(distributions);
  logEvent('REVENUE_DISTRIBUTED', req.user.id, {
    distributionId: dist.id,
    assetId,
    grossAmount,
    netAmount,
    reservePart
  });

  return res.status(201).json(dist);
});

app.get('/distributions', verifyToken, (req, res) => {
  const distributions = readDistributions();
  if (req.user.role === 'admin') return res.json(distributions);

  return res.json(
    distributions
      .map((d) => ({
        ...d,
        allocations: d.allocations.filter((a) => Number(a.userId) === Number(req.user.id))
      }))
      .filter((d) => d.allocations.length > 0)
  );
});

app.get('/logs', verifyToken, (req, res) => {
  const logs = readLogs();
  if (req.user.role === 'admin') return res.json(logs);
  return res.json(logs.filter((l) => Number(l.actorId) === Number(req.user.id) || Number(l.details?.userId) === Number(req.user.id)));
});

app.get('/metrics/overview', verifyToken, (req, res) => {
  const assets = readAssets();
  const users = readUsers();
  const investments = readInvestments();
  const deposits = readDeposits();

  const totalAssetValue = assets.reduce((sum, a) => sum + Number(a.targetAmount || 0), 0);
  const totalFunded = assets.reduce((sum, a) => sum + Number(a.fundedAmount || 0), 0);

  return res.json({
    totalUsers: users.length,
    totalAssets: assets.length,
    totalAssetValue: Number(totalAssetValue.toFixed(2)),
    totalFunded: Number(totalFunded.toFixed(2)),
    totalInvestments: investments.filter((i) => i.status === 'active').length,
    pendingKyc: users.filter((u) => ['pending', 'under_review', 'rejected'].includes(u.kycStatus)).length,
    pendingDeposits: deposits.filter((d) => d.status === 'pending').length
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
