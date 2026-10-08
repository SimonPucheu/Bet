import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webPush from 'web-push';

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
    redeemed_at TEXT,
    expires_at TEXT
  );
  CREATE TABLE IF NOT EXISTS invite_redemptions (
    invite_code TEXT NOT NULL REFERENCES invite_codes(code) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redeemed_at TEXT NOT NULL,
    PRIMARY KEY (invite_code, user_id)
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
    creator_id INTEGER NOT NULL REFERENCES users(id),
    cancelled_at TEXT
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
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
  CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    new_polls INTEGER NOT NULL DEFAULT 0 CHECK (new_polls IN (0, 1)),
    participated_resolutions INTEGER NOT NULL DEFAULT 0 CHECK (participated_resolutions IN (0, 1))
  );
  CREATE INDEX IF NOT EXISTS idx_markets_status_ends ON markets(status, ends_at);
  CREATE INDEX IF NOT EXISTS idx_bets_market ON bets(market_id);
`);

const marketColumns = db.pragma('table_info(markets)');
if (!marketColumns.some((column) => column.name === 'cancelled_at')) {
  db.exec('ALTER TABLE markets ADD COLUMN cancelled_at TEXT');
}

const inviteColumns = db.pragma('table_info(invite_codes)');
if (!inviteColumns.some((column) => column.name === 'expires_at')) {
  db.exec('ALTER TABLE invite_codes ADD COLUMN expires_at TEXT');
  const legacyInvites = db.prepare('SELECT code, created_at FROM invite_codes').all();
  const setInviteExpiry = db.prepare('UPDATE invite_codes SET expires_at = ? WHERE code = ?');
  const legacyExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const invite of legacyInvites) {
    setInviteExpiry.run(legacyExpiry, invite.code);
  }
}

db.exec(`
  INSERT OR IGNORE INTO invite_redemptions (invite_code, user_id, redeemed_at)
  SELECT code, redeemed_by, redeemed_at FROM invite_codes
  WHERE redeemed_by IS NOT NULL AND redeemed_at IS NOT NULL
`);

const betColumns = db.pragma('table_info(bets)');
if (!betColumns.some((column) => column.name === 'decimal_odds')) {
  db.exec('ALTER TABLE bets ADD COLUMN decimal_odds REAL NOT NULL DEFAULT 2.0');
}

db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
const hasUsers = db.prepare('SELECT 1 FROM users LIMIT 1').get();
const now = new Date().toISOString();
db.prepare(`
  DELETE FROM invite_codes
  WHERE created_by IS NULL AND redeemed_at IS NULL AND expires_at <= ?
`).run(now);
const bootstrapInvite = db.prepare(`
  SELECT code FROM invite_codes WHERE created_by IS NULL AND expires_at > ? LIMIT 1
