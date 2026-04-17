import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'audit.html');
let templateCache = null;

function getTemplate() {
  if (!templateCache) {
    templateCache = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  }
  return templateCache;
}

function buildEnchantCell(slot, enchants) {
  const s = enchants[slot];
  if (!s) return '<td class="na">—</td>';
  const lowQualityIcon = '<img src="/images/low_quality.png" alt="Low Quality" class="status-icon">';
  const icon = s.result === 'pass' ? '✔️' : s.result === 'fail' ? '❌' : s.reason === 'tier' ? lowQualityIcon : '⚠️';
  const cls = s.result;
  let tip = '';
  if (s.result === 'fail') tip = 'Missing Enchant';
  else if (s.result === 'warn') tip = s.reason === 'cheap' ? 'Cheap Enchant' : 'Low Quality Enchant';
  else if (s.name) tip = s.name;
  const tipAttr = tip ? ` data-tooltip="${tip}"` : '';
  if (s.wowhead) {
    return `<td class="${cls}"${tipAttr}><a href="https://www.wowhead.com/item=${s.wowhead}" target="_blank" rel="noopener">${icon}</a></td>`;
  }
  return `<td class="${cls}"${tipAttr}>${icon}</td>`;
}

function buildGemCell(slot, gems) {
  const s = gems[slot];
  if (!s) return '<td class="na">—</td>';
  const lowQualityIcon = '<img src="/images/low_quality.png" alt="Low Quality" class="status-icon">';
  const icon = s.result === 'pass' ? '✔️' : s.result === 'fail' ? '❌' : s.reason === 'tier' ? lowQualityIcon : '⚠️';
  const cls = s.result;
  let tip = '';
  if (s.result === 'fail') tip = 'Missing Gem';
  else if (s.result === 'warn') tip = s.reason === 'cheap' ? 'Cheap Gem' : s.reason === 'tier' ? 'Low Quality Gem' : 'Missing Gem';
  else if (s.names?.length) tip = s.names.join(', ');
  const tipAttr = tip ? ` data-tooltip="${tip}"` : '';
  if (s.wowheads?.length) {
    const wh = s.wowheads[0];
    return `<td class="${cls}"${tipAttr}><a href="https://www.wowhead.com/item=${wh}" target="_blank" rel="noopener">${icon}</a></td>`;
  }
  return `<td class="${cls}"${tipAttr}>${icon}</td>`;
}

const EVERSONG_LABELS = {
  'Powerful Eversong Diamond': '+Stat and +Crit %',
  'Telluric Eversong Diamond': '+Stat and +Mana %',
  'Indecipherable Eversong Diamond': '++Stat',
};

function buildEversongCell(ed) {
  if (!ed?.result) return '<td class="na">—</td>';
  const lowQualityIcon = '<img src="/images/low_quality.png" alt="Low Quality" class="status-icon">';
  if (ed.result === 'pass' && ed.name && EVERSONG_LABELS[ed.name]) {
    const tip = EVERSONG_LABELS[ed.name];
    const tipAttr = ` data-tooltip="${tip}"`;
    if (ed.wowhead) {
      return `<td class="pass"${tipAttr}><a href="https://www.wowhead.com/item=${ed.wowhead}" target="_blank" rel="noopener">✔️</a></td>`;
    }
    return `<td class="pass"${tipAttr}>✔️</td>`;
  }
  const icon = ed.result === 'pass' ? '✔️' : ed.result === 'fail' ? '❌' : ed.reason === 'tier' ? lowQualityIcon : '⚠️';
  let tip = '';
  if (ed.result === 'fail') tip = 'Missing Gem';
  else if (ed.result === 'warn') tip = ed.reason === 'cheap' ? 'Cheap Gem' : 'Low Quality Gem';
  else if (ed.name) tip = ed.name;
  const tipAttr = tip ? ` data-tooltip="${tip}"` : '';
  if (ed.wowhead && ed.result !== 'fail') {
    return `<td class="${ed.result}"${tipAttr}><a href="https://www.wowhead.com/item=${ed.wowhead}" target="_blank" rel="noopener">${icon}</a></td>`;
  }
  return `<td class="${ed.result}"${tipAttr}>${icon}</td>`;
}

