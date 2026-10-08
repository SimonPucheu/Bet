import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '..');
const dataDirectory = path.join(root, 'data');
fs.mkdirSync(dataDirectory, { recursive: true });

const db = new Database(process.env.DB_PATH || path.join(dataDirectory, 'oddsroom.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 1000 CHECK (balance >= 0),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    redeemed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    redeemed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS markets (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    options_json TEXT NOT NULL,
    outcome_index INTEGER,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    ends_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    creator_id INTEGER NOT NULL REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    choice_index INTEGER NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    decimal_odds REAL NOT NULL DEFAULT 2.0,
    created_at TEXT NOT NULL,
    UNIQUE (market_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_markets_status_ends ON markets(status, ends_at);
  CREATE INDEX IF NOT EXISTS idx_bets_market ON bets(market_id);
`);

const betColumns = db.pragma('table_info(bets)');
if (!betColumns.some((column) => column.name === 'decimal_odds')) {
  db.exec('ALTER TABLE bets ADD COLUMN decimal_odds REAL NOT NULL DEFAULT 2.0');
}

db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
const hasUsers = db.prepare('SELECT 1 FROM users LIMIT 1').get();
const bootstrapInvite = db.prepare(`
  SELECT code FROM invite_codes WHERE created_by IS NULL AND redeemed_at IS NULL LIMIT 1
`).get();
if (!hasUsers && !bootstrapInvite) {
  const initialInvite = process.env.INITIAL_INVITE_CODE?.trim().toUpperCase()
    || randomBytes(6).toString('hex').toUpperCase();
  if (!/^[A-Z0-9-]{6,32}$/.test(initialInvite)) {
    throw new Error('INITIAL_INVITE_CODE must be 6–32 letters, numbers, or hyphens.');
  }
  db.prepare('INSERT INTO invite_codes (code, created_at) VALUES (?, ?)')
    .run(initialInvite, new Date().toISOString());
  console.log(`Bootstrap invite code: ${initialInvite}`);
}

const app = express();
const port = Number(process.env.PORT || 3001);
const categories = new Set(['Culture', 'Sports', 'Technology', 'Politics', 'Community', 'Science']);
app.use(express.json({ limit: '32kb' }));

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function getCookie(request, name) {
  const cookies = request.headers.cookie?.split(';') ?? [];
  const cookie = cookies.map((entry) => entry.trim()).find((entry) => entry.startsWith(`${name}=`));
  return cookie?.slice(name.length + 1);
}

function getUser(request) {
  const token = getCookie(request, 'sid');
  if (!token) return null;
  return db.prepare(`
    SELECT users.id, users.username, users.balance
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(digest(token), new Date().toISOString()) ?? null;
}

function requireUser(request, response, next) {
  request.user = getUser(request);
  if (!request.user) return response.status(401).json({ error: 'Sign in to continue.' });
  next();
}

function setSession(response, userId) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(digest(token), userId, expiresAt);
  response.cookie('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function publicUser(user) {
  return { id: user.id, username: user.username, balance: user.balance };
}

app.get('/api/me', (request, response) => {
  const user = getUser(request);
  response.json({ user: user ? publicUser(user) : null });
});

app.post('/api/auth/register', async (request, response) => {
  const username = typeof request.body.username === 'string' ? request.body.username.trim() : '';
  const email = typeof request.body.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  const password = typeof request.body.password === 'string' ? request.body.password : '';
  const inviteCode = typeof request.body.inviteCode === 'string' ? request.body.inviteCode.trim().toUpperCase() : '';
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return response.status(400).json({ error: 'Username must be 3–20 letters, numbers, or underscores.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    return response.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (password.length < 8 || password.length > 128) {
    return response.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (!inviteCode) return response.status(400).json({ error: 'An invitation code is required.' });

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const userId = db.transaction(() => {
      const invite = db.prepare(`
        SELECT code FROM invite_codes WHERE code = ? AND redeemed_at IS NULL
      `).get(inviteCode);
      if (!invite) throw Object.assign(new Error('That invitation code is invalid or already used.'), { status: 400 });

      const result = db.prepare(`
        INSERT INTO users (username, email, password_hash, balance, created_at)
        VALUES (?, ?, ?, 1000, ?)
      `).run(username, email, passwordHash, new Date().toISOString());
      const redeemed = db.prepare(`
        UPDATE invite_codes SET redeemed_by = ?, redeemed_at = ?
        WHERE code = ? AND redeemed_at IS NULL
      `).run(result.lastInsertRowid, new Date().toISOString(), invite.code);
      if (redeemed.changes !== 1) {
        throw Object.assign(new Error('That invitation code is invalid or already used.'), { status: 400 });
      }
      return Number(result.lastInsertRowid);
    })();
    setSession(response, userId);
    response.status(201).json({
      user: publicUser(db.prepare('SELECT id, username, balance FROM users WHERE id = ?').get(userId)),
    });
  } catch (error) {
    if (error.status) return response.status(error.status).json({ error: error.message });
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return response.status(409).json({ error: 'That username or email is already registered.' });
    }
    console.error(error);
    response.status(500).json({ error: 'Could not create your account.' });
  }
});

app.post('/api/auth/login', async (request, response) => {
  const identity = typeof request.body.identity === 'string' ? request.body.identity.trim() : '';
  const password = typeof request.body.password === 'string' ? request.body.password : '';
  const user = db.prepare(`
    SELECT id, username, balance, password_hash FROM users
    WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
  `).get(identity, identity);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return response.status(401).json({ error: 'Those sign-in details did not match.' });
  }
  setSession(response, user.id);
  response.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (request, response) => {
  const token = getCookie(request, 'sid');
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
  response.clearCookie('sid', { httpOnly: true, sameSite: 'lax', path: '/' });
  response.json({ ok: true });
});

app.get('/api/invites', requireUser, (request, response) => {
  const invites = db.prepare(`
    SELECT code, created_at AS createdAt, redeemed_at AS redeemedAt
    FROM invite_codes WHERE created_by = ? ORDER BY created_at DESC
  `).all(request.user.id);
  response.json({ invites });
});

app.post('/api/invites', requireUser, (request, response) => {
  const code = randomBytes(6).toString('hex').toUpperCase();
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO invite_codes (code, created_by, created_at) VALUES (?, ?, ?)')
    .run(code, request.user.id, createdAt);
  response.status(201).json({ invite: { code, createdAt, redeemedAt: null } });
});

app.get('/api/markets', requireUser, (request, response) => {
  const user = request.user;
  const markets = db.prepare(`
    SELECT markets.*, users.username AS creator_name
    FROM markets JOIN users ON users.id = markets.creator_id
    ORDER BY CASE
      WHEN markets.status = 'open' AND markets.ends_at > ? THEN 0
      WHEN markets.status = 'open' THEN 1
      ELSE 2
    END, markets.created_at DESC
  `).all(new Date().toISOString());
  const totals = db.prepare(`
    SELECT market_id, choice_index, COUNT(*) AS count, SUM(amount) AS staked
    FROM bets GROUP BY market_id, choice_index
  `).all();
  const myBets = user
    ? db.prepare('SELECT market_id, choice_index, amount, decimal_odds FROM bets WHERE user_id = ?').all(user.id)
    : [];
  const totalsByMarket = new Map();
  for (const row of totals) {
    if (!totalsByMarket.has(row.market_id)) totalsByMarket.set(row.market_id, []);
    totalsByMarket.get(row.market_id).push(row);
  }
  const betsByMarket = new Map(myBets.map((bet) => [bet.market_id, bet]));
  response.json({
    markets: markets.map((market) => {
      const options = JSON.parse(market.options_json);
      const marketBets = totalsByMarket.get(market.id) ?? [];
      const totalPickCount = marketBets.reduce((sum, bet) => sum + bet.count, 0);
      const optionStats = Array.from({ length: options.length }, (_, index) => {
        const summary = (totalsByMarket.get(market.id) ?? []).find((entry) => entry.choice_index === index);
        const count = summary?.count ?? 0;
        const odds = Number(((totalPickCount + options.length) / (count + 1)).toFixed(2));
        return { count, staked: summary?.staked ?? 0, odds };
      });
      const myBet = betsByMarket.get(market.id);
      return {
        id: market.id,
        title: market.title,
        description: market.description,
        category: market.category,
        options,
        outcomeIndex: market.outcome_index,
        status: market.status,
        endsAt: market.ends_at,
        createdAt: market.created_at,
        creator: market.creator_name,
        creatorId: market.creator_id,
        optionStats,
        totalStaked: marketBets.reduce((sum, bet) => sum + bet.staked, 0),
        bettorsCount: marketBets.reduce((sum, bet) => sum + bet.count, 0),
        myBet: myBet ? {
          choiceIndex: myBet.choice_index,
          amount: myBet.amount,
          odds: myBet.decimal_odds,
        } : null,
      };
    }),
  });
});

app.get('/api/leaderboard', requireUser, (request, response) => {
  const leaders = db.prepare(`
    SELECT users.id, users.username, users.balance,
      (SELECT COUNT(*) FROM bets JOIN markets ON markets.id = bets.market_id
       WHERE bets.user_id = users.id AND bets.choice_index = markets.outcome_index
         AND markets.status = 'resolved') AS wins
    FROM users ORDER BY users.balance DESC, users.created_at ASC LIMIT 8
  `).all();
  response.json({ leaders });
});

app.post('/api/markets', requireUser, (request, response) => {
  const { title, description, category, options, endsAt } = request.body;
  if (typeof title !== 'string' || title.trim().length < 8 || title.trim().length > 100) {
    return response.status(400).json({ error: 'Question must be between 8 and 100 characters.' });
  }
  if (typeof description !== 'string' || description.trim().length > 280) {
    return response.status(400).json({ error: 'Description must be 280 characters or fewer.' });
  }
  if (!categories.has(category)) return response.status(400).json({ error: 'Choose a valid category.' });
  if (!Array.isArray(options) || options.length < 2 || options.length > 6
    || options.some((option) => typeof option !== 'string' || !option.trim() || option.trim().length > 40)) {
    return response.status(400).json({ error: 'Add between 2 and 6 answer choices, up to 40 characters each.' });
  }
  const cleanOptions = options.map((option) => option.trim());
  if (new Set(cleanOptions.map((option) => option.toLowerCase())).size !== cleanOptions.length) {
    return response.status(400).json({ error: 'Answer choices must be unique.' });
  }
  const expiry = Date.parse(endsAt);
  if (!Number.isFinite(expiry) || expiry < Date.now() + 60_000 || expiry > Date.now() + 90 * 24 * 60 * 60 * 1000) {
    return response.status(400).json({ error: 'Choose an expiration from 1 minute to 90 days from now.' });
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO markets (id, title, description, category, options_json, ends_at, created_at, creator_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, title.trim(), description.trim(), category, JSON.stringify(cleanOptions),
    new Date(expiry).toISOString(), new Date().toISOString(), request.user.id,
  );
  response.status(201).json({ id });
});

app.post('/api/markets/:id/bets', requireUser, (request, response) => {
  const choiceIndex = Number(request.body.choiceIndex);
  const amount = Number(request.body.amount);
  const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(request.params.id);
  if (!market) return response.status(404).json({ error: 'Market not found.' });
  if (market.status !== 'open' || Date.parse(market.ends_at) <= Date.now()) {
    return response.status(400).json({ error: 'This market is no longer taking bets.' });
  }
  const options = JSON.parse(market.options_json);
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= options.length) {
    return response.status(400).json({ error: 'Choose one of the listed outcomes.' });
  }
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000) {
    return response.status(400).json({ error: 'Stake a whole number of credits between 1 and 100,000.' });
  }

  try {
    db.transaction(() => {
      if (db.prepare('SELECT 1 FROM bets WHERE market_id = ? AND user_id = ?').get(market.id, request.user.id)) {
        throw Object.assign(new Error('You already have a position in this market.'), { status: 409 });
      }
      const pickCounts = db.prepare(`
        SELECT COUNT(*) AS total, SUM(CASE WHEN choice_index = ? THEN 1 ELSE 0 END) AS selected
        FROM bets WHERE market_id = ?
      `).get(choiceIndex, market.id);
      const selectedCount = pickCounts.selected ?? 0;
      const decimalOdds = Number(((pickCounts.total + options.length) / (selectedCount + 1)).toFixed(2));
      const debit = db.prepare('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?')
        .run(amount, request.user.id, amount);
      if (debit.changes !== 1) throw Object.assign(new Error('Not enough credits for that stake.'), { status: 400 });
      db.prepare(`
        INSERT INTO bets (market_id, user_id, choice_index, amount, decimal_odds, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(market.id, request.user.id, choiceIndex, amount, decimalOdds, new Date().toISOString());
    })();
  } catch (error) {
    if (error.status) return response.status(error.status).json({ error: error.message });
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return response.status(409).json({ error: 'You already have a position in this market.' });
    console.error(error);
    return response.status(500).json({ error: 'Could not place your bet.' });
  }
  response.json({ user: publicUser(db.prepare('SELECT id, username, balance FROM users WHERE id = ?').get(request.user.id)) });
});

app.post('/api/markets/:id/resolve', requireUser, (request, response) => {
  const outcomeIndex = Number(request.body.outcomeIndex);
  try {
    db.transaction(() => {
      const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(request.params.id);
      if (!market) throw Object.assign(new Error('Market not found.'), { status: 404 });
      if (market.status === 'resolved') throw Object.assign(new Error('This market has already been resolved.'), { status: 409 });
      if (Date.parse(market.ends_at) > Date.now()) throw Object.assign(new Error('This market can only be resolved after it expires.'), { status: 400 });
      const options = JSON.parse(market.options_json);
      if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0 || outcomeIndex >= options.length) {
        throw Object.assign(new Error('Choose one of the listed outcomes.'), { status: 400 });
      }
      db.prepare('UPDATE markets SET status = \'resolved\', outcome_index = ? WHERE id = ?')
        .run(outcomeIndex, market.id);
      const winners = db.prepare('SELECT user_id, amount, decimal_odds FROM bets WHERE market_id = ? AND choice_index = ?')
        .all(market.id, outcomeIndex);
      const credit = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
      for (const winner of winners) {
        credit.run(Math.floor(winner.amount * winner.decimal_odds), winner.user_id);
      }
    })();
  } catch (error) {
    if (error.status) return response.status(error.status).json({ error: error.message });
    console.error(error);
    return response.status(500).json({ error: 'Could not resolve this market.' });
  }
  response.json({ user: publicUser(db.prepare('SELECT id, username, balance FROM users WHERE id = ?').get(request.user.id)) });
});

app.use('/api', (request, response) => response.status(404).json({ error: 'API route not found.' }));

const buildDirectory = path.join(root, 'dist');
if (fs.existsSync(buildDirectory)) {
  app.use(express.static(buildDirectory));
  app.get('*path', (_request, response) => response.sendFile(path.join(buildDirectory, 'index.html')));
}

app.listen(port, () => {
  console.log(`NiggaBet API listening on http://localhost:${port}`);
});