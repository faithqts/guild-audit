import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getAuditData } from './modules/warcraftlogs.js';
import { getCharacterAudit } from './modules/blizzard.js';
import { getWeeklyRuns } from './modules/raiderio.js';
import routes, { setProviders } from './modules/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));

app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js'), {
  setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
}));

// ── Cache Config ──
const CACHE_DIR = path.join(__dirname, 'cache');
const AUDIT_CACHE_FILE = path.join(CACHE_DIR, 'audit_data.json');
const PLAYERS_CACHE_FILE = path.join(CACHE_DIR, 'players_data.json');
const PERSONAL_PLAYERS_CACHE_FILE = path.join(CACHE_DIR, 'personal_players_data.json');
const PERSONAL_DATA_FILE = path.join(__dirname, 'personal_data.json');

function normalizeSource(source) {
  return source === 'personal' ? 'personal' : 'guild';
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function parseIntervalMinutes(value, fallbackMinutes) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMinutes;
}

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(normalized);
}

// ── Audit Cache (WarcraftLogs) ──
function readAuditCache() {
  try {
    if (fs.existsSync(AUDIT_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(AUDIT_CACHE_FILE, 'utf-8'));
    }
  } catch (err) {
    console.warn('Audit cache read failed:', err.message);
  }
  return null;
}

function writeAuditCache(data) {
  try {
    ensureCacheDir();
    const cached = { created: new Date().toISOString(), ...data };
    fs.writeFileSync(AUDIT_CACHE_FILE, JSON.stringify(cached, null, 2));
    console.log('Audit cache written');
    return cached;
  } catch (err) {
    console.warn('Failed to write audit cache:', err.message);
  }
}

// ── Players Cache (Blizzard + RaiderIO) ──
function readPlayersCache() {
  try {
    if (fs.existsSync(PLAYERS_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(PLAYERS_CACHE_FILE, 'utf-8'));
    }
  } catch (err) {
    console.warn('Player cache read failed:', err.message);
  }
  return null;
}

function writePlayersCache(data) {
  try {
    ensureCacheDir();
    fs.writeFileSync(PLAYERS_CACHE_FILE, JSON.stringify(data, null, 2));
    console.log('Player cache written');
  } catch (err) {
    console.warn('Failed to write player cache:', err.message);
  }
}