`).get(now);
if (!hasUsers && !bootstrapInvite) {
  const initialInvite = process.env.INITIAL_INVITE_CODE?.trim().toUpperCase()
    || randomBytes(6).toString('hex').toUpperCase();
  if (!/^[A-Z0-9-]{6,32}$/.test(initialInvite)) {
    throw new Error('INITIAL_INVITE_CODE must be 6–32 letters, numbers, or hyphens.');
  }
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO invite_codes (code, created_at, expires_at) VALUES (?, ?, ?)')
    .run(initialInvite, createdAt, expiresAt);
  console.log(`Bootstrap invite code: ${initialInvite}`);
}

const app = express();
const port = Number(process.env.PORT || 3001);
const categories = new Set(['Culture', 'Sports', 'Technology', 'Politics', 'Community', 'Science']);
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY?.trim() ?? '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY?.trim() ?? '';
const vapidSubject = process.env.VAPID_SUBJECT?.trim() ?? '';
const pushConfiguration = [vapidPublicKey, vapidPrivateKey, vapidSubject];
if (pushConfiguration.some(Boolean) && pushConfiguration.some((value) => !value)) {
  throw new Error('Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT together to enable Web Push.');
}
const pushEnabled = pushConfiguration.every(Boolean);
if (pushEnabled) webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
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

async function sendPushNotifications(subscriptions, payload) {
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webPush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify(payload));
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(subscription.endpoint);
        return;
      }
      console.error('Web Push delivery failed:', error);
    }
  }));
}

function dispatchPushNotifications(subscriptions, payload) {
  void sendPushNotifications(subscriptions, payload)
    .catch((error) => console.error('Could not complete Web Push delivery:', error));
}

function notifyNewPoll(market, creatorId) {
  if (!pushEnabled) return;
  const subscriptions = db.prepare(`
    SELECT push_subscriptions.endpoint, push_subscriptions.p256dh, push_subscriptions.auth
    FROM push_subscriptions
    JOIN notification_preferences ON notification_preferences.user_id = push_subscriptions.user_id
    WHERE notification_preferences.new_polls = 1 AND push_subscriptions.user_id != ?
  `).all(creatorId);
  dispatchPushNotifications(subscriptions, {
    title: 'A new poll is up',
    body: market.title,
    marketId: market.id,
    type: 'new-poll',
  });
}

function notifyPollResolved(marketId, title) {
  if (!pushEnabled) return;
  const subscriptions = db.prepare(`
    SELECT DISTINCT push_subscriptions.endpoint, push_subscriptions.p256dh, push_subscriptions.auth
    FROM push_subscriptions
    JOIN notification_preferences ON notification_preferences.user_id = push_subscriptions.user_id
    JOIN bets ON bets.user_id = push_subscriptions.user_id
    WHERE notification_preferences.participated_resolutions = 1 AND bets.market_id = ?
  `).all(marketId);
  dispatchPushNotifications(subscriptions, {
    title: 'A poll you joined was resolved',
    body: title,
    marketId,
    type: 'poll-resolved',
  });
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
      const now = new Date().toISOString();
      const invite = db.prepare(`
        SELECT code FROM invite_codes WHERE code = ? AND expires_at > ?
      `).get(inviteCode, now);
      if (!invite) throw Object.assign(new Error('That invitation code is invalid or expired.'), { status: 400 });

      const result = db.prepare(`
        INSERT INTO users (username, email, password_hash, balance, created_at)
        VALUES (?, ?, ?, 1000, ?)
      `).run(username, email, passwordHash, now);
      db.prepare(`
        INSERT INTO invite_redemptions (invite_code, user_id, redeemed_at) VALUES (?, ?, ?)
      `).run(invite.code, result.lastInsertRowid, now);
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
    SELECT invite_codes.code, invite_codes.created_at AS createdAt,
      invite_codes.expires_at AS expiresAt,
      COUNT(invite_redemptions.user_id) AS redeemedCount
    FROM invite_codes
    LEFT JOIN invite_redemptions ON invite_redemptions.invite_code = invite_codes.code
    WHERE invite_codes.created_by = ?
    GROUP BY invite_codes.code ORDER BY invite_codes.created_at DESC
  `).all(request.user.id);
  response.json({ invites });
});

