import { useState } from 'react';
import {
  BookOpen,
  Check,
  Compass,
  Copy,
  Hammer,
  Lock,
  RotateCcw,
  ScrollText,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  CHAPTER_TITLES,
  FISH_SPECIES,
  LINES,
  LURES,
  NPCS,
  QUESTS,
  REELS,
  RODS,
  WATER_ZONES,
} from '../data/gameData';
import {
  NpcId,
  SaveSlotData,
  TimeOfDay,
  WaterZoneId,
  WeatherType,
} from '../types/game';
import { FishPreview3D } from './FishPreview3D';
import { exportSaveString, loadSlotData } from '../utils/storage';

export type ActiveDrawerTab =
  | null
  | 'quests'
  | 'workshop'
  | 'encyclopedia'
  | 'world'
  | 'saves';

interface GameDrawersProps {
  activeTab: ActiveDrawerTab;
  onClose: () => void;
  onSwitchTab: (tab: ActiveDrawerTab) => void;
  save: SaveSlotData;
  isMuted: boolean;
  onToggleMute: () => void;
  onClaimQuest: (questId: string) => void;
  onBuyOrEquipRod: (rodId: string) => void;
  onBuyOrEquipReel: (reelId: string) => void;
  onBuyOrEquipLine: (lineId: string) => void;
  onBuyOrEquipLure: (lureId: string) => void;
  onUnlockOrTravelZone: (zoneId: WaterZoneId) => void;
  onChangeTimeOfDay: (time: TimeOfDay) => void;
  onChangeWeather: (weather: WeatherType) => void;
  onSwitchSlot: (slotId: number) => void;
  onResetSlot: (slotId: number) => void;
  onImportSave: (encoded: string) => boolean;
}

const TIME_LABELS: Record<TimeOfDay, string> = {
  dawn: '晨曦微光',
  dusk: '黃金黃昏',
  night: '靜謐星夜',
};

const WEATHER_LABELS: Record<WeatherType, string> = {
  clear: '晴朗無雲',
  rain: '煙雨微瀾',
  mist: '空谷靈霧',
};

