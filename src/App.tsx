/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
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
} from './data/gameData';
import {
  CaughtFishInstance,
  FishingState,
  LiveFishingHudState,
  SaveSlotData,
  TimeOfDay,
  WaterZoneId,
  WeatherType,
} from './types/game';
import {
  computePlayerTitle,
  evaluateQuestProgressOnAction,
  getActiveSlotId,
  importSaveString,
  loadSlotData,
  resetSlotData,
  saveSlotData,
  setActiveSlotId,
} from './utils/storage';
import { FishingSceneController } from './three/FishingSceneController';
import { soundEngine } from './audio/soundEngine';
import { CatchModal } from './components/CatchModal';
import { ActiveDrawerTab, GameDrawers } from './components/GameDrawers';

const TIME_ORDER: TimeOfDay[] = ['dawn', 'dusk', 'night'];
const TIME_SHORT: Record<TimeOfDay, string> = {
  dawn: '晨曦',
  dusk: '黃昏',
  night: '星夜',
};

const WEATHER_ORDER: WeatherType[] = ['clear', 'rain', 'mist'];
const WEATHER_SHORT: Record<WeatherType, string> = {
  clear: '晴朗',
  rain: '微雨',
  mist: '靈霧',
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneControllerRef = useRef<FishingSceneController | null>(null);

  const [save, setSave] = useState<SaveSlotData>(() => loadSlotData(getActiveSlotId()));
  const saveRef = useRef<SaveSlotData>(save);
  saveRef.current = save;

  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawerTab>(null);
  const [caughtFish, setCaughtFish] = useState<CaughtFishInstance | null>(null);
  const [zenCollapsed, setZenCollapsed] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    tone: 'info' | 'warning' | 'success';
  } | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const [hud, setHud] = useState<LiveFishingHudState>({
    state: FishingState.IDLE,
    statusMessage: '滑鼠微調拋投方向 · 按住 [滑鼠左鍵] 或 [空白鍵] 蓄力拋竿',
    isBiteUrgent: false,
    castPower: 0,
    aimAngleDeg: 0,
    lineTension: 30,
    fishDistance: 20,
    maxCastDistance: 20,
    fishStamina: 100,
    isFishBursting: false,
  });

  const pushNotice = useCallback(
    (text: string, tone: 'info' | 'warning' | 'success' = 'info') => {
      setNotice({ text, tone });
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => {
        setNotice(null);
      }, 3800);
    },
    [],
  );

  const commitSave = useCallback((updater: (prev: SaveSlotData) => SaveSlotData) => {
    setSave((prev) => {
      const next = updater(prev);
      const withTitle: SaveSlotData = {
        ...next,
        playerTitle: computePlayerTitle(next),
      };
      saveSlotData(withTitle);
      sceneControllerRef.current?.applyEnvironmentAndGear(withTitle, false);
      return withTitle;
    });
  }, []);

  // Mount isolated Three.js WebGL scene once
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    const controller = new FishingSceneController(container, saveRef.current, {
      onHudUpdate: (nextHud) => setHud(nextHud),
      onFishCaught: (caught) => setCaughtFish(caught),
      onNotice: (msg, tone) => pushNotice(msg, tone),
    });
    sceneControllerRef.current = controller;

    return () => {
      controller.dispose();
      sceneControllerRef.current = null;
    };
  }, [pushNotice]);

  // Block 3D casting input while modals/drawers are open
  useEffect(() => {
    const blocked = Boolean(activeDrawer || caughtFish);
    sceneControllerRef.current?.setUiBlocked(blocked);
  }, [activeDrawer, caughtFish]);

  // Global keyboard shortcuts (H for Zen Mode, Esc to close drawers)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === 'KeyH' && !activeDrawer && !caughtFish) {
        setZenCollapsed((prev) => !prev);
      } else if (e.code === 'Escape' && activeDrawer) {
        setActiveDrawer(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDrawer, caughtFish]);

  // Resolve Caught Fish (Keep vs Release & Bless)
  const handleResolveCatch = useCallback(
    (action: 'keep' | 'release') => {
      if (!caughtFish) return;
      soundEngine.playUiChime();

      const { species, weight, length, goldValue, pearlValue } = caughtFish;
      const earnedGold = action === 'keep' ? goldValue : Math.max(10, Math.round(goldValue * 0.45));
      const earnedPearls = action === 'keep' ? pearlValue : pearlValue * 2 + 1;

      commitSave((prev) => {
        const prevSp = prev.speciesStats[species.id];
        const nextSpeciesStats = {
          ...prev.speciesStats,
          [species.id]: {
            count: (prevSp?.count ?? 0) + 1,
            bestWeight: Math.max(prevSp?.bestWeight ?? 0, weight),
            bestLength: Math.max(prevSp?.bestLength ?? 0, length),
            firstCaughtAt: prevSp?.firstCaughtAt ?? Date.now(),
          },
        };

        const nextBestCatch =
          !prev.bestCatch || weight > prev.bestCatch.weight
            ? { speciesId: species.id, name: species.name, weight, length }
            : prev.bestCatch;

        const nextScales =
          species.isGuardian && !prev.guardianScales.includes(species.id)
            ? [...prev.guardianScales, species.id]
            : prev.guardianScales;

        let updated: SaveSlotData = {
          ...prev,
          seenIntro: true,
          gold: prev.gold + earnedGold,
          pearls: prev.pearls + earnedPearls,
          affinity: prev.affinity + (action === 'release' ? 2 : 0),
          totalCount: prev.totalCount + 1,
          totalWeight: Number((prev.totalWeight + weight).toFixed(2)),
          releasedCount: prev.releasedCount + (action === 'release' ? 1 : 0),
          bestCatch: nextBestCatch,
          guardianScales: nextScales,
          speciesStats: nextSpeciesStats,
        };

        updated = evaluateQuestProgressOnAction(updated, caughtFish, action);
        return updated;
      });

      if (action === 'release') {
        pushNotice(
          `將【${species.name}】溫柔放回水鏡，水神親和度提升並獲得 +${earnedPearls} 水靈珠！`,
          'success',
        );
      } else {
        pushNotice(
          `已將【${species.name}】(${weight.toFixed(2)} kg) 收入魚護，獲得 +${earnedGold} 金幣！`,
          'success',
        );
      }

      setCaughtFish(null);
      sceneControllerRef.current?.dismissCaughtShowcase();
    },
    [caughtFish, commitSave, pushNotice],
  );

  // Claim NPC Story Quest
  const handleClaimQuest = useCallback(
    (questId: string) => {
      const quest = QUESTS.find((q) => q.id === questId);
      if (!quest) return;
      soundEngine.playCatchFanfare('SR');

      commitSave((prev) => {
        if (prev.completedQuests.includes(questId)) return prev;
        const nextCompleted = [...prev.completedQuests, questId];
        const nextUnlockedZones =
          quest.unlockZoneId && !prev.unlockedZones.includes(quest.unlockZoneId)
            ? [...prev.unlockedZones, quest.unlockZoneId]
            : prev.unlockedZones;

        // Advance storyChapter if all quests of current chapter are completed
        let nextChapter = prev.storyChapter;
        while (nextChapter <= 5) {
          const chapterQuests = QUESTS.filter((q) => q.chapter === nextChapter);
          const allDone =
            chapterQuests.length > 0 &&
            chapterQuests.every((q) => nextCompleted.includes(q.id));
          if (allDone) {
            nextChapter += 1;
          } else {
            break;
          }
        }

        return {
          ...prev,
          gold: prev.gold + quest.rewardGold,
          pearls: prev.pearls + quest.rewardPearls,
          affinity: prev.affinity + 3,
          completedQuests: nextCompleted,
          unlockedZones: nextUnlockedZones,
          storyChapter: nextChapter,
        };
      });

      const unlockedZoneName = quest.unlockZoneId
        ? WATER_ZONES.find((z) => z.id === quest.unlockZoneId)?.name
        : null;
      pushNotice(
        unlockedZoneName
          ? `完成委託「${quest.title}」！新秘境【${unlockedZoneName}】已開啟！`
          : `完成委託「${quest.title}」！獲得 +${quest.rewardGold} 金幣與 +${quest.rewardPearls} 水靈珠。`,
        'success',
      );
    },
    [commitSave, pushNotice],
  );

  // Gear Buy / Equip Handlers
  const handleBuyOrEquipRod = useCallback(
    (rodId: string) => {
      const item = RODS.find((r) => r.id === rodId);
      if (!item) return;
      soundEngine.playUiChime();
      commitSave((prev) => {
        if (prev.ownedRods.includes(rodId)) {
          return { ...prev, equippedRodId: rodId };
        }
        if (prev.gold < item.costGold || prev.pearls < item.costPearls) return prev;
        return {
          ...prev,
          gold: prev.gold - item.costGold,
          pearls: prev.pearls - item.costPearls,
          ownedRods: [...prev.ownedRods, rodId],
          equippedRodId: rodId,
        };
      });
    },
    [commitSave],
  );

  const handleBuyOrEquipReel = useCallback(
    (reelId: string) => {
      const item = REELS.find((r) => r.id === reelId);
      if (!item) return;
      soundEngine.playUiChime();
      commitSave((prev) => {
        if (prev.ownedReels.includes(reelId)) {
          return { ...prev, equippedReelId: reelId };
        }
        if (prev.gold < item.costGold || prev.pearls < item.costPearls) return prev;
        return {
          ...prev,
          gold: prev.gold - item.costGold,
          pearls: prev.pearls - item.costPearls,
          ownedReels: [...prev.ownedReels, reelId],
          equippedReelId: reelId,
        };
      });
    },
    [commitSave],
  );

  const handleBuyOrEquipLine = useCallback(
    (lineId: string) => {
      const item = LINES.find((l) => l.id === lineId);
      if (!item) return;
      soundEngine.playUiChime();
      commitSave((prev) => {
        if (prev.ownedLines.includes(lineId)) {
          return { ...prev, equippedLineId: lineId };
        }
        if (prev.gold < item.costGold || prev.pearls < item.costPearls) return prev;
        return {
          ...prev,
          gold: prev.gold - item.costGold,
          pearls: prev.pearls - item.costPearls,
          ownedLines: [...prev.ownedLines, lineId],
          equippedLineId: lineId,
        };
      });
    },
    [commitSave],
  );

  const handleBuyOrEquipLure = useCallback(
    (lureId: string) => {
      const item = LURES.find((l) => l.id === lureId);
      if (!item) return;
      soundEngine.playUiChime();
      commitSave((prev) => {
        if (prev.ownedLures.includes(lureId)) {
          return { ...prev, equippedLureId: lureId };
        }
        if (prev.gold < item.costGold || prev.pearls < item.costPearls) return prev;
        return {
          ...prev,
          gold: prev.gold - item.costGold,
          pearls: prev.pearls - item.costPearls,
          ownedLures: [...prev.ownedLures, lureId],
          equippedLureId: lureId,
        };
      });
    },
    [commitSave],
  );

  const handleUnlockOrTravelZone = useCallback(
    (zoneId: WaterZoneId) => {
      const zone = WATER_ZONES.find((z) => z.id === zoneId);
      if (!zone) return;
      soundEngine.playUiChime();
      commitSave((prev) => {
        if (prev.unlockedZones.includes(zoneId)) {
          return { ...prev, currentZoneId: zoneId };
        }
        if (
          prev.gold < zone.unlockGold ||
          prev.guardianScales.length < zone.unlockScaleCount
        ) {
          return prev;
        }
        return {
          ...prev,
          gold: prev.gold - zone.unlockGold,
          unlockedZones: [...prev.unlockedZones, zoneId],
          currentZoneId: zoneId,
        };
      });
      pushNotice(`已抵達秘境水域：${zone.name}`, 'info');
    },
    [commitSave, pushNotice],
  );

  const handleChangeTimeOfDay = useCallback(
    (timeOfDay: TimeOfDay) => {
      soundEngine.playUiChime();
      commitSave((prev) => ({ ...prev, timeOfDay }));
    },
    [commitSave],
  );

  const handleChangeWeather = useCallback(
    (weather: WeatherType) => {
      soundEngine.playUiChime();
      commitSave((prev) => ({ ...prev, weather }));
    },
    [commitSave],
  );

  const handleCycleOwnedLure = useCallback(() => {
    soundEngine.playUiChime();
    commitSave((prev) => {
      const list = prev.ownedLures;
      if (list.length <= 1) return prev;
      const idx = list.indexOf(prev.equippedLureId);
      const nextId = list[(idx + 1) % list.length];
      return { ...prev, equippedLureId: nextId };
    });
  }, [commitSave]);

  const handleToggleMute = useCallback(() => {
    soundEngine.init();
    const next = !soundEngine.getMuted();
    soundEngine.setMuted(next);
    setIsMuted(next);
  }, []);

  const handleSwitchSlot = useCallback(
    (slotId: number) => {
      soundEngine.playUiChime();
      setActiveSlotId(slotId);
      const nextSave = loadSlotData(slotId);
      setSave(nextSave);
      sceneControllerRef.current?.applyEnvironmentAndGear(nextSave, true);
      pushNotice(`已切換至本機存檔槽位 ${slotId}`, 'info');
    },
    [pushNotice],
  );

  const handleResetSlot = useCallback(
    (slotId: number) => {
      soundEngine.playUiChime();
      const fresh = resetSlotData(slotId);
      if (slotId === save.slotId) {
        setSave(fresh);
        sceneControllerRef.current?.applyEnvironmentAndGear(fresh, true);
      }
      pushNotice(`存檔槽位 ${slotId} 已重置為初始狀態`, 'info');
    },
    [pushNotice, save.slotId],
  );

  const handleImportSave = useCallback(
    (encoded: string) => {
      const imported = importSaveString(encoded, save.slotId);
      if (!imported) return false;
      setSave(imported);
      sceneControllerRef.current?.applyEnvironmentAndGear(imported, true);
      pushNotice('存檔碼匯入成功，世界與圖鑑紀錄已同步更新！', 'success');
      return true;
    },
    [pushNotice, save.slotId],
  );

  // Derived UI Display Values
  const currentZone = useMemo(
    () => WATER_ZONES.find((z) => z.id === save.currentZoneId) ?? WATER_ZONES[0],
    [save.currentZoneId],
  );
  const currentRod = useMemo(
    () => RODS.find((r) => r.id === save.equippedRodId) ?? RODS[0],
    [save.equippedRodId],
  );
  const currentLure = useMemo(
    () => LURES.find((l) => l.id === save.equippedLureId) ?? LURES[0],
    [save.equippedLureId],
  );

  const claimableQuestCount = useMemo(
    () =>
      QUESTS.filter(
        (q) =>
          q.chapter <= save.storyChapter &&
          !save.completedQuests.includes(q.id) &&
          (save.questProgress[q.id] ?? 0) >= q.requirement.count,
      ).length,
    [save.completedQuests, save.questProgress, save.storyChapter],
  );

  const discoveredCount = useMemo(
    () => Object.values(save.speciesStats).filter((s) => s.count > 0).length,
    [save.speciesStats],
  );

  const safeZoneLeft = Math.max(12, 24 - currentRod.safeZoneBonus * 0.5);
  const safeZoneRight = Math.min(90, 80 + currentRod.safeZoneBonus * 0.5);
  const safeZoneWidth = safeZoneRight - safeZoneLeft;

  const showMeters =
    hud.state === FishingState.CHARGING || hud.state === FishingState.REELING;

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      {/* Dedicated Isolated WebGL Canvas Container */}
      <div ref={canvasMountRef} className="fixed inset-0 w-full h-full z-0" />

      {/* ==================== TOP BAR (Strict 3-Zone Contract) ==================== */}
      <header
        className={`fixed top-0 inset-x-0 z-20 flex items-center justify-between gap-8 px-6 py-3.5 bg-[#0c131f]/88 border-b border-white/10 transition-transform duration-200 ${
          zenCollapsed ? '-translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
        }`}
      >
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => {
            soundEngine.playUiChime();
            setActiveDrawer('quests');
          }}
          className="font-display text-lg font-bold tracking-wide text-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
        >
          蒼翠水鏡：遠古魚王傳說
        </button>

        {/* Zone 2: 4 Clean Single-Line Text Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
          <button
            type="button"
            onClick={() => {
              soundEngine.playUiChime();
              setActiveDrawer('quests');
            }}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {claimableQuestCount > 0 ? `劇情委託 (${claimableQuestCount})` : '劇情委託'}
          </button>
          <button
            type="button"
            onClick={() => {
              soundEngine.playUiChime();
              setActiveDrawer('workshop');
            }}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            釣具工坊
          </button>
          <button
            type="button"
            onClick={() => {
              soundEngine.playUiChime();
              setActiveDrawer('encyclopedia');
            }}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            生態圖鑑 ({discoveredCount}/{FISH_SPECIES.length})
          </button>
          <button
            type="button"
            onClick={() => {
              soundEngine.playUiChime();
              setActiveDrawer('world');
            }}
            className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            秘境天象
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              soundEngine.playUiChime();
              setActiveDrawer('saves');
            }}
            className="px-4 py-1.5 rounded-lg bg-slate-800/95 hover:bg-slate-700 border border-white/12 text-xs font-semibold text-slate-100 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            存檔與音訊
          </button>
        </div>
      </header>

      {/* ==================== TOP-CENTER FISHING PROMPT & NOTICES ==================== */}
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2.5 pointer-events-none px-4 w-full max-w-xl">
        {!zenCollapsed && (
          <div
            className={`px-6 py-2.5 rounded-2xl border text-center transition-transform duration-150 shadow-xl ${
              hud.isBiteUrgent
                ? 'bg-rose-600/95 border-rose-300/70 text-white scale-105 font-bold text-lg'
                : 'bg-[#0c131f]/88 border-white/14 text-slate-100 text-sm md:text-base font-medium'
            }`}
          >
            {hud.statusMessage}
          </div>
        )}

        {notice && (
          <div
            className={`px-5 py-2 rounded-xl border text-xs md:text-sm font-medium shadow-lg transition-opacity duration-200 ${
              notice.tone === 'warning'
                ? 'bg-amber-950/92 border-amber-400/40 text-amber-200'
                : notice.tone === 'success'
                  ? 'bg-teal-950/92 border-teal-400/45 text-teal-200'
                  : 'bg-slate-900/92 border-white/14 text-slate-200'
            }`}
          >
            {notice.text}
          </div>
        )}
      </div>

      {/* ==================== DYNAMIC CAST POWER & LINE TENSION METERS ==================== */}
      <div
        className={`fixed bottom-32 left-1/2 -translate-x-1/2 z-20 w-[min(460px,92vw)] rounded-2xl bg-[#0c131f]/92 border border-white/15 px-5 py-4 shadow-2xl pointer-events-none transition-opacity duration-150 ${
          showMeters ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {hud.state === FishingState.CHARGING && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
              <span>拋竿蓄力力道 · 方向 {hud.aimAngleDeg > 0 ? `右 ${hud.aimAngleDeg}°` : hud.aimAngleDeg < 0 ? `左 ${Math.abs(hud.aimAngleDeg)}°` : '正前方'}</span>
              <span className="font-mono tabular-nums text-teal-300">{hud.castPower}%</span>
            </div>
            <div className="w-full h-3.5 rounded-full bg-slate-800/90 overflow-hidden">
              <div
                className="h-full origin-left transition-transform duration-75"
                style={{
                  background: 'linear-gradient(90deg, #2dd4bf, #fbbf24, #f43f5e)',
                  transform: `scaleX(${hud.castPower / 100})`,
                }}
              />
            </div>
          </div>
        )}

        {hud.state === FishingState.REELING && (
          <div className="space-y-3">
            {/* Line Tension with Dynamic Safe Zone */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-slate-200">
                  釣線張力 {hud.isFishBursting ? '· 魚隻暴衝中！' : ''}
                </span>
                <span
                  className={`font-mono tabular-nums ${
                    hud.lineTension > safeZoneRight
                      ? 'text-rose-400'
                      : hud.lineTension < safeZoneLeft
                        ? 'text-amber-300'
                        : 'text-teal-300'
                  }`}
                >
                  {hud.lineTension > safeZoneRight
                    ? `危險高張力 ${hud.lineTension}%`
                    : hud.lineTension < safeZoneLeft
                      ? `張力過低 ${hud.lineTension}%`
                      : `最佳控線區 ${hud.lineTension}%`}
                </span>
              </div>
              <div className="relative w-full h-3.5 rounded-full bg-slate-800/95 overflow-hidden">
                <div
                  className="absolute top-0 bottom-0 border-x-2 border-dashed border-white/65 bg-teal-400/12"
                  style={{
                    left: `${safeZoneLeft}%`,
                    width: `${safeZoneWidth}%`,
                  }}
                />
                <div
                  className="h-full origin-left transition-transform duration-75"
                  style={{
                    backgroundColor:
                      hud.lineTension > safeZoneRight
                        ? '#f43f5e'
                        : hud.lineTension < safeZoneLeft
                          ? '#fbbf24'
                          : '#2dd4bf',
                    transform: `scaleX(${hud.lineTension / 100})`,
                  }}
                />
              </div>
            </div>

            {/* Distance & Fish Stamina Dual Readout */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>距岸距離</span>
                  <span className="font-mono tabular-nums text-sky-300">
                    {hud.fishDistance.toFixed(1)} m
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-sky-400 origin-left transition-transform duration-75"
                    style={{
                      transform: `scaleX(${Math.min(
                        1,
                        hud.fishDistance / Math.max(1, hud.maxCastDistance + 6),
                      )})`,
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>魚隻耐力</span>
                  <span className="font-mono tabular-nums text-amber-300">
                    {hud.fishStamina}%
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-amber-400 origin-left transition-transform duration-75"
                    style={{
                      transform: `scaleX(${hud.fishStamina / 100})`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ==================== NON-INTRUSIVE STORY WHISPER (FIRST VISIT) ==================== */}
      {!save.seenIntro && !zenCollapsed && hud.state === FishingState.IDLE && !activeDrawer && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-10 w-[min(640px,92vw)] rounded-xl bg-[#0c131f]/90 border border-white/12 px-5 py-3.5 flex items-center justify-between gap-4 pointer-events-auto shadow-xl">
          <div className="text-xs md:text-sm text-slate-200 leading-relaxed">
            <span className="font-display font-bold text-amber-300 mr-2">
              {NPCS.xuan.name} · {NPCS.xuan.title}：
            </span>
            「歡迎來到翡翠高山湖泊，旅人。試著移動滑鼠瞄準湖心，按住左鍵或空白鍵拋下第一竿吧！」
          </div>
          <button
            type="button"
            onClick={() => commitSave((prev) => ({ ...prev, seenIntro: true }))}
            className="text-xs text-slate-400 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            知道了
          </button>
        </div>
      )}

      {/* ==================== UNIFIED COLLAPSIBLE BOTTOM CONTROL DOCK ==================== */}
      <div
        className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-20 w-[min(940px,94vw)] transition-transform duration-200 pointer-events-auto ${
          zenCollapsed ? 'translate-y-[calc(100%-28px)]' : 'translate-y-0'
        }`}
      >
        {/* Collapse / Zen Mode Tab Handle */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setZenCollapsed((prev) => !prev)}
            className="flex items-center gap-1.5 px-4 py-1 rounded-t-xl bg-[#0c131f]/90 border-t border-x border-white/14 text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            {zenCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>展開控制塢 [H]</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>收合沉浸賞景 [H]</span>
              </>
            )}
          </button>
        </div>

        {/* Main Horizontal Dock */}
        <div className="rounded-2xl bg-[#0c131f]/92 border border-white/14 px-5 py-3.5 shadow-2xl space-y-2.5">
          {/* Row 1: Clean Unboxed Metadata Bar with Typographic Separators */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300 border-b border-white/8 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-teal-300">
                {CHAPTER_TITLES[save.storyChapter] ?? CHAPTER_TITLES[6]}
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-slate-100 font-medium">{currentZone.name}</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>水深 {currentZone.depthText}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
              <span>
                漁獲 {save.totalCount} 尾 ({save.totalWeight.toFixed(2)} kg)
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-amber-300">{save.gold} 金幣</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-teal-300">{save.pearls} 水靈珠</span>
              {save.bestCatch && (
                <>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="text-sky-300 font-sans">
                    最大：{save.bestCatch.name} {save.bestCatch.weight.toFixed(2)}kg
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Row 2: Quick Interactive Controls & Mobile Drawer Triggers */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (save.ownedLures.length > 1) {
                    handleCycleOwnedLure();
                  } else {
                    setActiveDrawer('workshop');
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-white/10 text-xs text-slate-100 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                擬餌：{currentLure.name}
              </button>

              <button
                type="button"
                onClick={() => {
                  const nextTime =
                    TIME_ORDER[(TIME_ORDER.indexOf(save.timeOfDay) + 1) % TIME_ORDER.length];
                  handleChangeTimeOfDay(nextTime);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-white/10 text-xs text-slate-200 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                時段：{TIME_SHORT[save.timeOfDay]}
              </button>

              <button
                type="button"
                onClick={() => {
                  const nextW =
                    WEATHER_ORDER[(WEATHER_ORDER.indexOf(save.weather) + 1) % WEATHER_ORDER.length];
                  handleChangeWeather(nextW);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-white/10 text-xs text-slate-200 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                天候：{WEATHER_SHORT[save.weather]}
              </button>

              <button
                type="button"
                onClick={handleToggleMute}
                className="px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-white/10 text-xs text-slate-200 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                {isMuted ? '音訊：靜音' : '音訊：開啟'}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  soundEngine.playUiChime();
                  setActiveDrawer('quests');
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  claimableQuestCount > 0
                    ? 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10'
                }`}
              >
                {claimableQuestCount > 0
                  ? `領取委託回報 (${claimableQuestCount})`
                  : '委託與傳說'}
              </button>

              <button
                type="button"
                onClick={() => {
                  soundEngine.playUiChime();
                  setActiveDrawer('workshop');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                釣具工坊
              </button>

              <button
                type="button"
                onClick={() => {
                  soundEngine.playUiChime();
                  setActiveDrawer('encyclopedia');
                }}
                className="md:hidden px-3 py-1.5 rounded-lg bg-slate-800 text-slate-200 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
              >
                圖鑑
              </button>

              <button
                type="button"
                onClick={() => {
                  soundEngine.playUiChime();
                  setActiveDrawer('world');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                切換水域
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ==================== CATCH SETTLEMENT MODAL ==================== */}
      <CatchModal
        caught={caughtFish}
        alreadyHasScale={
          caughtFish ? save.guardianScales.includes(caughtFish.species.id) : false
        }
        onResolve={handleResolveCatch}
      />

      {/* ==================== UNIFIED FEATURE DRAWERS ==================== */}
      <GameDrawers
        activeTab={activeDrawer}
        onClose={() => setActiveDrawer(null)}
        onSwitchTab={(tab) => {
          soundEngine.playUiChime();
          setActiveDrawer(tab);
        }}
        save={save}
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
        onClaimQuest={handleClaimQuest}
        onBuyOrEquipRod={handleBuyOrEquipRod}
        onBuyOrEquipReel={handleBuyOrEquipReel}
        onBuyOrEquipLine={handleBuyOrEquipLine}
        onBuyOrEquipLure={handleBuyOrEquipLure}
        onUnlockOrTravelZone={handleUnlockOrTravelZone}
        onChangeTimeOfDay={handleChangeTimeOfDay}
        onChangeWeather={handleChangeWeather}
        onSwitchSlot={handleSwitchSlot}
        onResetSlot={handleResetSlot}
        onImportSave={handleImportSave}
      />
    </div>
  );
}