function buildVaultCells(vault, hasCrown) {
  if (!vault || !vault.length) return '<td class="na">—</td><td class="na">—</td><td class="na">—</td>';
  return vault.map((slot, i) => {
    if (slot.status === 'complete') {
      const tip = `+${slot.level} Key`;
      const cls = slot.level >= 10 ? 'vault-high' : slot.level >= 5 ? 'vault-mid' : 'vault-low';
      const crown = (i === 0 && hasCrown) ? '<span class="vault-crown">👑</span>' : '';
      return `<td class="${cls} vault-slot" data-tooltip="${tip}">${crown}${slot.ilvl}</td>`;
    }
    return `<td class="vault-incomplete">${slot.progress}/${slot.threshold}</td>`;
  }).join('');
}

function buildPlayerRow(p, hasCrown) {
  const e = p.enchants || {};
  const g = p.gems || {};
  const ef = (slot) => buildEnchantCell(slot, e);
  const gf = (slot) => buildGemCell(slot, g);
  const edCell = buildEversongCell(p.eversong_diamond);
  const vaultCells = buildVaultCells(p.vault, hasCrown);

  const auditCls = p.audit ? `audit-${p.audit}` : '';
  const auditTip = p.audit === 'pass' ? 'All Good' : p.audit === 'warn' ? 'Cheap or Low Quality Enhancements' : p.audit === 'fail' ? 'Missing Enchants / Gems' : '';
  const auditTipAttr = auditTip ? ` data-tooltip="${auditTip}"` : '';

  return `<tr>
        <td class="role-cell" data-role="${p.role || ''}">${p.role ? `<img src="/images/role_${p.role}.png" alt="${p.role}" title="${p.role}">` : '—'}</td>
        <td class="${auditCls}"${auditTipAttr}><a href="https://raider.io/characters/us/${encodeURIComponent(p.realm?.toLowerCase() || '')}/${encodeURIComponent(p.name || '')}" target="_blank" rel="noopener">${p.name || '?'}</a></td>
        <td>${p.item_level ?? '—'}</td>
        <td>${p.tier_set ?? '—'}</td>
        ${ef('HEAD')}${ef('SHOULDER')}${ef('CHEST')}${ef('LEGS')}${ef('FEET')}${ef('FINGER_1')}${ef('FINGER_2')}${ef('MAIN_HAND')}${ef('OFF_HAND')}
        ${gf('HEAD')}${gf('NECK')}${gf('WRIST')}${gf('WAIST')}${gf('FINGER_1')}${gf('FINGER_2')}
        ${edCell}
        ${vaultCells}
      </tr>`;
}

function pctColor(pct) {
  // 0% → red (#f87171), 50% → yellow (#fbbf24), 100% → green (#4ade80)
  let r, g, b;
  if (pct <= 50) {
    const t = pct / 50;
    r = Math.round(248 + (251 - 248) * t);
    g = Math.round(113 + (191 - 113) * t);
    b = Math.round(113 + (36 - 113) * t);
  } else {
    const t = (pct - 50) / 50;
    r = Math.round(251 + (74 - 251) * t);
    g = Math.round(191 + (222 - 191) * t);
    b = Math.round(36 + (128 - 36) * t);
  }
  return `rgb(${r},${g},${b})`;
}

