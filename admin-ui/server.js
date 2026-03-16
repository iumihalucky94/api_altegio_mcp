'use strict';

const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.ADMIN_UI_PORT || '65404', 10);
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || process.env.PGDATABASE || 'altegio_mcp',
  user: process.env.POSTGRES_USER || process.env.PGUSER || 'altegio_mcp',
  password: process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || ''
});

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'altegio-admin-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login');
}

app.get('/login', (req, res) => {
  if (req.session && req.session.authenticated) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const user = (req.body.username || '').trim();
  const pass = (req.body.password || '').trim();
  if (user === ADMIN_USER && pass === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.user = user;
    return res.redirect('/');
  }
  res.render('login', { error: 'Неверный логин или пароль' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.use(requireAuth);

app.get('/', (req, res) => res.render('dashboard'));

const dataPath = path.join(__dirname, 'data.json');
let cachedData = null;
function getData() {
  if (cachedData) return cachedData;
  try {
    cachedData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (e) {
    cachedData = { testCases: [], mutatingTools: [], smokeHandoff: [], smokeRespond: [], smokeBlocked: [] };
  }
  return cachedData;
}

app.get('/test-cases', (req, res) => {
  res.render('test-cases', { data: getData() });
});

app.get('/mutating-tools', (req, res) => {
  res.render('mutating-tools', { data: getData() });
});

app.get('/smoke-matrix', (req, res) => {
  res.render('smoke-matrix', { data: getData() });
});

app.get('/policies', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT s.code, s.name, sp.allow_agent_to_reply, sp.allow_agent_to_execute, sp.allow_agent_to_create_handoff,
             sp.requires_admin_approval, sp.confidence_threshold, sp.autonomy_mode, sp.id as policy_id
      FROM scenarios s
      JOIN scenario_policies sp ON sp.scenario_id = s.id
      WHERE s.is_active = true
      ORDER BY s.code
    `);
    res.render('policies', { policies: r.rows });
  } catch (e) {
    res.status(500).render('error', { message: e.message });
  }
});

app.post('/policies/update', async (req, res) => {
  const { policy_id, allow_agent_to_reply, allow_agent_to_execute, allow_agent_to_create_handoff } = req.body;
  if (!policy_id) return res.redirect('/policies');
  try {
    await pool.query(
      `UPDATE scenario_policies SET
        allow_agent_to_reply = $1, allow_agent_to_execute = $2, allow_agent_to_create_handoff = $3,
        updated_at = now()
       WHERE id = $4`,
      [
        allow_agent_to_reply === 'true' || allow_agent_to_reply === 'on',
        allow_agent_to_execute === 'true' || allow_agent_to_execute === 'on',
        allow_agent_to_create_handoff === 'true' || allow_agent_to_create_handoff === 'on',
        policy_id
      ]
    );
  } catch (e) {
    console.error(e);
  }
  res.redirect('/policies');
});

app.get('/handoffs', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT id::text, conversation_id, client_phone, summary, status, created_at::text
      FROM handoff_cases
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.render('handoffs', { handoffs: r.rows });
  } catch (e) {
    res.status(500).render('error', { message: e.message });
  }
});

/** Conversations that are on hold (bot not responding). States: AWAITING_ADMIN, ADMIN_TAKEOVER, BOT_PAUSED */
const ON_HOLD_STATES = ['AWAITING_ADMIN', 'ADMIN_TAKEOVER', 'BOT_PAUSED'];

app.get('/on-hold', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT c.conversation_id, c.client_phone, c.state, c.state_updated_at::text, c.detected_primary_language, c.current_scenario_code, c.last_inbound_at::text,
              (SELECT summary FROM handoff_cases h WHERE h.conversation_id = c.conversation_id AND h.status = 'OPEN' ORDER BY h.created_at DESC LIMIT 1) as last_handoff_summary
       FROM conversations c
       WHERE c.state = ANY($1::text[])
       ORDER BY c.state_updated_at DESC NULLS LAST
       LIMIT 100`,
      [ON_HOLD_STATES]
    );
    res.render('on-hold', {
      conversations: r.rows,
      released: req.query.released,
      error: req.query.error,
      active: 'on-hold'
    });
  } catch (e) {
    res.status(500).render('error', { message: e.message });
  }
});

app.post('/conversations/:conversationId/release', async (req, res) => {
  const { conversationId } = req.params;
  if (!conversationId) return res.redirect('/on-hold');
  try {
    const r = await pool.query(
      `UPDATE conversations SET state = 'BOT_ACTIVE', state_updated_at = now(), takeover_until = NULL WHERE conversation_id = $1 AND state = ANY($2::text[]) RETURNING conversation_id`,
      [conversationId, ON_HOLD_STATES]
    );
    if (r.rowCount > 0) {
      return res.redirect('/on-hold?released=1');
    }
    return res.redirect('/on-hold?released=0');
  } catch (e) {
    console.error(e);
    return res.redirect('/on-hold?error=1');
  }
});

app.get('/conversations', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT conversation_id, client_phone, state, detected_primary_language, current_scenario_code, last_inbound_at::text
      FROM conversations
      ORDER BY last_inbound_at DESC NULLS LAST
      LIMIT 100
    `);
    res.render('conversations', { conversations: r.rows });
  } catch (e) {
    res.status(500).render('error', { message: e.message });
  }
});

app.get('/reviews', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT r.id::text, r.conversation_id, r.reviewer_type, r.score_overall, r.comment, r.created_at::text,
             (SELECT array_agg(tag) FROM conversation_review_tags t WHERE t.review_id = r.id) as tags
      FROM conversation_reviews r
      ORDER BY r.created_at DESC
      LIMIT 50
    `);
    res.render('reviews', { reviews: r.rows });
  } catch (e) {
    res.status(500).render('error', { message: e.message });
  }
});

app.get('/events/:conversationId', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id::text, event_type, event_payload_json, created_at::text
       FROM conversation_events WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [req.params.conversationId]
    );
    res.render('events', { conversationId: req.params.conversationId, events: r.rows });
  } catch (e) {
    res.status(500).render('error', { message: e.message });
  }
});

app.get('/reviews/add', (req, res) => {
  const conversationId = req.query.conversationId || '';
  res.render('review-add', { conversationId });
});

app.post('/reviews/create', async (req, res) => {
  const { conversation_id, reviewer_type, score_overall, comment, tags } = req.body;
  if (!conversation_id || !reviewer_type) {
    return res.redirect('/reviews?error=missing');
  }
  try {
    const r = await pool.query(
      `INSERT INTO conversation_reviews (conversation_id, reviewer_type, score_overall, comment)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [conversation_id.trim(), reviewer_type.trim(), score_overall ? parseFloat(score_overall) : null, (comment || '').trim()]
    );
    const reviewId = r.rows[0].id;
    const tagList = typeof tags === 'string' ? tags.split(/[\s,]+/).map(s => s.trim()).filter(Boolean) : [];
    for (const tag of tagList) {
      await pool.query('INSERT INTO conversation_review_tags (review_id, tag) VALUES ($1, $2)', [reviewId, tag]);
    }
    res.redirect('/reviews');
  } catch (e) {
    console.error(e);
    res.status(500).render('error', { message: e.message });
  }
});

app.use((req, res) => res.status(404).send('Not found'));

pool.query('SELECT 1').then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Admin UI listening on port', PORT);
  });
}).catch(err => {
  console.error('Postgres connect failed:', err.message);
  process.exit(1);
});
