export enum FishingState {
  IDLE = 'IDLE',
  CHARGING = 'CHARGING',
  CASTING = 'CASTING',
  WAITING = 'WAITING',
  BITE = 'BITE',
  REELING = 'REELING',
  CAUGHT = 'CAUGHT',
}

export type WaterZoneId =
  | 'alpine_lake'
  | 'bamboo_brook'
  | 'coral_cove'
  | 'cloud_sanctuary';

export type TimeOfDay = 'dawn' | 'dusk' | 'night';

export type WeatherType = 'clear' | 'rain' | 'mist';

export type RarityTier = 'N' | 'R' | 'SR' | 'SSR' | 'UR';

export type FishBodyStyle =
  | 'trout'
  | 'bass'
  | 'carp'
  | 'ray'
  | 'tuna'
  | 'leviathan';

export interface FishSpecies {
  id: string;
  name: string;
  latinName: string;
  zoneId: WaterZoneId;
  rarity: RarityTier;
  rarityLabel: string;
  color: string;
  bodyColor: number;
  bellyColor: number;
  finColor: number;
  patternColor: number;
  glowColor?: number;
  bodyStyle: FishBodyStyle;
  minWeight: number;
  maxWeight: number;
  minLength: number;
  maxLength: number;
  pullStrength: number;
  speed: number;
  stamina: number;
  baseValue: number;
  pearlReward: number;
  preferredTime?: TimeOfDay[];
  preferredWeather?: WeatherType[];
  preferredLureIds?: string[];
  isGuardian?: boolean;
  scaleItemName?: string;
  lore: string;
}

export interface RodGear {
  id: string;
  name: string;
  tier: number;
  costGold: number;
  costPearls: number;
  maxCastDist: number;
  tensionBuffer: number; // reduces tension spike rate
  safeZoneBonus: number; // widens optimal tension zone
  blankColor: number;
  accentColor: number;
  handleColor: number;
  description: string;
}

export interface ReelGear {
  id: string;
  name: string;
  tier: number;
  costGold: number;
  costPearls: number;
  reelSpeed: number; // m/s pulled when reeling
  staminaDrain: number; // multiplier on draining fish stamina
  dragSmoothness: number; // reduces fish burst pull distance
  spoolColor: number;
  description: string;
}

export interface LineGear {
  id: string;
  name: string;
  tier: number;
  costGold: number;
  costPearls: number;
  maxTensionLimit: number; // effective break threshold forgivingness (1.0 - 1.45)
  lineColor: number;
  testKg: number;
  description: string;
}

export interface LureItem {
  id: string;
  name: string;
  costGold: number;
  costPearls: number;
  biteSpeedBonus: number; // faster bite wait
  rareWeightBonus: number; // boosts SR/SSR/UR weight
  guardianBonus: number; // extra multiplier for guardian/mythic fish
  bobberTopColor: number;
  antennaColor: number;
  targetHint: string;
  description: string;
}

export type NpcId = 'xuan' | 'mio' | 'bailu';

export interface NpcProfile {
  id: NpcId;
  name: string;
  title: string;
  accentColor: string;
  greeting: string;
  backstory: string;
}

export interface QuestRequirement {
  type: 'catch_any' | 'catch_species' | 'catch_zone_count' | 'catch_rarity' | 'release_count';
  targetId?: string;
  zoneId?: WaterZoneId;
  rarity?: RarityTier;
  minWeight?: number;
  count: number;
}

export interface QuestItem {
  id: string;
  chapter: number;
  npcId: NpcId;
  title: string;
  narrativeIntro: string;
  narrativeComplete: string;
  objectiveText: string;
  requirement: QuestRequirement;
  rewardGold: number;
  rewardPearls: number;
  unlockZoneId?: WaterZoneId;
  unlockLureId?: string;
}

export interface WaterZoneConfig {
  id: WaterZoneId;
  name: string;
  subtitle: string;
  depthText: string;
  activityText: string;
  unlockGold: number;
  unlockScaleCount: number;
  waterColor: number;
  waterEmissive: number;
  fogColorDusk: number;
  dockWoodColor: number;
  mountainColor: number;
  lore: string;
}

export interface SpeciesCatchStats {
  count: number;
  bestWeight: number;
  bestLength: number;
  firstCaughtAt: number;
}

export interface CaughtFishInstance {
  species: FishSpecies;
  weight: number;
  length: number;
  goldValue: number;
  pearlValue: number;
  isNewSpecies: boolean;
  isNewRecord: boolean;
}

export interface LiveFishingHudState {
  state: FishingState;
  statusMessage: string;
  isBiteUrgent: boolean;
  castPower: number;
  aimAngleDeg: number;
  lineTension: number;
  fishDistance: number;
  maxCastDistance: number;
  fishStamina: number;
  isFishBursting: boolean;
  activeFishRarity?: RarityTier;
}

export interface SaveSlotData {
  slotId: number;
  updatedAt: number;
  playerTitle: string;
  gold: number;
  pearls: number;
  affinity: number; // Water Deity affinity from releasing & quests
  totalCount: number;
  totalWeight: number;
  releasedCount: number;
  bestCatch: {
    speciesId: string;
    name: string;
    weight: number;
    length: number;
  } | null;
  currentZoneId: WaterZoneId;
  timeOfDay: TimeOfDay;
  weather: WeatherType;
  unlockedZones: WaterZoneId[];
  ownedRods: string[];
  ownedReels: string[];
  ownedLines: string[];
  ownedLures: string[];
  equippedRodId: string;
  equippedReelId: string;
  equippedLineId: string;
  equippedLureId: string;
  guardianScales: string[]; // species IDs of caught guardians
  speciesStats: Record<string, SpeciesCatchStats>;
  questProgress: Record<string, number>;
  completedQuests: string[];
  storyChapter: number;
  seenIntro: boolean;
}