export function GameDrawers({
  activeTab,
  onClose,
  onSwitchTab,
  save,
  isMuted,
  onToggleMute,
  onClaimQuest,
  onBuyOrEquipRod,
  onBuyOrEquipReel,
  onBuyOrEquipLine,
  onBuyOrEquipLure,
  onUnlockOrTravelZone,
  onChangeTimeOfDay,
  onChangeWeather,
  onSwitchSlot,
  onResetSlot,
  onImportSave,
}: GameDrawersProps) {
  const [selectedNpc, setSelectedNpc] = useState<NpcId>('xuan');
  const [workshopCategory, setWorkshopCategory] = useState<'rod' | 'reel' | 'line' | 'lure'>('rod');
  const [encZoneFilter, setEncZoneFilter] = useState<'all' | WaterZoneId>('all');
  const [selectedSpeciesId, setSelectedSpeciesId] = useState<string>(FISH_SPECIES[0].id);
  const [importText, setImportText] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [confirmResetSlot, setConfirmResetSlot] = useState<number | null>(null);

  if (!activeTab) return null;

  const filteredSpecies =
    encZoneFilter === 'all'
      ? FISH_SPECIES
      : FISH_SPECIES.filter((s) => s.zoneId === encZoneFilter);

  const inspectedSpecies =
    FISH_SPECIES.find((s) => s.id === selectedSpeciesId) ?? filteredSpecies[0] ?? FISH_SPECIES[0];
  const inspectedStats = save.speciesStats[inspectedSpecies.id];
  const isInspectedUnlocked = Boolean(inspectedStats && inspectedStats.count > 0);

  const discoveredTotal = Object.values(save.speciesStats).filter((s) => s.count > 0).length;

  const handleCopyExport = () => {
    const code = exportSaveString(save);
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopyStatus('存檔碼已複製至剪貼簿');
        setTimeout(() => setCopyStatus(''), 2500);
      },
      () => {
        setImportText(code);
        setCopyStatus('已產生存檔碼於下方輸入框');
      },
    );
  };

  const handleRunImport = () => {
    if (!importText.trim()) return;
    const ok = onImportSave(importText);
    setCopyStatus(ok ? '存檔匯入成功！' : '存檔碼格式無效，請確認後重試。');
    if (ok) setImportText('');
    setTimeout(() => setCopyStatus(''), 3000);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 md:p-8 bg-slate-950/60 pointer-events-auto">
      <div className="w-full max-w-5xl max-h-[86vh] flex flex-col rounded-2xl bg-[#0c131f]/96 border border-white/14 shadow-2xl text-slate-100 overflow-hidden">
        {/* Modal Header with Tab Switcher & Resource Summary */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/90 border border-white/8 overflow-x-auto">
            {[
              { id: 'quests' as const, label: '劇情委託', icon: ScrollText },
              { id: 'workshop' as const, label: '釣具工坊', icon: Hammer },
              { id: 'encyclopedia' as const, label: '生態圖鑑', icon: BookOpen },
              { id: 'world' as const, label: '秘境與天象', icon: Compass },
              { id: 'saves' as const, label: '存檔與音訊', icon: RotateCcw },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSwitchTab(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    active
                      ? 'bg-teal-500 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-5">
            <div className="flex items-center gap-3 text-sm font-mono tabular-nums text-slate-200">
              <span>{save.gold} 金幣</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-teal-300">{save.pearls} 水靈珠</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-amber-300">{save.guardianScales.length}/4 聖鱗</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="關閉面板"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* ==================== 1. STORY & NPC QUESTS ==================== */}
          {activeTab === 'quests' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Story Chapter & NPC Selector */}
              <div className="lg:col-span-5 space-y-5">
                <div className="rounded-xl bg-slate-900/80 border border-white/10 p-5">
                  <div className="text-xs text-teal-300 font-medium mb-1">
                    {CHAPTER_TITLES[save.storyChapter] ?? CHAPTER_TITLES[6]}
                  </div>
                  <h3 className="font-display text-xl font-bold text-slate-50 mb-2">
                    {save.playerTitle}
                  </h3>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    水鏡群島曾受遠古水神奧瑞莉亞庇佑。傾聽島民的委託、在四大水域收集守護聖鱗，沉睡的天際神殿終將再度開啟。
                  </p>
                  <div className="mt-4 pt-3 border-t border-white/8 flex items-center gap-3 text-xs text-slate-400 font-mono tabular-nums">
                    <span>已完成委託 {save.completedQuests.length}/{QUESTS.length}</span>
                    <span aria-hidden="true">·</span>
                    <span>水神親和度 {save.affinity}</span>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {(['xuan', 'mio', 'bailu'] as NpcId[]).map((npcId) => {
                    const npc = NPCS[npcId];
                    const isSelected = selectedNpc === npcId;
                    const readyCount = QUESTS.filter(
                      (q) =>
                        q.npcId === npcId &&
                        q.chapter <= save.storyChapter &&
                        !save.completedQuests.includes(q.id) &&
                        (save.questProgress[q.id] ?? 0) >= q.requirement.count,
                    ).length;

                    return (
                      <button
                        key={npcId}
                        type="button"
                        onClick={() => setSelectedNpc(npcId)}
                        className={`w-full text-left rounded-xl p-4 border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-slate-800/95 border-teal-400/50'
                            : 'bg-slate-900/60 border-white/8 hover:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-display text-lg font-bold text-slate-100">
                              {npc.name}
                            </span>
                            <span className="text-xs text-slate-400 ml-2">· {npc.title}</span>
                          </div>
                          {readyCount > 0 && (
                            <span className="text-xs font-semibold text-amber-300">
                              可領取回報 ({readyCount})
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-300 mt-2 leading-relaxed">
                          {npc.greeting}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: Quest List */}
              <div className="lg:col-span-7 space-y-4">
                <div className="rounded-xl bg-slate-900/50 border border-white/8 p-4">
                  <div className="text-xs text-slate-400">人物誌 · {NPCS[selectedNpc].title}</div>
                  <p className="text-sm text-slate-200 mt-1">{NPCS[selectedNpc].backstory}</p>
                </div>

                {QUESTS.filter(
                  (q) => q.npcId === selectedNpc && q.chapter <= save.storyChapter + 1,
                ).map((quest) => {
                  const isCompleted = save.completedQuests.includes(quest.id);
                  const isLocked = quest.chapter > save.storyChapter;
                  const progress = isCompleted
                    ? quest.requirement.count
                    : Math.min(quest.requirement.count, save.questProgress[quest.id] ?? 0);
                  const canClaim =
                    !isCompleted && !isLocked && progress >= quest.requirement.count;

                  return (
                    <div
                      key={quest.id}
                      className={`rounded-xl border p-5 ${
                        isCompleted
                          ? 'bg-slate-900/40 border-white/8 opacity-80'
                          : canClaim
                            ? 'bg-teal-950/35 border-teal-400/45'
                            : 'bg-slate-900/80 border-white/10'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <h4 className="font-display text-lg font-bold text-slate-100">
                          {quest.title}
                        </h4>
                        <span className="text-xs font-mono tabular-nums text-slate-400">
                          獎勵 +{quest.rewardGold} 金幣 · +{quest.rewardPearls} 水靈珠
                        </span>
                      </div>

                      <p className="text-sm text-slate-300 leading-relaxed mb-4">
                        {isCompleted ? quest.narrativeComplete : quest.narrativeIntro}
                      </p>

                      <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-white/8">
                        <div className="flex-1 min-w-[200px]">
                          <div className="flex justify-between text-xs text-slate-300 mb-1.5">
                            <span>{quest.objectiveText}</span>
                            <span className="font-mono tabular-nums">
                              {progress} / {quest.requirement.count}
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-teal-400 transition-transform duration-200 origin-left"
                              style={{
                                transform: `scaleX(${progress / quest.requirement.count})`,
                              }}
                            />
                          </div>
                        </div>

                        {isCompleted ? (
                          <span className="flex items-center gap-1.5 text-xs font-medium text-teal-300">
                            <Check className="w-4 h-4" /> 已完成委託
                          </span>
                        ) : isLocked ? (
                          <span className="flex items-center gap-1.5 text-xs text-slate-500">
                            <Lock className="w-3.5 h-3.5" /> 完成前序章節解鎖
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={!canClaim}
                            onClick={() => onClaimQuest(quest.id)}
                            className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                              canClaim
                                ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 cursor-pointer'
                                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            {canClaim ? '領取委託獎勵' : '進行中'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ==================== 2. TACKLE WORKSHOP ==================== */}
          {activeTab === 'workshop' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900 border border-white/10">
                  {[
                    { id: 'rod' as const, label: '釣竿鍛造' },
                    { id: 'reel' as const, label: '捲線器改造' },
                    { id: 'line' as const, label: '釣線升級' },
                    { id: 'lure' as const, label: '專屬擬餌' },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setWorkshopCategory(cat.id)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        workshopCategory === cat.id
                          ? 'bg-slate-100 text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400">
                  升級釣具將即時改變 3D 竿身塗裝、拋投距離與搏魚安全張力表現
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {workshopCategory === 'rod' &&
                  RODS.map((rod) => {
                    const owned = save.ownedRods.includes(rod.id);
                    const equipped = save.equippedRodId === rod.id;
                    const canAfford =
                      save.gold >= rod.costGold && save.pearls >= rod.costPearls;
                    return (
                      <div
                        key={rod.id}
                        className={`rounded-xl border p-5 flex flex-col justify-between ${
                          equipped
                            ? 'bg-teal-950/30 border-teal-400/50'
                            : 'bg-slate-900/80 border-white/10'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-display text-lg font-bold text-slate-100">
                              {rod.name}
                            </h4>
                            <span className="text-xs font-mono tabular-nums text-slate-400">
                              階級 T{rod.tier}
                            </span>
                          </div>
                          <p className="text-sm text-slate-300 mt-2 mb-4 leading-relaxed">
                            {rod.description}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-sky-300 mb-4">
                            <span>遠投上限 {rod.maxCastDist}m</span>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                            <span>張力緩衝 {Math.round(rod.tensionBuffer * 100)}%</span>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                            <span>安全區拓寬 +{rod.safeZoneBonus}%</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-white/8">
                          <div className="text-xs font-mono tabular-nums text-slate-300">
                            {owned
                              ? '已擁有'
                              : `${rod.costGold} 金幣 · ${rod.costPearls} 水靈珠`}
                          </div>
                          <button
                            type="button"
                            disabled={equipped || (!owned && !canAfford)}
                            onClick={() => onBuyOrEquipRod(rod.id)}
                            className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                              equipped
                                ? 'bg-teal-500/20 text-teal-300 cursor-default'
                                : owned
                                  ? 'bg-slate-100 hover:bg-white text-slate-950 cursor-pointer'
                                  : canAfford
                                    ? 'bg-teal-500 hover:bg-teal-400 text-slate-950 cursor-pointer'
                                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            {equipped ? '裝備中' : owned ? '裝備此竿' : '鍛造購買'}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                {workshopCategory === 'reel' &&
                  REELS.map((reel) => {
                    const owned = save.ownedReels.includes(reel.id);
                    const equipped = save.equippedReelId === reel.id;
                    const canAfford =
                      save.gold >= reel.costGold && save.pearls >= reel.costPearls;
                    return (
                      <div
                        key={reel.id}
                        className={`rounded-xl border p-5 flex flex-col justify-between ${
                          equipped
                            ? 'bg-teal-950/30 border-teal-400/50'
                            : 'bg-slate-900/80 border-white/10'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-display text-lg font-bold text-slate-100">
                              {reel.name}
                            </h4>
                            <span className="text-xs font-mono tabular-nums text-slate-400">
                              階級 T{reel.tier}
                            </span>
                          </div>
                          <p className="text-sm text-slate-300 mt-2 mb-4 leading-relaxed">
                            {reel.description}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-sky-300 mb-4">
                            <span>收線速度 {reel.reelSpeed.toFixed(1)}m/s</span>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                            <span>體力消耗 {Math.round(reel.staminaDrain * 100)}%</span>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                            <span>卸力穩定 {Math.round(reel.dragSmoothness * 100)}%</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-white/8">
                          <div className="text-xs font-mono tabular-nums text-slate-300">
                            {owned
                              ? '已擁有'
                              : `${reel.costGold} 金幣 · ${reel.costPearls} 水靈珠`}
                          </div>
                          <button
                            type="button"
                            disabled={equipped || (!owned && !canAfford)}
                            onClick={() => onBuyOrEquipReel(reel.id)}
                            className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                              equipped
                                ? 'bg-teal-500/20 text-teal-300 cursor-default'
                                : owned
                                  ? 'bg-slate-100 hover:bg-white text-slate-950 cursor-pointer'
                                  : canAfford
                                    ? 'bg-teal-500 hover:bg-teal-400 text-slate-950 cursor-pointer'
                                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            {equipped ? '裝備中' : owned ? '裝備此輪' : '鍛造購買'}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                {workshopCategory === 'line' &&
                  LINES.map((line) => {
                    const owned = save.ownedLines.includes(line.id);
                    const equipped = save.equippedLineId === line.id;
                    const canAfford =
                      save.gold >= line.costGold && save.pearls >= line.costPearls;
                    return (
                      <div
                        key={line.id}
                        className={`rounded-xl border p-5 flex flex-col justify-between ${
                          equipped
                            ? 'bg-teal-950/30 border-teal-400/50'
                            : 'bg-slate-900/80 border-white/10'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-display text-lg font-bold text-slate-100">
                              {line.name}
                            </h4>
                            <span className="text-xs font-mono tabular-nums text-slate-400">
                              拉力值 {line.testKg} kg
                            </span>
                          </div>
                          <p className="text-sm text-slate-300 mt-2 mb-4 leading-relaxed">
                            {line.description}
                          </p>
                          <div className="text-xs font-mono tabular-nums text-sky-300 mb-4">
                            抗斷線韌性加成 {Math.round(line.maxTensionLimit * 100)}%
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-white/8">
                          <div className="text-xs font-mono tabular-nums text-slate-300">
                            {owned
                              ? '已擁有'
                              : `${line.costGold} 金幣 · ${line.costPearls} 水靈珠`}
                          </div>
                          <button
                            type="button"
                            disabled={equipped || (!owned && !canAfford)}
                            onClick={() => onBuyOrEquipLine(line.id)}
                            className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                              equipped
                                ? 'bg-teal-500/20 text-teal-300 cursor-default'
                                : owned
                                  ? 'bg-slate-100 hover:bg-white text-slate-950 cursor-pointer'
                                  : canAfford
                                    ? 'bg-teal-500 hover:bg-teal-400 text-slate-950 cursor-pointer'
                                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            {equipped ? '裝備中' : owned ? '換上此線' : '購買釣線'}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                {workshopCategory === 'lure' &&
                  LURES.map((lure) => {
                    const owned = save.ownedLures.includes(lure.id);
                    const equipped = save.equippedLureId === lure.id;
                    const canAfford =
                      save.gold >= lure.costGold && save.pearls >= lure.costPearls;
                    return (
                      <div
                        key={lure.id}
                        className={`rounded-xl border p-5 flex flex-col justify-between ${
                          equipped
                            ? 'bg-teal-950/30 border-teal-400/50'
                            : 'bg-slate-900/80 border-white/10'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-display text-lg font-bold text-slate-100">
                              {lure.name}
                            </h4>
                            <span className="text-xs font-mono tabular-nums text-amber-300">
                              珍稀率 x{lure.rareWeightBonus.toFixed(1)}
                            </span>
                          </div>
                          <div className="text-xs text-teal-300 mt-1">{lure.targetHint}</div>
                          <p className="text-sm text-slate-300 mt-2 mb-4 leading-relaxed">
                            {lure.description}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-sky-300 mb-4">
                            <span>咬鉤速度 +{Math.round((lure.biteSpeedBonus - 1) * 100)}%</span>
                            <span aria-hidden="true" className="text-slate-600">·</span>
                            <span>魚王共鳴 x{lure.guardianBonus.toFixed(2)}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-3 border-t border-white/8">
                          <div className="text-xs font-mono tabular-nums text-slate-300">
                            {owned
                              ? '已擁有'
                              : `${lure.costGold} 金幣 · ${lure.costPearls} 水靈珠`}
                          </div>
                          <button
                            type="button"
                            disabled={equipped || (!owned && !canAfford)}
                            onClick={() => onBuyOrEquipLure(lure.id)}
                            className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                              equipped
                                ? 'bg-teal-500/20 text-teal-300 cursor-default'
                                : owned
                                  ? 'bg-slate-100 hover:bg-white text-slate-950 cursor-pointer'
                                  : canAfford
                                    ? 'bg-teal-500 hover:bg-teal-400 text-slate-950 cursor-pointer'
                                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            {equipped ? '掛載中' : owned ? '掛載擬餌' : '調製購買'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ==================== 3. ECOLOGICAL 3D ENCYCLOPEDIA ==================== */}
          {activeTab === 'encyclopedia' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900 border border-white/10 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setEncZoneFilter('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                      encZoneFilter === 'all'
                        ? 'bg-slate-100 text-slate-950 font-semibold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    全部水域
                  </button>
                  {WATER_ZONES.map((z) => (
                    <button
                      key={z.id}
                      type="button"
                      onClick={() => setEncZoneFilter(z.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                        encZoneFilter === z.id
                          ? 'bg-slate-100 text-slate-950 font-semibold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {z.name}
                    </button>
                  ))}
                </div>
                <div className="text-xs font-mono tabular-nums text-slate-300">
                  圖鑑收集率：{discoveredTotal} / {FISH_SPECIES.length} 種
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* Species Grid */}
                <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredSpecies.map((sp) => {
                    const st = save.speciesStats[sp.id];
                    const unlocked = Boolean(st && st.count > 0);
                    const selected = inspectedSpecies.id === sp.id;
                    return (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={() => setSelectedSpeciesId(sp.id)}
                        className={`text-left rounded-xl p-4 border transition-colors cursor-pointer ${
                          selected
                            ? 'bg-slate-800/95 border-teal-400/60'
                            : 'bg-slate-900/70 border-white/8 hover:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span style={{ color: unlocked ? sp.color : '#64748b' }}>
                            {sp.rarityLabel}
                          </span>
                          <span className="font-mono tabular-nums text-slate-400">
                            {unlocked ? `釣獲 ${st.count} 尾` : '未發現'}
                          </span>
                        </div>
                        <div className="font-display text-base font-bold text-slate-100">
                          {unlocked ? sp.name : '？？？未知魚影'}
                        </div>
                        <div className="text-xs text-slate-400 mt-1 font-mono tabular-nums">
                          {unlocked
                            ? `最大紀錄 ${st.bestWeight.toFixed(2)} kg · ${st.bestLength.toFixed(1)} cm`
                            : `棲息地：${WATER_ZONES.find((z) => z.id === sp.zoneId)?.name}`}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* 3D Turntable Inspector */}
                <div className="lg:col-span-5 rounded-xl bg-slate-900/90 border border-white/10 p-5 space-y-4">
                  <FishPreview3D
                    species={inspectedSpecies}
                    unlocked={isInspectedUnlocked}
                  />

                  <div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span style={{ color: inspectedSpecies.color }}>
                        {inspectedSpecies.rarityLabel}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {WATER_ZONES.find((z) => z.id === inspectedSpecies.zoneId)?.name}
                      </span>
                    </div>
                    <h4 className="font-display text-2xl font-bold text-slate-50 mt-1">
                      {isInspectedUnlocked ? inspectedSpecies.name : '未知的秘境魚影'}
                    </h4>
                    <p className="text-xs italic text-slate-400">
                      {isInspectedUnlocked ? inspectedSpecies.latinName : 'Species Undiscovered'}
                    </p>
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed">
                    {isInspectedUnlocked
                      ? inspectedSpecies.lore
                      : '尚未成功釣獲此魚種。可參考下方水文學者澪整理的出沒情報調整天象與擬餌。'}
                  </p>

                  <div className="pt-3 border-t border-white/10 space-y-1.5 text-xs text-slate-300">
                    <div>
                      <span className="text-slate-400">活躍時段：</span>
                      {inspectedSpecies.preferredTime
                        ? inspectedSpecies.preferredTime.map((t) => TIME_LABELS[t]).join(' / ')
                        : '全天候皆可遇見'}
                    </div>
                    <div>
                      <span className="text-slate-400">偏好天氣：</span>
                      {inspectedSpecies.preferredWeather
                        ? inspectedSpecies.preferredWeather
                            .map((w) => WEATHER_LABELS[w])
                            .join(' / ')
                        : '不限天氣'}
                    </div>
                    <div>
                      <span className="text-slate-400">推薦擬餌：</span>
                      {inspectedSpecies.preferredLureIds
                        ? inspectedSpecies.preferredLureIds
                            .map((lid) => LURES.find((l) => l.id === lid)?.name)
                            .filter(Boolean)
                            .join('、')
                        : '溪流羽翼毛鉤或任意擬餌'}
                    </div>
                    <div className="font-mono tabular-nums">
                      <span className="text-slate-400 font-sans">體型範圍：</span>
                      {inspectedSpecies.minWeight.toFixed(1)} ~{' '}
                      {inspectedSpecies.maxWeight.toFixed(1)} kg
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================== 4. WATER REALMS & ATMOSPHERE ==================== */}
          {activeTab === 'world' && (
            <div className="space-y-6">
              {/* Day/Night & Weather Instant Controls */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl bg-slate-900/80 border border-white/10 p-4">
                  <div className="text-xs text-slate-400 mb-2.5">
                    天光時段切換（影響水下魚群活性與光影）
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['dawn', 'dusk', 'night'] as TimeOfDay[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onChangeTimeOfDay(t)}
                        className={`py-2 px-3 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                          save.timeOfDay === t
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-slate-800 text-slate-300 hover:text-white'
                        }`}
                      >
                        {TIME_LABELS[t]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl bg-slate-900/80 border border-white/10 p-4">
                  <div className="text-xs text-slate-400 mb-2.5">
                    自然天候轉換（微雨與靈霧可引出特殊珍稀魚種）
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['clear', 'rain', 'mist'] as WeatherType[]).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => onChangeWeather(w)}
                        className={`py-2 px-3 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                          save.weather === w
                            ? 'bg-sky-400 text-slate-950'
                            : 'bg-slate-800 text-slate-300 hover:text-white'
                        }`}
                      >
                        {WEATHER_LABELS[w]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 4 Unlockable Water Biomes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {WATER_ZONES.map((zone) => {
                  const isUnlocked = save.unlockedZones.includes(zone.id);
                  const isCurrent = save.currentZoneId === zone.id;
                  const meetsScales = save.guardianScales.length >= zone.unlockScaleCount;
                  const canUnlock = isUnlocked || (meetsScales && save.gold >= zone.unlockGold);
                  const zoneSpecies = FISH_SPECIES.filter((f) => f.zoneId === zone.id);
                  const caughtInZone = zoneSpecies.filter(
                    (f) => (save.speciesStats[f.id]?.count ?? 0) > 0,
                  ).length;

                  return (
                    <div
                      key={zone.id}
                      className={`rounded-xl border p-5 flex flex-col justify-between ${
                        isCurrent
                          ? 'bg-teal-950/35 border-teal-400/55'
                          : 'bg-slate-900/80 border-white/10'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="font-display text-xl font-bold text-slate-50">
                            {zone.name}
                          </h4>
                          <span className="text-xs font-mono tabular-nums text-slate-400">
                            生態 {caughtInZone}/{zoneSpecies.length}
                          </span>
                        </div>
                        <div className="text-xs text-teal-300 mt-0.5">
                          {zone.subtitle} · 水深 {zone.depthText}
                        </div>
                        <p className="text-sm text-slate-300 mt-3 mb-4 leading-relaxed">
                          {zone.lore}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-white/8">
                        <div className="text-xs text-slate-400 font-mono tabular-nums">
                          {isUnlocked
                            ? '已開啟秘境航路'
                            : `解鎖需求：${zone.unlockGold} 金幣${
                                zone.unlockScaleCount > 0
                                  ? ` · ${zone.unlockScaleCount} 枚守護聖鱗`
                                  : ''
                              }`}
                        </div>
                        <button
                          type="button"
                          disabled={isCurrent || !canUnlock}
                          onClick={() => onUnlockOrTravelZone(zone.id)}
                          className={`px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                            isCurrent
                              ? 'bg-teal-500/20 text-teal-300 cursor-default'
                              : isUnlocked
                                ? 'bg-slate-100 hover:bg-white text-slate-950 cursor-pointer'
                                : canUnlock
                                  ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 cursor-pointer'
                                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          {isCurrent
                            ? '當前所在水域'
                            : isUnlocked
                              ? '前往此水域'
                              : '解鎖並前往'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ==================== 5. MULTI-SLOT SAVES & AUDIO ==================== */}
          {activeTab === 'saves' && (
            <div className="space-y-6">
              <div className="rounded-xl bg-slate-900/80 border border-white/10 p-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h4 className="font-display text-lg font-bold text-slate-100">
                    即時合成自然水聲與療癒配樂
                  </h4>
                  <p className="text-sm text-slate-400 mt-0.5">
                    透過 Web Audio API 即時演算湖波拍岸、煙雨聲與五聲音階空靈弦音
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onToggleMute}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/12 text-sm font-medium cursor-pointer"
                >
                  {isMuted ? (
                    <>
                      <VolumeX className="w-4 h-4 text-rose-400" />
                      <span>音訊已靜音（點擊開啟）</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-4 h-4 text-teal-300" />
                      <span>音訊播放中（點擊靜音）</span>
                    </>
                  )}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[1, 2, 3].map((slotNum) => {
                  const slotData = slotNum === save.slotId ? save : loadSlotData(slotNum);
                  const isCurrent = slotNum === save.slotId;
                  const dateStr = new Date(slotData.updatedAt).toLocaleString('zh-TW', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <div
                      key={slotNum}
                      className={`rounded-xl border p-5 flex flex-col justify-between ${
                        isCurrent
                          ? 'bg-teal-950/35 border-teal-400/50'
                          : 'bg-slate-900/80 border-white/10'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                          <span>本機存檔槽位 {slotNum}</span>
                          <span className="font-mono tabular-nums">{dateStr}</span>
                        </div>
                        <div className="font-display text-lg font-bold text-slate-100">
                          {slotData.playerTitle}
                        </div>
                        <div className="text-xs text-slate-300 mt-2 space-y-1 font-mono tabular-nums">
                          <div>第 {slotData.storyChapter} 章 · 漁獲 {slotData.totalCount} 尾</div>
                          <div>
                            {slotData.gold} 金幣 · {slotData.pearls} 水靈珠
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-white/8 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={isCurrent}
                          onClick={() => onSwitchSlot(slotNum)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                            isCurrent
                              ? 'bg-teal-500/20 text-teal-300 cursor-default'
                              : 'bg-slate-100 hover:bg-white text-slate-950'
                          }`}
                        >
                          {isCurrent ? '使用中' : '切換至此槽'}
                        </button>

                        {confirmResetSlot === slotNum ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                onResetSlot(slotNum);
                                setConfirmResetSlot(null);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer"
                            >
                              確定重置
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmResetSlot(null)}
                              className="px-2 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs cursor-pointer"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmResetSlot(slotNum)}
                            className="text-xs text-slate-400 hover:text-rose-300 transition-colors cursor-pointer"
                          >
                            重置進度
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Save Code Backup Export / Import */}
              <div className="rounded-xl bg-slate-900/80 border border-white/10 p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-100">
                      跨裝置存檔碼備份與還原
                    </h4>
                    <p className="text-xs text-slate-400">
                      本遊戲每回操作皆自動儲存於瀏覽器，您亦可匯出編碼字串永久保存傳奇紀錄
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyExport}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-medium cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>複製當前槽位存檔碼</span>
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder="貼上先前備份的存檔碼以覆蓋當前槽位..."
                    className="flex-1 rounded-lg bg-slate-950 border border-white/12 px-3 py-2 text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-teal-400"
                  />
                  <button
                    type="button"
                    onClick={handleRunImport}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>匯入存檔</span>
                  </button>
                </div>

                {copyStatus && <p className="text-xs text-teal-300">{copyStatus}</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