app.post('/api/invites', requireUser, (request, response) => {
  const validForDays = Number(request.body.validForDays);
  if (![1, 7, 30].includes(validForDays)) {
    return response.status(400).json({ error: 'Choose an invite duration of 1, 7, or 30 days.' });
  }
  const code = randomBytes(6).toString('hex').toUpperCase();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + validForDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO invite_codes (code, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(code, request.user.id, createdAt, expiresAt);
  response.status(201).json({ invite: { code, createdAt, expiresAt, redeemedCount: 0 } });
});

app.get('/api/notifications/settings', requireUser, (request, response) => {
  const preferences = db.prepare(`
    SELECT new_polls AS newPolls, participated_resolutions AS participatedResolutions
    FROM notification_preferences WHERE user_id = ?
  `).get(request.user.id) ?? { newPolls: 0, participatedResolutions: 0 };
  const subscription = db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1')
    .get(request.user.id);
  response.json({
    pushEnabled,
    publicKey: pushEnabled ? vapidPublicKey : null,
    hasSubscription: Boolean(subscription),
    preferences: {
      newPolls: Boolean(preferences.newPolls),
      participatedResolutions: Boolean(preferences.participatedResolutions),
    },
  });
});

app.put('/api/notifications/preferences', requireUser, (request, response) => {
  const { newPolls, participatedResolutions } = request.body;
  if (typeof newPolls !== 'boolean' || typeof participatedResolutions !== 'boolean') {
    return response.status(400).json({ error: 'Set both notification preferences to true or false.' });
  }
  db.prepare(`
    INSERT INTO notification_preferences (user_id, new_polls, participated_resolutions)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET new_polls = excluded.new_polls,
      participated_resolutions = excluded.participated_resolutions
  `).run(request.user.id, Number(newPolls), Number(participatedResolutions));
  response.json({ preferences: { newPolls, participatedResolutions } });
});

app.post('/api/notifications/subscriptions', requireUser, (request, response) => {
  if (!pushEnabled) {
    return response.status(503).json({ error: 'Browser push is not configured on this server.' });
  }
  const { endpoint, keys } = request.body;
  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    return response.status(400).json({ error: 'Provide a valid push subscription.' });
  }
  if (parsedEndpoint.protocol !== 'https:' || typeof keys?.p256dh !== 'string' || !keys.p256dh
    || typeof keys?.auth !== 'string' || !keys.auth) {
    return response.status(400).json({ error: 'Provide a valid push subscription.' });
  }
  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id,
      p256dh = excluded.p256dh, auth = excluded.auth
  `).run(parsedEndpoint.href, request.user.id, keys.p256dh, keys.auth, new Date().toISOString());
  response.status(201).json({ ok: true });
});

app.delete('/api/notifications/subscriptions', requireUser, (request, response) => {
  const { endpoint } = request.body;
  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    return response.status(400).json({ error: 'Provide a valid push subscription.' });
  }
  if (parsedEndpoint.protocol !== 'https:') {
    return response.status(400).json({ error: 'Provide a valid push subscription.' });
  }
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .run(parsedEndpoint.href, request.user.id);
  const hasSubscription = Boolean(db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1')
    .get(request.user.id));
  response.json({ ok: true, hasSubscription });
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
        cancelledAt: market.cancelled_at,
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
  notifyNewPoll({ id, title: title.trim() }, request.user.id);
  response.status(201).json({ id });
});

app.patch('/api/markets/:id', requireUser, (request, response) => {
  const market = db.prepare('SELECT id, creator_id, status FROM markets WHERE id = ?').get(request.params.id);
  if (!market) return response.status(404).json({ error: 'Market not found.' });
  if (market.creator_id !== request.user.id) {
    return response.status(403).json({ error: 'Only the market creator can edit this market.' });
  }
  if (market.status !== 'open') {
    return response.status(409).json({ error: 'Resolved markets cannot be edited.' });
  }

  const { title, description, category, endsAt } = request.body;
  if (typeof title !== 'string' || title.trim().length < 8 || title.trim().length > 100) {
    return response.status(400).json({ error: 'Question must be between 8 and 100 characters.' });
  }
  if (typeof description !== 'string' || description.trim().length > 280) {
    return response.status(400).json({ error: 'Description must be 280 characters or fewer.' });
  }
  if (!categories.has(category)) return response.status(400).json({ error: 'Choose a valid category.' });
  const expiry = Date.parse(endsAt);
  if (!Number.isFinite(expiry) || expiry < Date.now() + 60_000 || expiry > Date.now() + 90 * 24 * 60 * 60 * 1000) {
    return response.status(400).json({ error: 'Choose an expiration from 1 minute to 90 days from now.' });
  }

  db.prepare(`
    UPDATE markets SET title = ?, description = ?, category = ?, ends_at = ? WHERE id = ?
  `).run(title.trim(), description.trim(), category, new Date(expiry).toISOString(), market.id);
  response.json({ ok: true });
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
  let resolvedTitle;
  try {
    db.transaction(() => {
      const market = db.prepare('SELECT * FROM markets WHERE id = ?').get(request.params.id);
      if (!market) throw Object.assign(new Error('Market not found.'), { status: 404 });
      if (market.status === 'resolved') throw Object.assign(new Error('This market has already been resolved.'), { status: 409 });
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
      resolvedTitle = market.title;
    })();
  } catch (error) {
    if (error.status) return response.status(error.status).json({ error: error.message });
    console.error(error);
    return response.status(500).json({ error: 'Could not resolve this market.' });
  }
  notifyPollResolved(request.params.id, resolvedTitle);
  response.json({ user: publicUser(db.prepare('SELECT id, username, balance FROM users WHERE id = ?').get(request.user.id)) });
});

app.post('/api/markets/:id/cancel', requireUser, (request, response) => {
  try {
    const result = db.transaction(() => {
      const market = db.prepare('SELECT id, creator_id, status FROM markets WHERE id = ?').get(request.params.id);
      if (!market) throw Object.assign(new Error('Market not found.'), { status: 404 });
      if (market.creator_id !== request.user.id) {
        throw Object.assign(new Error('Only the market creator can cancel this market.'), { status: 403 });
      }
      if (market.status !== 'open') {
        throw Object.assign(new Error('This market is already closed.'), { status: 409 });
      }

      const bets = db.prepare('SELECT user_id, amount FROM bets WHERE market_id = ?').all(market.id);
      const refund = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
      for (const bet of bets) {
        if (refund.run(bet.amount, bet.user_id).changes !== 1) {
          throw new Error(`Could not refund user ${bet.user_id} for market ${market.id}.`);
        }
      }
      const cancelledAt = new Date().toISOString();
      const closed = db.prepare(`
        UPDATE markets SET status = 'resolved', cancelled_at = ? WHERE id = ? AND status = 'open'
      `).run(cancelledAt, market.id);
      if (closed.changes !== 1) throw Object.assign(new Error('This market is already closed.'), { status: 409 });

      return {
        refundedCredits: bets.reduce((total, bet) => total + bet.amount, 0),
        refundedCallers: bets.length,
      };
    })();
    response.json({
      ...result,
      user: publicUser(db.prepare('SELECT id, username, balance FROM users WHERE id = ?').get(request.user.id)),
    });
  } catch (error) {
    if (error.status) return response.status(error.status).json({ error: error.message });
    console.error(error);
    return response.status(500).json({ error: 'Could not cancel this market and refund its callers.' });
  }
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