function buildSummaryRow(players) {
  const n = players.length || 1;

  const enchantSlots = ['HEAD', 'SHOULDER', 'CHEST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2', 'MAIN_HAND', 'OFF_HAND'];
  const gemSlots = ['HEAD', 'NECK', 'WRIST', 'WAIST', 'FINGER_1', 'FINGER_2'];

  // Enchant pass counts (missing key = no enchant slot = pass)
  const enchantCells = enchantSlots.map(slot => {
    let pass = 0;
    for (const p of players) {
      const s = p.enchants?.[slot];
      if (!s || s.result === 'pass') pass++;
    }
    const pct = Math.round((pass / n) * 100);
    return `<td class="summary-pct" style="color:${pctColor(pct)}">${pct}%</td>`;
  });

  // Gem pass counts (missing key = no socket = pass)
  const gemCells = gemSlots.map(slot => {
    let pass = 0;
    for (const p of players) {
      const s = p.gems?.[slot];
      if (!s || s.result === 'pass') pass++;
    }
    const pct = Math.round((pass / n) * 100);
    return `<td class="summary-pct" style="color:${pctColor(pct)}">${pct}%</td>`;
  });

  // Eversong diamond (missing = pass)
  let edPass = 0;
  for (const p of players) {
    const ed = p.eversong_diamond;
    if (!ed?.result || ed.result === 'pass') edPass++;
  }
  const edPct = Math.round((edPass / n) * 100);
  const edCell = `<td class="summary-pct" style="color:${pctColor(edPct)}">${edPct}%</td>`;

  // Vault: pass = completed with level >= 10
  const vaultCells = [0, 1, 2].map(i => {
    let pass = 0;
    for (const p of players) {
      const slot = p.vault?.[i];
      if (slot?.status === 'complete' && slot.level >= 10) pass++;
    }
    const pct = Math.round((pass / n) * 100);
    return `<td class="summary-pct" style="color:${pctColor(pct)}">${pct}%</td>`;
  });

  return `<tr class="summary-row">
        <td colspan="4"></td>
        ${enchantCells.join('')}
        ${gemCells.join('')}
        ${edCell}
        ${vaultCells.join('')}
      </tr>`;
}

function normalizeSource(source) {
  return source === 'personal' ? 'personal' : 'guild';
}

function getAuditTitle(guildName, source) {
  if (source === 'personal') return 'Personal Audit';
  return `${guildName} Guild Audit`;
}

export function buildDashboardView(result, { source = 'guild', guildName = 'Guild' } = {}) {
  const normalizedSource = normalizeSource(source);
  const calendarLink = normalizedSource === 'guild'
    ? '<a href="https://www.warcraftlogs.com/guild/calendar/113432" target="_blank" rel="noopener">Guild Calendar (Logs)</a> · '
    : '';

  // Find the highest key level in any player's first vault slot
  let highestKey = 0;
  for (const p of result.players) {
    const firstSlot = p.vault?.[0];
    if (firstSlot?.status === 'complete' && firstSlot.level > highestKey) {
      highestKey = firstSlot.level;
    }
  }
  const rows = result.players.map(p => {
    const firstSlot = p.vault?.[0];
    const hasCrown = highestKey > 0 && firstSlot?.status === 'complete' && firstSlot.level === highestKey;
    return buildPlayerRow(p, hasCrown);
  }).join('\n');
  const summaryRow = buildSummaryRow(result.players);

  return {
    source: normalizedSource,
    auditTitle: getAuditTitle(guildName, normalizedSource),
    calendarLink,
    rows,
    summary: summaryRow,
    auditCreated: result.audit_created || '',
    playersCreated: result.players_created || '',
  };
}

export function renderDashboard(
  result,
  { source = 'guild', guildName = process.env.GUILD_NAME || 'Guild', showEditLink = false } = {}
) {
  const view = buildDashboardView(result, { source, guildName });
  const template = getTemplate();
  const footerLinks = showEditLink
    ? '<span class="audit-footer-left"><a class="audit-back-link" href="/">← Back to Home</a></span><span class="audit-footer-right"><a class="audit-back-link" href="/personal/edit">Edit Characters</a></span>'
    : '<span class="audit-footer-left"><a class="audit-back-link" href="/">← Back to Home</a></span>';

  return template
    .replace(/{{AUDIT_SOURCE}}/g, view.source)
    .replace(/{{AUDIT_TITLE}}/g, view.auditTitle)
    .replace(/{{AUDIT_HEADING}}/g, view.auditTitle)
    .replace(/{{CALENDAR_LINK}}/g, view.calendarLink)
    .replace(/{{FOOTER_LINKS}}/g, footerLinks)
    .replace('{{ROWS}}', view.rows)
    .replace('{{SUMMARY}}', view.summary)
    .replace(/{{AUDIT_CREATED}}/g, view.auditCreated)
    .replace(/{{PLAYERS_CREATED}}/g, view.playersCreated);
}
