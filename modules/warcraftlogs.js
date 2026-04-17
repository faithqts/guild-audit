import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const CLIENT_ID = process.env.WCL_CLIENT_ID;
const CLIENT_SECRET = process.env.WCL_CLIENT_SECRET;

const GUILD_NAME = process.env.GUILD_NAME;
const SERVER_SLUG = process.env.SERVER_SLUG;
const SERVER_REGION = process.env.SERVER_REGION;

// Cache configuration
const CACHE_TTL_MINUTES = parseInt(process.env.CACHE_TTL_MINUTES, 10) || 15;
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'audit_data.json');

async function getAccessToken() {
  const body = new URLSearchParams();
  body.append('grant_type', 'client_credentials');

  const res = await axios.post(
    'https://www.warcraftlogs.com/oauth/token',
    body.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      auth: {
        username: CLIENT_ID,
        password: CLIENT_SECRET,
      },
    }
  );

  return res.data.access_token;
}

async function fetchGuildReports(accessToken, page = 1) {
  const query = `
    query GuildReports(
      $guildName: String!,
      $guildServerSlug: String!,
      $guildServerRegion: String!,
      $page: Int!
    ) {
      reportData {
        reports(
          guildName: $guildName
          guildServerSlug: $guildServerSlug
          guildServerRegion: $guildServerRegion
          page: $page
        ) {
          data {
            code
            title
            startTime
            endTime
            owner {
              name
            }
            guild {
              name
            }
            zone {
              id
              name
              difficulties {
                id
                name
              }
            }
          }
          has_more_pages
          current_page
          last_page
        }
      }
    }
  `;

  const variables = {
    guildName: GUILD_NAME,
    guildServerSlug: SERVER_SLUG,
    guildServerRegion: SERVER_REGION,
    page,
  };

  const res = await axios.post(
    'https://www.warcraftlogs.com/api/v2/client',
    { query, variables },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return res.data;
}

async function getAllGuildReports() {
  const token = await getAccessToken();

  let page = 1;
  let allReports = [];

  while (true) {
    const result = await fetchGuildReports(token, page);

    if (result.errors) {
      throw new Error(JSON.stringify(result.errors, null, 2));
    }

    const reports = result.data.reportData.reports;
    allReports.push(...reports.data);

    if (!reports.has_more_pages) break;
    page++;
  }

  return allReports;
}

async function fetchReportPlayers(accessToken, reportCode) {
  const fightsQuery = `
    query ReportFights($code: String!) {
      reportData {
        report(code: $code) {
          fights(killType: Encounters) {
            id
          }
        }
      }
    }
  `;

  const fightsRes = await axios.post(
    'https://www.warcraftlogs.com/api/v2/client',
    { query: fightsQuery, variables: { code: reportCode } },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (fightsRes.data.errors) {
    throw new Error(JSON.stringify(fightsRes.data.errors, null, 2));
  }

  const fightIDs = fightsRes.data.data.reportData.report.fights.map((f) => f.id);
  if (fightIDs.length === 0) return [];

  const query = `
    query ReportPlayers($code: String!, $fightIDs: [Int]!) {
      reportData {
        report(code: $code) {
          playerDetails(fightIDs: $fightIDs)
        }
      }
    }
  `;

  const res = await axios.post(
    'https://www.warcraftlogs.com/api/v2/client',
    { query, variables: { code: reportCode, fightIDs } },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (res.data.errors) {
    throw new Error(JSON.stringify(res.data.errors, null, 2));
  }

  const details = res.data.data.reportData.report.playerDetails.data.playerDetails;
  const seen = new Set();
  const players = [];
  const roleMap = { tanks: 'tank', healers: 'healer', dps: 'dps' };

  for (const role of ['tanks', 'healers', 'dps']) {
    for (const p of details[role] || []) {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        players.push({ name: p.name, realm: p.server, role: roleMap[role] });
      }
    }
  }

  return players;
}

function getResetCutoff(weeksBack = 4) {
  const RESET_HOUR_UTC = 15;
  const RESET_DAY = 2; // Tuesday

  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RESET_HOUR_UTC, 0, 0));
  const dayOffset = (d.getUTCDay() - RESET_DAY + 7) % 7;
  d.setUTCDate(d.getUTCDate() - dayOffset);
  if (d > now) d.setUTCDate(d.getUTCDate() - 7);
  d.setUTCDate(d.getUTCDate() - (weeksBack - 1) * 7);
  return d.getTime();
}

function buildPlayerList(attendance) {
  const totalReports = attendance.length;
  const latestReport = attendance.reduce((latest, r) =>
    !latest || r.start_time > latest.start_time ? r : latest, null);

  const appearanceCount = new Map();
  for (const report of attendance) {
    for (const p of report.players) {
      const key = `${p.name.toLowerCase()}-${p.realm.toLowerCase().replace(/'/g, '')}`;
      appearanceCount.set(key, (appearanceCount.get(key) || 0) + 1);
    }
  }

  const playerMap = new Map();
  const addPlayer = (p) => {
    const key = `${p.name.toLowerCase()}-${p.realm.toLowerCase().replace(/'/g, '')}`;
    if (!playerMap.has(key)) {
      playerMap.set(key, {
        name: p.name.toLowerCase(),
        realm: p.realm.toLowerCase().replace(/'/g, ''),
        role: p.role || null,
      });
    }
  };

  if (latestReport) {
    for (const p of latestReport.players) addPlayer(p);
  }

  const threshold = totalReports * 0.75;
  for (const report of attendance) {
    for (const p of report.players) {
      const key = `${p.name.toLowerCase()}-${p.realm.toLowerCase().replace(/'/g, '')}`;
      if (appearanceCount.get(key) >= threshold) addPlayer(p);
    }
  }

  return [...playerMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAuditData({ forceRefresh = false } = {}) {
  // Check cache first
  if (!forceRefresh) {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        const ageMs = Date.now() - new Date(cached.created).getTime();
        const ageMinutes = ageMs / 1000 / 60;

        if (ageMinutes < CACHE_TTL_MINUTES) {
          console.log(`Using cached data (${ageMinutes.toFixed(1)} min old, TTL: ${CACHE_TTL_MINUTES} min)`);
          return cached;
        }
        console.log(`Cache expired (${ageMinutes.toFixed(1)} min old, TTL: ${CACHE_TTL_MINUTES} min)`);
      }
    } catch (err) {
      console.warn('Cache read failed, fetching fresh data:', err.message);
    }
  }

  const allReports = await getAllGuildReports();
  const token = await getAccessToken();
  const cutoff = getResetCutoff(4);
  const recent = allReports.filter((r) => r.startTime >= cutoff && r.zone?.id === 46);

  const attendance = [];

  for (const report of recent) {
    const players = await fetchReportPlayers(token, report.code);
    const durationMs = report.endTime - report.startTime;
    const totalSecs = Math.floor(durationMs / 1000);
    const hours = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
    const mins = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
    const secs = String(totalSecs % 60).padStart(2, '0');

    attendance.push({
      report_id: report.code,
      owner: report.owner?.name ?? null,
      guild: report.guild?.name ?? null,
      players,
      title: report.title,
      start_time: new Date(report.startTime).toISOString(),
      end_time: new Date(report.endTime).toISOString(),
      duration: `${hours}:${mins}:${secs}`,
    });
  }

  const players = buildPlayerList(attendance);

  const result = { created: new Date().toISOString(), reports: attendance, players };

  // Write cache
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(result, null, 2));
    console.log(`Cache written to ${CACHE_FILE}`);
  } catch (err) {
    console.warn('Failed to write cache:', err.message);
  }

  return result;
}
