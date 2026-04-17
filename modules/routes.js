import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAuditData } from './warcraftlogs.js';
import { getCharacterAudit } from './blizzard.js';
import { buildDashboardView, renderDashboard } from './dashboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const HOME_TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'index.html');
const AUTH_TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'auth.html');
const PERSONAL_EDIT_TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'personal_edit.html');
const PERSONAL_DATA_FILE = path.join(__dirname, '..', 'personal_data.json');

const AUTH_COOKIE_NAME = 'AuthToken';
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const router = express.Router();

// -- Providers (injected from main) --
let _providers = {};
export function setProviders(providers) {
  _providers = providers;
}

function normalizeSource(source) {
  return source === 'personal' ? 'personal' : 'guild';
}

function parseCookies(header = '') {
  if (!header) return {};
  return header
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((acc, cookie) => {
      const eqIndex = cookie.indexOf('=');
      if (eqIndex === -1) return acc;
      const key = cookie.slice(0, eqIndex).trim();
      const value = cookie.slice(eqIndex + 1).trim();
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function getConfiguredAuthToken() {
  return process.env.AUTH_TOKEN || process.env.AUTHTOKEN || process.env.AuthToken || '';
}

function hasEditorAccess(req) {
  const configured = getConfiguredAuthToken();
  if (!configured) return false;
  const cookies = parseCookies(req.headers.cookie);
  return cookies[AUTH_COOKIE_NAME] === configured;
}

function setEditorAuthCookie(res, token) {
  res.set(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`
  );
}

function clearEditorAuthCookie(res) {
  res.set(
    'Set-Cookie',
    `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
  );
}

function readTemplate(templatePath) {
  return fs.readFileSync(templatePath, 'utf-8');
}

function renderAuthPage({ title, message, actionsHtml, statusClass }) {
  const template = readTemplate(AUTH_TEMPLATE_PATH);
  return template
    .replace(/{{AUTH_TITLE}}/g, title)
    .replace(/{{AUTH_MESSAGE}}/g, message)
    .replace(/{{AUTH_ACTIONS}}/g, actionsHtml || '')
    .replace(/{{AUTH_STATUS_CLASS}}/g, statusClass || '');
}

function getAuthGrantedActions() {
  return '<a class="auth-action-link" href="/personal/edit">Open Personal Editor</a><a class="auth-action-link ghost" href="/personal">Go to Personal Audit</a><a class="auth-action-link ghost" href="/auth/revoke">Relinquish Access</a>';
}

function getHomeAdminCard(req) {
  if (!hasEditorAccess(req)) {
    return '';
  }

  return `
      <a class="audit-choice-card" href="/auth">
        <img class="audit-choice-banner" src="/images/admin.png" alt="Administration">
        <div class="audit-choice-body">
          <h2 class="audit-choice-title">Administration</h2>
          <p class="audit-choice-description">Open the protected admin panel to edit personal audit characters and trigger an immediate refresh.</p>
        </div>
      </a>`;
}

function ensurePersonalDataFile() {
  if (!fs.existsSync(PERSONAL_DATA_FILE)) {
    fs.writeFileSync(PERSONAL_DATA_FILE, '[]\n');
  }
}

function readPersonalDataList() {
  ensurePersonalDataFile();
  const raw = fs.readFileSync(PERSONAL_DATA_FILE, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('personal_data.json must contain a JSON array.');
  }
  return parsed;
}

function sanitizePersonalDataList(input) {
  if (!Array.isArray(input)) {
    throw new Error('Request body must be a JSON array of personal entries.');
  }

  return input.map((entry, index) => {
    const name = String(entry?.name || '').trim();
    const server = String(entry?.server || entry?.realm || '').trim();

    if (!name || !server) {
      throw new Error(`Entry at index ${index} requires non-empty name and server (or realm).`);
    }

    return { name, server };
  });
}

function writePersonalDataList(list) {
  fs.writeFileSync(PERSONAL_DATA_FILE, `${JSON.stringify(list, null, 2)}\n`);
}

function requireApiRefreshAuth(req, res) {
  const secret = process.env.REFRESH_SECRET;
  const provided = req.headers['authorization']?.replace('Bearer ', '');
  if (!provided || provided !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function renderAuditPage(req, res, source) {
  try {
    const result = await _providers.getEnrichedPlayers(source);
    const html = renderDashboard(result, {
      source,
      guildName: process.env.GUILD_NAME || 'Guild',
      showEditLink: hasEditorAccess(req),
    });
    res.send(html);
  } catch (err) {
    console.error('Dashboard error:', err.message);
    res.status(500).send('Error loading dashboard');
  }
}

// -- Landing Page --
router.get('/', (req, res) => {
  const guildName = process.env.GUILD_NAME || 'Guild';
  const template = readTemplate(HOME_TEMPLATE_PATH);
  const html = template
    .replace(/{{GUILD_NAME}}/g, guildName)
    .replace(/{{ADMIN_CARD}}/g, getHomeAdminCard(req));
  res.send(html);
});

// -- Auth Bootstrap for Personal Editor --
router.get('/auth', (req, res) => {
  const configuredToken = getConfiguredAuthToken();
  if (!configuredToken) {
    res.status(500).send(renderAuthPage({
      title: 'Auth Token Missing',
      message: 'AUTH_TOKEN is not configured in .env. Add it before using the personal editor.',
      actionsHtml: '<a class="auth-action-link" href="/">Return to Home</a>',
      statusClass: 'auth-card-error',
    }));
    return;
  }

  if (hasEditorAccess(req)) {
    res.send(renderAuthPage({
      title: 'Access Granted',
      message: 'You have been granted access and the Auth Token is active for this browser.',
      actionsHtml: getAuthGrantedActions(),
      statusClass: 'auth-card-success',
    }));
    return;
  }

  const providedToken = String(req.query.token || '');
  if (providedToken && providedToken === configuredToken) {
    setEditorAuthCookie(res, configuredToken);
    res.send(renderAuthPage({
      title: 'Access Granted',
      message: 'You have been granted access and the Auth Token is active for this browser.',
      actionsHtml: getAuthGrantedActions(),
      statusClass: 'auth-card-success',
    }));
    return;
  }

  res.redirect('/');
});

router.get('/auth/revoke', (req, res) => {
  clearEditorAuthCookie(res);
  res.send(renderAuthPage({
    title: 'Access Relinquished',
    message: 'The AuthToken cookie has been removed for this browser session.',
    actionsHtml: '<a class="auth-action-link" href="/">Return to Home</a>',
    statusClass: 'auth-card-error',
  }));
});

// -- Personal Editor Page --
router.get('/personal/edit', (req, res) => {
  if (!hasEditorAccess(req)) {
    res.redirect('/');
    return;
  }

  res.sendFile(PERSONAL_EDIT_TEMPLATE_PATH);
});

// -- Personal Data Editor APIs --
router.get('/api/personal-data', (req, res) => {
  if (!hasEditorAccess(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const list = readPersonalDataList();
    res.set('Cache-Control', 'no-store');
    res.json({ data: list, count: list.length });
  } catch (err) {
    console.error('Failed to read personal_data.json:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/personal-data', async (req, res) => {
  if (!hasEditorAccess(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const sanitized = sanitizePersonalDataList(req.body);
    writePersonalDataList(sanitized);

    _providers.clearPersonalPlayersCache();
    const refreshed = await _providers.refreshPersonalPlayers();

    res.json({
      status: 'ok',
      count: sanitized.length,
      refreshedCount: refreshed?.players?.length || 0,
      playersCreated: refreshed?.players_created || null,
    });
  } catch (err) {
    const isBadInput = /Request body must be a JSON array|Entry at index/.test(err.message);
    if (!isBadInput) {
      console.error('Failed to update personal_data.json:', err.message);
    }
    res.status(isBadInput ? 400 : 500).json({ error: err.message });
  }
});

// -- Dashboard Pages --
router.get('/guild', async (req, res) => {
  await renderAuditPage(req, res, 'guild');
});

router.get('/personal', async (req, res) => {
  await renderAuditPage(req, res, 'personal');
});

// -- Dashboard Data (AJAX refresh, no full page reload) --
router.get('/api/dashboard-data', async (req, res) => {
  try {
    const source = normalizeSource(req.query.source);
    const shouldRefresh = req.query.refresh !== 'false';

    if (shouldRefresh) {
      await _providers.refreshSourceData(source);
    }

    const result = await _providers.getEnrichedPlayers(source);
    const view = buildDashboardView(result, {
      source,
      guildName: process.env.GUILD_NAME || 'Guild',
    });

    res.set('Cache-Control', 'no-store');
    res.json({
      source: view.source,
      auditTitle: view.auditTitle,
      rowsHtml: view.rows,
      summaryHtml: view.summary,
      auditCreated: view.auditCreated,
      playersCreated: view.playersCreated,
    });
  } catch (err) {
    console.error('Dashboard data error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -- Character Audit --
router.get('/api/character/:realm/:name', async (req, res) => {
  try {
    const { name, realm } = req.params;
    const data = await getCharacterAudit(name, realm);
    res.json(data);
  } catch (err) {
    console.error('Character audit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -- Full Audit --
router.get('/api/audit', async (req, res) => {
  try {
    console.log('Fetching audit data...');
    const data = await getAuditData();
    console.log(`Returned ${data.reports.length} reports, ${data.players.length} players`);
    res.json(data);
  } catch (err) {
    console.error('Audit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// -- Reports --
router.get('/api/audit/reports', async (req, res) => {
  try {
    const data = await getAuditData();
    res.json(data.reports);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -- Enriched Players --
router.get('/api/audit/players', async (req, res) => {
  try {
    const result = await _providers.getEnrichedPlayers('guild');
    res.json(result.players);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -- Refresh Audit (WarcraftLogs) --
router.post('/api/refresh/audit', async (req, res) => {
  if (!requireApiRefreshAuth(req, res)) return;
  _providers.clearAuditCache();
  res.json({ status: 'accepted', message: 'Audit cache cleared, refresh started' });
  try {
    await _providers.refreshAudit();
  } catch (err) {
    console.error('Background audit refresh error:', err.message);
  }
});

// -- Refresh Players (Blizzard + RaiderIO) --
router.post('/api/refresh/players', async (req, res) => {
  if (!requireApiRefreshAuth(req, res)) return;
  _providers.clearPlayersCache();
  res.json({ status: 'accepted', message: 'Player cache cleared, refresh started' });
  try {
    await _providers.refreshPlayers();
  } catch (err) {
    console.error('Background player refresh error:', err.message);
  }
});

// -- Refresh Personal Players (Blizzard + RaiderIO) --
router.post('/api/refresh/personal', async (req, res) => {
  if (!requireApiRefreshAuth(req, res)) return;
  _providers.clearPersonalPlayersCache();
  res.json({ status: 'accepted', message: 'Personal player cache cleared, refresh started' });
  try {
    await _providers.refreshPersonalPlayers();
  } catch (err) {
    console.error('Background personal refresh error:', err.message);
  }
});

// -- Refresh All (legacy) --
router.post('/api/refresh', async (req, res) => {
  if (!requireApiRefreshAuth(req, res)) return;
  _providers.clearAuditCache();
  _providers.clearPlayersCache();
  _providers.clearPersonalPlayersCache();
  res.json({ status: 'accepted', message: 'All caches cleared, refresh started' });
  try {
    await _providers.refreshAudit();
    await _providers.refreshPlayers();
    await _providers.refreshPersonalPlayers();
  } catch (err) {
    console.error('Background full refresh error:', err.message);
  }
});

export default router;
