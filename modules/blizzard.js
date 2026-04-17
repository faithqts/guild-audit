import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const CLIENT_ID = process.env.BNET_CLIENT_ID;
const CLIENT_SECRET = process.env.BNET_CLIENT_SECRET;

// Load item reference data
const refCsv = fs.readFileSync(path.join(__dirname, '..', 'data', 'item_reference.csv'), 'utf-8');
const refRows = refCsv.trim().split('\n').slice(1).map(line => {
  const [type, id, name, tier, slot, cheap, eversong_diamond, wowhead] = line.replace(/\r/g, '').split(',');
  return { type, id: parseInt(id, 10), name, tier: parseInt(tier, 10), slot, cheap: cheap.toLowerCase() === 'true', eversong_diamond: eversong_diamond.toLowerCase() === 'true', wowhead: wowhead ? parseInt(wowhead, 10) : null };
});
const enchantLookup = new Map(refRows.filter(r => r.type === 'enchant').map(r => [r.id, r]));
const gemLookup = new Map(refRows.filter(r => r.type === 'gem').map(r => [r.id, r]));

async function getAccessToken() {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const res = await axios.post(
    'https://us.battle.net/oauth/token',
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  return res.data.access_token;
}

const STATUS = {
  PASS: 'pass',
  WARN: 'warn',
  FAIL: 'fail',
};

const ROLE_MAP = {
  TANK: 'tank',
  HEALER: 'healer',
  HEALING: 'healer',
  DAMAGE: 'dps',
  DAMAGER: 'dps',
  DPS: 'dps',
};

const specRoleCache = new Map();

function normalizeRole(roleType) {
  if (!roleType) return null;
  return ROLE_MAP[String(roleType).toUpperCase()] || null;
}

function withLocale(href) {
  const url = new URL(href);
  if (!url.searchParams.has('locale')) {
    url.searchParams.set('locale', 'en_US');
  }
  return url.toString();
}

async function getCharacterRole(name, realm, accessToken) {
  try {
    const profileUrl = `https://us.api.blizzard.com/profile/wow/character/${encodeURIComponent(realm.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}?namespace=profile-us&locale=en_US`;
    const profileRes = await axios.get(profileUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const activeSpecHref = profileRes.data?.active_spec?.key?.href;
    if (!activeSpecHref) return null;

    if (specRoleCache.has(activeSpecHref)) {
      return specRoleCache.get(activeSpecHref);
    }

    const specRes = await axios.get(withLocale(activeSpecHref), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const role = normalizeRole(specRes.data?.role?.type || specRes.data?.role?.name);
    specRoleCache.set(activeSpecHref, role);
    return role;
  } catch (err) {
    console.warn(`Failed active spec role lookup for ${name}-${realm}:`, err.message);
    return null;
  }
}

function auditEquipment(equippedItems) {
  let socketsMax = 0;
  let socketsFilled = 0;
  let hasEversongDiamond = false;
  let cheapGems = 0;
  let tierCount = 0;
  const enchants = [];
  const gems = [];
  const missingEnchants = [];

  const allSlots = [
    'HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'WRIST',
    'HANDS', 'WAIST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2',
    'TRINKET_1', 'TRINKET_2', 'MAIN_HAND', 'OFF_HAND',
  ];
  const itemLevels = new Map();

  const enchantableSlots = new Set([
    'MAIN_HAND', 'OFF_HAND', 'HEAD', 'SHOULDER',
    'CHEST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2',
  ]);

  // Track which enchantable slots have an item equipped and whether it's enchanted
  const equippedSlots = new Map();

  for (const item of equippedItems) {
    // Track item levels per slot
    if (item.level && item.slot) {
      itemLevels.set(item.slot.type, item.level.value);
    }

    if (enchantableSlots.has(item.slot.type)) {
      equippedSlots.set(item.slot.type, { enchanted: false, item });
    }

    if (item.enchantments) {
      for (const ench of item.enchantments) {
        if (ench.enchantment_slot?.type === 'TEMPORARY') continue;
        if (equippedSlots.has(item.slot.type)) {
          equippedSlots.get(item.slot.type).enchanted = true;
        }
        const ref = enchantLookup.get(ench.enchantment_id);
        enchants.push({
          slot: item.slot.type,
          enchantment_id: ench.enchantment_id,
          name: ref ? ref.name : null,
          tier: ref ? ref.tier : null,
          cheap: ref ? ref.cheap : null,
          wowhead: ref ? ref.wowhead : null,
        });
      }
    }

    if (item.sockets) {
      socketsMax += item.sockets.length;
      for (const socket of item.sockets) {
        if (socket.item) {
          socketsFilled += 1;
          const gemRef = gemLookup.get(socket.item.id);
          if (gemRef) {
            if (gemRef.eversong_diamond) hasEversongDiamond = true;
            if (gemRef.cheap) cheapGems += 1;
            gems.push({
              slot: item.slot.type,
              item_id: socket.item.id,
              name: gemRef.name,
              tier: gemRef.tier,
              cheap: gemRef.cheap,
              eversong_diamond: gemRef.eversong_diamond,
              wowhead: gemRef.wowhead,
            });
          } else {
            gems.push({
              slot: item.slot.type,
              item_id: socket.item.id,
              name: socket.item.name,
              tier: null,
              cheap: null,
              eversong_diamond: false,
              wowhead: null,
            });
          }
        }
      }
    }

    // Detect tier set pieces (set with 5 items = tier set)
    if (item.set && item.set.items.length === 5) {
      tierCount += 1;
    }
  }

  // Determine which equipped enchantable slots are missing enchants
  // OFF_HAND only counts if it's a weapon (WEAPON or TWOHWEAPON inventory type)
  for (const [slot, info] of equippedSlots) {
    if (info.enchanted) continue;
    if (slot === 'OFF_HAND' &&
      !(info.item.inventory_type?.type === 'WEAPON' || info.item.inventory_type?.type === 'TWOHWEAPON')) continue;
    missingEnchants.push(slot);
  }

  // Calculate average item level
  // If 2H user (MAIN_HAND equipped, no OFF_HAND), count MAIN_HAND ilvl for both slots
  if (itemLevels.has('MAIN_HAND') && !itemLevels.has('OFF_HAND')) {
    itemLevels.set('OFF_HAND', itemLevels.get('MAIN_HAND'));
  }
  let ilvlTotal = 0;
  let ilvlCount = 0;
  for (const slot of allSlots) {
    if (itemLevels.has(slot)) {
      ilvlTotal += itemLevels.get(slot);
      ilvlCount += 1;
    }
  }
  const avgItemLevel = ilvlCount > 0 ? Math.round((ilvlTotal / allSlots.length) * 100) / 100 : 0;

  return {
    avg_item_level: avgItemLevel,
    sockets_max: socketsMax,
    sockets_filled: socketsFilled,
    sockets_missing: socketsMax - socketsFilled,
    eversong_diamond: hasEversongDiamond,
    cheap_gems: cheapGems,
    enchants,
    missing_enchants: missingEnchants,
    tier_set: {
      count: Math.min(tierCount, 4),
      '2p': tierCount >= 2,
      '4p': tierCount >= 4,
    },
    gems,
  };
}

export async function getCharacterAudit(name, realm) {
  const accessToken = await getAccessToken();
  const equipmentUrl = `https://us.api.blizzard.com/profile/wow/character/${encodeURIComponent(realm.toLowerCase())}/${encodeURIComponent(name.toLowerCase())}/equipment?namespace=profile-us&locale=en_US`;

  const [equipmentRes, role] = await Promise.all([
    axios.get(equipmentUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
    getCharacterRole(name, realm, accessToken),
  ]);

  const audit = auditEquipment(equipmentRes.data.equipped_items);
  const charName = equipmentRes.data.character.name;

  // Build formatted enchants: one entry per enchantable slot
  const enchantableSlots = [
    'HEAD', 'SHOULDER', 'CHEST', 'LEGS', 'FEET',
    'FINGER_1', 'FINGER_2', 'MAIN_HAND', 'OFF_HAND',
  ];
  const formattedEnchants = {};
  for (const slot of enchantableSlots) {
    // Skip OFF_HAND if not in missing_enchants and not in enchants (not equipped or not a weapon)
    const hasEnchant = audit.enchants.find(e => e.slot === slot);
    const isMissing = audit.missing_enchants.includes(slot);

    if (!hasEnchant && !isMissing) continue;

    if (isMissing) {
      formattedEnchants[slot] = { result: STATUS.FAIL, name: null, wowhead: null };
    } else if (hasEnchant.cheap || hasEnchant.tier === 1) {
      formattedEnchants[slot] = { result: STATUS.WARN, reason: hasEnchant.cheap ? 'cheap' : 'tier', name: hasEnchant.name, wowhead: hasEnchant.wowhead };
    } else {
      formattedEnchants[slot] = { result: STATUS.PASS, name: hasEnchant.name, wowhead: hasEnchant.wowhead };
    }
  }

  // Build formatted gems: one entry per socketed slot
  const formattedGems = {};
  // Check slots with sockets but no gems (missing)
  const allItems = equipmentRes.data.equipped_items;
  for (const item of allItems) {
    if (item.sockets && item.sockets.length > 0) {
      const slot = item.slot.type;
      const slotGems = audit.gems.filter(g => g.slot === slot);
      const emptyCount = item.sockets.length - slotGems.length;

      const gemNames = slotGems.map(g => g.name).filter(Boolean);
      const gemWowheads = slotGems.map(g => g.wowhead).filter(Boolean);

      if (emptyCount > 0 && slotGems.length === 0) {
        formattedGems[slot] = { result: STATUS.FAIL, names: [], wowheads: [] };
      } else if (emptyCount > 0) {
        formattedGems[slot] = { result: STATUS.WARN, reason: 'missing', names: gemNames, wowheads: gemWowheads };
      } else if (slotGems.some(g => g.cheap || g.tier === 1)) {
        const cheapGem = slotGems.find(g => g.cheap);
        formattedGems[slot] = { result: STATUS.WARN, reason: cheapGem ? 'cheap' : 'tier', names: gemNames, wowheads: gemWowheads };
      } else {
        formattedGems[slot] = { result: STATUS.PASS, names: gemNames, wowheads: gemWowheads };
      }
    }
  }

  // Determine eversong diamond status
  let eversongResult;
  let eversongName;
  let eversongWowhead;
  let eversongReason = null;
  if (!audit.eversong_diamond) {
    eversongResult = STATUS.FAIL;
    eversongName = null;
    eversongWowhead = null;
  } else {
    const eversongGem = audit.gems.find(g => g.eversong_diamond);
    eversongName = eversongGem ? eversongGem.name : null;
    eversongWowhead = eversongGem ? eversongGem.wowhead : null;
    if (eversongGem && (eversongGem.cheap || eversongGem.tier === 1)) {
      eversongResult = STATUS.WARN;
      eversongReason = eversongGem.cheap ? 'cheap' : 'tier';
    } else {
      eversongResult = STATUS.PASS;
    }
  }

  // Determine overall audit status
  const allResults = [
    ...Object.values(formattedEnchants).map(e => e.result),
    ...Object.values(formattedGems).map(g => g.result),
    eversongResult,
  ];
  let audit_status;
  if (allResults.some(r => r === STATUS.FAIL)) {
    audit_status = STATUS.FAIL;
  } else if (allResults.some(r => r === STATUS.WARN)) {
    audit_status = STATUS.WARN;
  } else {
    audit_status = STATUS.PASS;
  }

  return {
    formatted: {
      name: charName,
      role,
      item_level: audit.avg_item_level,
      tier_set: `${Math.min(audit.tier_set.count, 4)}/4`,
      audit: audit_status,
      enchants: formattedEnchants,
      gems: formattedGems,
      eversong_diamond: { result: eversongResult, reason: eversongReason, name: eversongName, wowhead: eversongWowhead },
    },
    raw: {
      name: charName,
      realm: realm,
      role,
      ...audit,
    },
  };
}