// ── Personal Players Config + Cache ──
function readPersonalPlayerList() {
  try {
    if (!fs.existsSync(PERSONAL_DATA_FILE)) {
      fs.writeFileSync(PERSONAL_DATA_FILE, '[]\n');
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(PERSONAL_DATA_FILE, 'utf-8'));
    if (!Array.isArray(parsed)) {
      console.warn('personal_data.json is not an array; ignoring contents');
      return [];
    }

    const seen = new Set();
    const cleaned = [];
    for (const entry of parsed) {
      const name = String(entry?.name || '').trim();
      const realmSource = String(entry?.server || entry?.realm || '').trim();
      if (!name || !realmSource) continue;

      const realm = realmSource
        .toLowerCase()
        .replace(/'/g, '')
        .replace(/\s+/g, '-');
      const key = `${name.toLowerCase()}-${realm}`;
      if (seen.has(key)) continue;
      seen.add(key);

      cleaned.push({
        name,
        realm,
      });
    }

    return cleaned;
  } catch (err) {
    console.warn('Failed to read personal_data.json:', err.message);
    return [];
  }
}

function readPersonalPlayersCache() {
  try {
    if (fs.existsSync(PERSONAL_PLAYERS_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(PERSONAL_PLAYERS_CACHE_FILE, 'utf-8'));
    }
  } catch (err) {
    console.warn('Personal player cache read failed:', err.message);
  }
  return null;
}

function writePersonalPlayersCache(data) {
  try {
    ensureCacheDir();
    fs.writeFileSync(PERSONAL_PLAYERS_CACHE_FILE, JSON.stringify(data, null, 2));
    console.log('Personal player cache written');
  } catch (err) {
    console.warn('Failed to write personal player cache:', err.message);
  }
}

let refreshAuditLock = null;
let refreshPlayersLock = null;
let refreshPersonalPlayersLock = null;

// ── Refresh Audit (WarcraftLogs) ──
async function refreshAudit() {
  if (refreshAuditLock) {
    return refreshAuditLock;
  }

  const refreshJob = (async () => {
    console.log('Refreshing audit data (WarcraftLogs)...');
    const data = await getAuditData();
    const cached = writeAuditCache(data);
    console.log(`Audit refresh complete: ${data.players.length} players`);
    return cached;
  })();

  refreshAuditLock = refreshJob;
  try {
    return await refreshJob;
  } finally {
    refreshAuditLock = null;
  }
}

// ── Refresh Players (Blizzard + RaiderIO) ──
async function refreshPlayers() {
  if (refreshPlayersLock) {
    return refreshPlayersLock;
  }

  const refreshJob = (async () => {
    // Need audit data first
    let audit = readAuditCache();
    if (!audit) {
      audit = await refreshAudit();
    }

    console.log('Refreshing player data (Blizzard + RaiderIO)...');
    const enriched = await Promise.all(
      audit.players.map(async (player) => {
        try {
          const [charData, rioData] = await Promise.all([
            getCharacterAudit(player.name, player.realm),
            getWeeklyRuns(player.name, player.realm).catch(err => {
              console.error(`Failed RIO for ${player.name}-${player.realm}:`, err.message);
              return null;
            }),
          ]);
          return {
            ...player,
            ...charData.formatted,
            role: player.role || charData.formatted.role || null,
            ...(rioData ? { vault: rioData.vault } : {}),
          };
        } catch (err) {
          console.error(`Failed to audit ${player.name}-${player.realm}:`, err.message);
          return { ...player, audit_error: err.message };
        }
      })
    );

    const result = {
      audit_created: audit.created,
      players_created: new Date().toISOString(),
      players: enriched,
    };
    writePlayersCache(result);
    console.log(`Player refresh complete: ${enriched.length} players`);
    return result;
  })();

  refreshPlayersLock = refreshJob;
  try {
    return await refreshJob;
  } finally {
    refreshPlayersLock = null;
  }
}

// ── Refresh Personal Players (Blizzard + RaiderIO) ──
async function refreshPersonalPlayers() {
  if (refreshPersonalPlayersLock) {
    return refreshPersonalPlayersLock;
  }

  const refreshJob = (async () => {
    const personalPlayers = readPersonalPlayerList();
    console.log(`Refreshing personal player data: ${personalPlayers.length} players`);

    const enriched = await Promise.all(
      personalPlayers.map(async (player) => {
        try {
          const [charData, rioData] = await Promise.all([
            getCharacterAudit(player.name, player.realm),
            getWeeklyRuns(player.name, player.realm).catch(err => {
              console.error(`Failed RIO for ${player.name}-${player.realm}:`, err.message);
              return null;
            }),
          ]);

          return {
            ...player,
            ...charData.formatted,
            role: charData.formatted.role || null,
            ...(rioData ? { vault: rioData.vault } : {}),
          };
        } catch (err) {
          console.error(`Failed to audit personal player ${player.name}-${player.realm}:`, err.message);
          return { ...player, audit_error: err.message };
        }
      })
    );

    const now = new Date().toISOString();
    const result = {
      audit_created: now,
      players_created: now,
      players: enriched,
    };

    writePersonalPlayersCache(result);
    console.log(`Personal player refresh complete: ${enriched.length} players`);
    return result;
  })();

  refreshPersonalPlayersLock = refreshJob;
  try {
    return await refreshJob;
  } finally {
    refreshPersonalPlayersLock = null;
  }
}

// ── Get combined data for dashboard ──
async function getEnrichedPlayers(source = 'guild') {
  const normalizedSource = normalizeSource(source);
  if (normalizedSource === 'personal') {
    const personalCached = readPersonalPlayersCache();
    if (personalCached) return personalCached;
    return await refreshPersonalPlayers();
  }

  const guildCached = readPlayersCache();
  if (guildCached) return guildCached;
  return await refreshPlayers();
}

const refreshLocks = {
  guild: null,
  personal: null,
};

let refreshAllLock = null;

async function refreshSourceData(source = 'guild') {
  const normalizedSource = normalizeSource(source);

  if (refreshLocks[normalizedSource]) {
    return refreshLocks[normalizedSource];
  }

  const refreshJob = (async () => {
    if (normalizedSource === 'personal') {
      return await refreshPersonalPlayers();
    }
    await refreshAudit();
    return await refreshPlayers();
  })();

  refreshLocks[normalizedSource] = refreshJob;
  try {
    return await refreshJob;
  } finally {
    refreshLocks[normalizedSource] = null;
  }
}

async function refreshAllData() {
  if (refreshAllLock) {
    return refreshAllLock;
  }

  const refreshJob = Promise.all([
    refreshSourceData('guild'),
    refreshSourceData('personal'),
  ]);

  refreshAllLock = refreshJob;
  try {
    await refreshJob;
  } finally {
    refreshAllLock = null;
  }
}

function clearAuditCache() {
  try {
    if (fs.existsSync(AUDIT_CACHE_FILE)) {
      fs.unlinkSync(AUDIT_CACHE_FILE);
      console.log('Audit cache cleared');
    }
  } catch (err) {
    console.warn('Failed to clear audit cache:', err.message);
  }
}

function clearPlayersCache() {
  try {
    if (fs.existsSync(PLAYERS_CACHE_FILE)) {
      fs.unlinkSync(PLAYERS_CACHE_FILE);
      console.log('Player cache cleared');
    }
  } catch (err) {
    console.warn('Failed to clear player cache:', err.message);
  }
}

function clearPersonalPlayersCache() {
  try {
    if (fs.existsSync(PERSONAL_PLAYERS_CACHE_FILE)) {
      fs.unlinkSync(PERSONAL_PLAYERS_CACHE_FILE);
      console.log('Personal player cache cleared');
    }
  } catch (err) {
    console.warn('Failed to clear personal player cache:', err.message);
  }
}

function startInternalRefreshJobs() {
  const enabled = parseBooleanEnv(process.env.ENABLE_INTERNAL_REFRESH_JOBS, true);
  if (!enabled) {
    console.log('Internal refresh jobs are disabled');
    return;
  }

  const auditIntervalMinutes = parseIntervalMinutes(process.env.REFRESH_AUDIT_INTERVAL_MINUTES, 15);
  const playersIntervalMinutes = parseIntervalMinutes(process.env.REFRESH_PLAYERS_INTERVAL_MINUTES, 5);
  const runOnStart = parseBooleanEnv(process.env.REFRESH_JOBS_RUN_ON_START, false);

  const schedule = (label, intervalMinutes, job) => {
    const intervalMs = intervalMinutes * 60 * 1000;
    console.log(`Scheduling ${label} refresh every ${intervalMinutes} minute(s)`);
    return setInterval(() => {
      job().catch((err) => {
        console.error(`Scheduled ${label} refresh failed:`, err.message);
      });
    }, intervalMs);
  };

  schedule('audit', auditIntervalMinutes, refreshAudit);
  schedule('players', playersIntervalMinutes, refreshPlayers);

  if (runOnStart) {
    refreshAudit().catch((err) => {
      console.error('Startup scheduled audit refresh failed:', err.message);
    });
    refreshPlayers().catch((err) => {
      console.error('Startup scheduled player refresh failed:', err.message);
    });
  }
}

// ── Wire up routes ──
setProviders({
  getEnrichedPlayers,
  refreshSourceData,
  refreshAllData,
  refreshAudit,
  refreshPlayers,
  refreshPersonalPlayers,
  clearAuditCache,
  clearPlayersCache,
  clearPersonalPlayersCache,
});
app.use(routes);

app.listen(PORT, () => {
  console.log(`wow_audit server running on http://localhost:${PORT}`);

  // Pre-warm cache on startup
  const cached = readPlayersCache();
  if (!cached) {
    console.log('No valid cache found, fetching fresh data...');
    refreshPlayers()
      .then(result => console.log(`Startup cache ready: ${result.players.length} players`))
      .catch(err => console.error('Startup cache failed:', err.message));
  }

  const personalCached = readPersonalPlayersCache();
  if (!personalCached) {
    console.log('No personal cache found, fetching fresh personal data...');
    refreshPersonalPlayers()
      .then(result => console.log(`Startup personal cache ready: ${result.players.length} players`))
      .catch(err => console.error('Startup personal cache failed:', err.message));
  }

  startInternalRefreshJobs();
});
