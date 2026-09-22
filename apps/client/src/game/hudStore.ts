import type {
  PlayerLevelUpMessage,
  RunPlayerResult,
  ServerMessage,
  StateSnapshotMessage,
  UpgradeOptionId,
  WaveConfig,
} from '@shooter/shared';
import { create } from 'zustand';
import type { ClientSenders } from '../net/senders.ts';
import { waveFromTick } from './hud.ts';

export interface HudState {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  wave: number;
  kills: number;
  spectator: boolean;
  upgradeChoices: [UpgradeOptionId, UpgradeOptionId, UpgradeOptionId] | null;
  pendingUpgrades: number;
  results: RunPlayerResult[] | null;
  unbindNet: (() => void) | null;
  inputBlocked: boolean;
  applySnapshot: (
    snapshot: StateSnapshotMessage,
    localUserId: string | null,
    waveConfig?: WaveConfig[],
  ) => void;
  applyLevelUp: (message: PlayerLevelUpMessage, localUserId: string | null) => void;
  applyDied: (playerId: string, localUserId: string | null) => void;
  applyRunEnded: (results: RunPlayerResult[]) => void;
  chooseUpgrade: (optionId: UpgradeOptionId) => void;
  bindNet: (
    subscribe: HudSubscribe,
    getLocalUserId: () => string | null,
    getWaveConfig: () => WaveConfig[],
    getSenders: () => ClientSenders | null,
  ) => () => void;
}

export type HudSubscribe = <T extends ServerMessage['type']>(
  type: T,
  handler: (message: Extract<ServerMessage, { type: T }>) => void,
) => () => void;

const initialHud = {
  hp: 100,
  maxHp: 100,
  level: 1,
  xp: 0,
  wave: 1,
  kills: 0,
  spectator: false,
  upgradeChoices: null as HudState['upgradeChoices'],
  pendingUpgrades: 0,
  results: null as RunPlayerResult[] | null,
  unbindNet: null as (() => void) | null,
};

let seenMonsterIds = new Set<string>();
let getWaveConfig: () => WaveConfig[] = () => [];
let getSenders: () => ClientSenders | null = () => null;

function isLocalId(id: string, localUserId: string | null): boolean {
  return localUserId !== null && id === localUserId;
}

function withBlocked<T extends Partial<HudState>>(patch: T): T & { inputBlocked: boolean } {
  const nextChoices = 'upgradeChoices' in patch ? patch.upgradeChoices : useHudStore.getState().upgradeChoices;
  const nextResults = 'results' in patch ? patch.results : useHudStore.getState().results;

  return {
    ...patch,
    inputBlocked: nextChoices !== null || nextResults != null,
  };
}

export const useHudStore = create<HudState>((set, get) => ({
  ...initialHud,
  inputBlocked: false,

  applySnapshot(snapshot, localUserId, waveConfig) {
    const nextIds = new Set(snapshot.monsters.map((monster) => monster.id));
    let kills = get().kills;
    if (seenMonsterIds.size > 0) {
      for (const id of seenMonsterIds) {
        if (!nextIds.has(id)) {
          kills += 1;
        }
      }
    }
    seenMonsterIds = nextIds;

    const local = snapshot.players.find(
      (player) => localUserId !== null && (player.userId === localUserId || player.id === localUserId),
    );
    const waves = waveConfig ?? getWaveConfig();
    set(
      withBlocked({
        kills,
        wave: waveFromTick(snapshot.tick, waves),
        ...(local
          ? {
              hp: local.hp,
              maxHp: local.maxHp,
              level: local.level,
              xp: local.xp,
              spectator: local.isDead,
            }
          : {}),
      }),
    );
  },

  applyLevelUp(message, localUserId) {
    if (!isLocalId(message.playerId, localUserId)) {
      return;
    }
    const pending = get().pendingUpgrades + 1;
    set(
      withBlocked({
        pendingUpgrades: pending,
        upgradeChoices: message.choices,
      }),
    );
  },

  applyDied(playerId, localUserId) {
    if (!isLocalId(playerId, localUserId)) {
      return;
    }
    set({ spectator: true });
  },

  applyRunEnded(results) {
    set(
      withBlocked({
        results,
        upgradeChoices: null,
        pendingUpgrades: 0,
      }),
    );
  },

  chooseUpgrade(optionId) {
    getSenders()?.chooseUpgrade(optionId);
    const pending = Math.max(0, get().pendingUpgrades - 1);
    set(
      withBlocked({
        pendingUpgrades: pending,
        upgradeChoices: pending > 0 ? get().upgradeChoices : null,
      }),
    );
  },

  bindNet(subscribe, getLocalUserId, waveConfig, senders) {
    get().unbindNet?.();
    getWaveConfig = waveConfig;
    getSenders = senders;
    const unsubs = [
      subscribe('state:snapshot', (message) => {
        get().applySnapshot(message, getLocalUserId());
      }),
      subscribe('player:levelUp', (message) => {
        get().applyLevelUp(message, getLocalUserId());
      }),
      subscribe('player:died', (message) => {
        get().applyDied(message.playerId, getLocalUserId());
      }),
      subscribe('run:ended', (message) => {
        get().applyRunEnded(message.results);
      }),
    ];
    const unbindNet = () => {
      for (const unsub of unsubs) {
        unsub();
      }
      if (get().unbindNet === unbindNet) {
        set({ unbindNet: null });
      }
    };
    set({ unbindNet });
    return unbindNet;
  },
}));

export function resetHudState(): void {
  seenMonsterIds = new Set();
  const unbindNet = useHudStore.getState().unbindNet;
  useHudStore.setState({ ...initialHud, unbindNet, inputBlocked: false });
}

export function resetHudStore(): void {
  seenMonsterIds = new Set();
  getWaveConfig = () => [];
  getSenders = () => null;
  useHudStore.getState().unbindNet?.();
  useHudStore.setState({ ...initialHud, inputBlocked: false, unbindNet: null });
}
