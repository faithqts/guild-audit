import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const RAIDERIO_SECRET = process.env.RAIDERIO_SECRET;
const SERVER_REGION = process.env.SERVER_REGION || 'us';

const DUNGEON_ILVL = {
  0: 256, 1: 256,
  2: 259, 3: 259,
  4: 263, 5: 263,
  6: 266,
  7: 269, 8: 269, 9: 269,
  10: 272,
};

const VAULT_THRESHOLDS = [1, 4, 8];

export async function getWeeklyRuns(name, realm) {
  const url = `https://raider.io/api/v1/characters/profile`;
  const res = await axios.get(url, {
    params: {
      access_key: RAIDERIO_SECRET,
      region: SERVER_REGION,
      realm,
      name,
      fields: 'mythic_plus_weekly_highest_level_runs',
    },
  });

  const runs = res.data.mythic_plus_weekly_highest_level_runs || [];

  // Sort descending by mythic_level (API usually returns sorted, but be safe)
  runs.sort((a, b) => b.mythic_level - a.mythic_level);

  const totalRuns = runs.length;
  const vault = VAULT_THRESHOLDS.map((threshold, i) => {
    if (totalRuns >= threshold) {
      const level = runs[threshold - 1].mythic_level;
      const capped = Math.min(level, 10);
      return {
        status: 'complete',
        ilvl: DUNGEON_ILVL[capped] ?? '?',
        level,
      };
    }
    return {
      status: 'incomplete',
      progress: totalRuns,
      threshold,
    };
  });

  return { runs: runs.length, vault };
}
