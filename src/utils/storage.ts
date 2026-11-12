import {
  createInitialSaveData,
  FISH_SPECIES,
  LURES,
  QUESTS,
} from '../data/gameData';
import {
  CaughtFishInstance,
  FishSpecies,
  RarityTier,
  SaveSlotData,
  TimeOfDay,
  WaterZoneId,
  WeatherType,
} from '../types/game';

const STORAGE_PREFIX = 'emerald_mirror_save_v1_slot_';
const ACTIVE_SLOT_KEY = 'emerald_mirror_active_slot_v1';

export function getActiveSlotId(): number {
  try {
    const raw = localStorage.getItem(ACTIVE_SLOT_KEY);
    const parsed = raw ? parseInt(raw, 10) : 1;
    return [1, 2, 3].includes(parsed) ? parsed : 1;
  } catch {
    return 1;
  }
}

export function setActiveSlotId(slotId: number): void {
  try {
    localStorage.setItem(ACTIVE_SLOT_KEY, String(slotId));
  } catch {
    // ignore storage quota errors
  }
}

export function loadSlotData(slotId: number): SaveSlotData {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${slotId}`);
    if (!raw) return createInitialSaveData(slotId);
    const parsed = JSON.parse(raw) as Partial<SaveSlotData>;
    return {
      ...createInitialSaveData(slotId),
      ...parsed,
      slotId,
    };
  } catch {
    return createInitialSaveData(slotId);
  }
}

export function saveSlotData(data: SaveSlotData): void {
  try {
    const updated: SaveSlotData = {
      ...data,
      updatedAt: Date.now(),
    };
    localStorage.setItem(`${STORAGE_PREFIX}${data.slotId}`, JSON.stringify(updated));
  } catch {
    // ignore storage quota errors
  }
}

export function resetSlotData(slotId: number): SaveSlotData {
  const fresh = createInitialSaveData(slotId);
  saveSlotData(fresh);
  return fresh;
}

export function exportSaveString(data: SaveSlotData): string {
  return btoa(encodeURIComponent(JSON.stringify(data)));
}

export function importSaveString(encoded: string, targetSlotId: number): SaveSlotData | null {
  try {
    const json = decodeURIComponent(atob(encoded.trim()));
    const parsed = JSON.parse(json) as Partial<SaveSlotData>;
    if (typeof parsed.gold !== 'number' || !Array.isArray(parsed.ownedRods)) {
      return null;
    }
    const merged: SaveSlotData = {
      ...createInitialSaveData(targetSlotId),
      ...parsed,
      slotId: targetSlotId,
      updatedAt: Date.now(),
    };
    saveSlotData(merged);
    return merged;
  } catch {
    return null;
  }
}

const RARITY_ORDER: Record<RarityTier, number> = {
  N: 1,
  R: 2,
  SR: 3,
  SSR: 4,
  UR: 5,
};

export function isRarityAtLeast(actual: RarityTier, minimum: RarityTier): boolean {
  return RARITY_ORDER[actual] >= RARITY_ORDER[minimum];
}

/**
 * Selects a fish species from the active water zone weighted by lure bonuses,
 * cast distance, time of day, and weather ecology.
 */
export function rollFishEncounter(
  zoneId: WaterZoneId,
  timeOfDay: TimeOfDay,
  weather: WeatherType,
  lureId: string,
  castPowerRatio: number,
  save: SaveSlotData,
): FishSpecies {
  const candidates = FISH_SPECIES.filter((f) => f.zoneId === zoneId);
  const lure = LURES.find((l) => l.id === lureId) ?? LURES[0];

  const baseRarityWeight: Record<RarityTier, number> = {
    N: 46,
    R: 30,
    SR: 16,
    SSR: 6.5,
    UR: 2.5,
  };

  const weights = candidates.map((fish) => {
    let w = baseRarityWeight[fish.rarity];

    // Apply lure rarity & guardian multipliers
    if (fish.rarity === 'SR' || fish.rarity === 'SSR' || fish.rarity === 'UR') {
      w *= lure.rareWeightBonus;
    }
    if (fish.isGuardian) {
      w *= lure.guardianBonus;
    }

    // Preferred lure direct match bonus
    if (fish.preferredLureIds?.includes(lure.id)) {
      w *= 1.85;
    }

    // Time of day ecological match
    if (fish.preferredTime) {
      w *= fish.preferredTime.includes(timeOfDay) ? 1.65 : 0.65;
    }

    // Weather ecological match
    if (fish.preferredWeather) {
      w *= fish.preferredWeather.includes(weather) ? 1.65 : 0.72;
    }

    // Deeper casts (> 65% power) attract larger/rarer fish
    if (castPowerRatio > 0.65 && RARITY_ORDER[fish.rarity] >= 3) {
      w *= 1.35;
    }

    // Water Deity Affinity subtle blessing
    if (save.affinity > 0 && fish.isGuardian) {
      w *= 1 + Math.min(save.affinity * 0.03, 0.45);
    }

    return Math.max(w, 0.5);
  });

  const totalW = weights.reduce((acc, v) => acc + v, 0);
  let roll = Math.random() * totalW;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      return candidates[i];
    }
  }
  return candidates[0];
}

export function createCaughtInstance(
  species: FishSpecies,
  save: SaveSlotData,
): CaughtFishInstance {
  // Slight bias toward trophy sizes with higher affinity/cast
  const u = Math.pow(Math.random(), 0.88);
  const weight = Number(
    (species.minWeight + u * (species.maxWeight - species.minWeight)).toFixed(2),
  );
  const weightNorm =
    (weight - species.minWeight) / Math.max(0.01, species.maxWeight - species.minWeight);
  const length = Number(
    (
      species.minLength +
      weightNorm * (species.maxLength - species.minLength) * (0.95 + Math.random() * 0.08)
    ).toFixed(1),
  );

  const sizeMultiplier = 0.85 + weightNorm * 0.65;
  const goldValue = Math.round(species.baseValue * sizeMultiplier);
  const pearlValue = species.pearlReward;

  const prevStats = save.speciesStats[species.id];
  const isNewSpecies = !prevStats || prevStats.count === 0;
  const isNewRecord = !prevStats || weight > prevStats.bestWeight;

  return {
    species,
    weight,
    length,
    goldValue,
    pearlValue,
    isNewSpecies,
    isNewRecord,
  };
}

export function evaluateQuestProgressOnAction(
  save: SaveSlotData,
  caught: CaughtFishInstance,
  action: 'keep' | 'release',
): SaveSlotData {
  const nextProgress = { ...save.questProgress };

  for (const quest of QUESTS) {
    if (save.completedQuests.includes(quest.id)) continue;
    if (quest.chapter > save.storyChapter) continue;

    const currentVal = nextProgress[quest.id] ?? 0;
    const req = quest.requirement;
    let delta = 0;

    if (req.type === 'catch_any') {
      delta = 1;
    } else if (req.type === 'catch_species' && req.targetId === caught.species.id) {
      delta = 1;
    } else if (req.type === 'catch_zone_count' && req.zoneId === caught.species.zoneId) {
      delta = 1;
    } else if (
      req.type === 'catch_rarity' &&
      req.rarity &&
      isRarityAtLeast(caught.species.rarity, req.rarity)
    ) {
      delta = 1;
    } else if (req.type === 'release_count' && action === 'release') {
      delta = 1;
    }

    if (delta > 0) {
      nextProgress[quest.id] = Math.min(req.count, currentVal + delta);
    }
  }

  return {
    ...save,
    questProgress: nextProgress,
  };
}

export function computePlayerTitle(save: SaveSlotData): string {
  const caughtSpeciesCount = Object.keys(save.speciesStats).length;
  if (save.speciesStats['aurelia_leviathan']?.count > 0) {
    return '永恆水鏡的傳奇守望者';
  }
  if (save.guardianScales.length >= 3) {
    return '三聖鱗共鳴的大釣師';
  }
  if (caughtSpeciesCount >= 10 || save.totalCount >= 20) {
    return '縱橫群島的尋鱗職人';
  }
  if (caughtSpeciesCount >= 4 || save.totalCount >= 5) {
    return '聽風辨水的溪湖釣客';
  }
  return '初臨水鏡的旅人';
}
