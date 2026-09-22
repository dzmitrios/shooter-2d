import type { GroupMember, ServerMessage, WaveConfig } from '@shooter/shared';
import { create } from 'zustand';
import { useAuthStore } from '../auth/authStore.ts';
import { getGameStore, resetGameStore } from '../game/gameStore.ts';
import type { ClientSenders } from '../net/senders.ts';
import { fetchProfile, unlockWeapon, type PlayerProfile, type WeaponCatalogItem } from './profileApi.ts';

export const MATCH_FOUND_DURATION_MS = 800;

export type QueueStatus = 'idle' | 'joining' | 'finding';

export interface MatchStart {
  seed: number;
  waveConfig: WaveConfig[];
}

export interface HubGroup {
  groupId: string;
  groupCode: string;
  members: GroupMember[];
}

export interface HubState {
  loadedToken: string | null;
  loading: boolean;
  unlockingId: string | null;
  profile: PlayerProfile | null;
  weapons: WeaponCatalogItem[];
  selectedWeaponId: string | null;
  group: HubGroup | null;
  queueStatus: QueueStatus;
  match: MatchStart | null;
  matchFoundVisible: boolean;
  loadError: string | null;
  shopError: string | null;
  groupError: string | null;
  queueError: string | null;
  senders: ClientSenders | null;
  unbindNet: (() => void) | null;
  loadProfile: (token: string) => Promise<void>;
  selectWeapon: (weaponId: string) => void;
  buyWeapon: (weaponId: string) => Promise<void>;
  bindNet: (senders: ClientSenders, subscribe: HubSubscribe) => () => void;
  createGroup: () => void;
  joinGroup: (groupCode: string) => void;
  startQueue: () => void;
  beginMatch: (seed: number, waveConfig: WaveConfig[]) => void;
  dismissMatchFound: () => void;
}

export type HubSubscribe = <T extends ServerMessage['type']>(
  type: T,
  handler: (message: Extract<ServerMessage, { type: T }>) => void,
) => () => void;

const initialState = {
  loadedToken: null as string | null,
  loading: false,
  unlockingId: null as string | null,
  profile: null as PlayerProfile | null,
  weapons: [] as WeaponCatalogItem[],
  selectedWeaponId: null as string | null,
  group: null as HubGroup | null,
  queueStatus: 'idle' as QueueStatus,
  match: null as MatchStart | null,
  matchFoundVisible: false,
  loadError: null as string | null,
  shopError: null as string | null,
  groupError: null as string | null,
  queueError: null as string | null,
  senders: null as ClientSenders | null,
  unbindNet: null as (() => void) | null,
};

function ownedIds(profile: PlayerProfile | null): Set<string> {
  return new Set(profile?.weaponUnlocks.map((row) => row.weaponId) ?? []);
}

let matchFoundTimer: ReturnType<typeof setTimeout> | null = null;

function clearMatchFoundTimer(): void {
  if (matchFoundTimer !== null) {
    clearTimeout(matchFoundTimer);
    matchFoundTimer = null;
  }
}

function defaultWeaponId(profile: PlayerProfile | null, current: string | null): string | null {
  const owned = ownedIds(profile);
  if (current && owned.has(current)) {
    return current;
  }
  return profile?.weaponUnlocks[0]?.weaponId ?? null;
}

export const useHubStore = create<HubState>((set, get) => ({
  ...initialState,

  async loadProfile(token) {
    set({ loadedToken: token, loading: true, loadError: null });
    try {
      const profile = await fetchProfile(token);
      set({
        profile,
        weapons: profile.weapons,
        selectedWeaponId: defaultWeaponId(profile, get().selectedWeaponId),
        loading: false,
      });
    } catch (err) {
      set({
        loading: false,
        loadError: err instanceof Error ? err.message : 'Failed to load profile',
      });
    }
  },

  selectWeapon(weaponId) {
    if (!ownedIds(get().profile).has(weaponId)) {
      return;
    }
    set({ selectedWeaponId: weaponId, queueError: null });
  },

  async buyWeapon(weaponId) {
    const token = useAuthStore.getState().token ?? get().loadedToken;
    if (!token) {
      return;
    }
    set({ unlockingId: weaponId, shopError: null });
    try {
      await unlockWeapon(token, weaponId);
      await get().loadProfile(token);
      set({ unlockingId: null, shopError: null });
    } catch (err) {
      set({
        unlockingId: null,
        shopError: err instanceof Error ? err.message : 'Unlock failed',
      });
    }
  },

  bindNet(senders, subscribe) {
    get().unbindNet?.();
    set({ senders });

    const unsubs = [
      subscribe('group:state', (message) => {
        if (message.members.length === 0) {
          set({ group: null });
          return;
        }
        set({
          group: {
            groupId: message.groupId,
            groupCode: message.groupCode,
            members: message.members,
          },
          groupError: null,
        });
      }),
      subscribe('queue:status', () => {
        set({ queueStatus: 'finding', queueError: null });
      }),
      subscribe('queue:cancelled', () => {
        set({ queueStatus: 'idle' });
      }),
      subscribe('run:started', (message) => {
        get().beginMatch(message.seed, message.waveConfig);
      }),
      subscribe('error', (message) => {
        if (message.code === 'GROUP_FULL' || message.code === 'GROUP_NOT_FOUND') {
          set({ groupError: message.code });
          return;
        }
        if (message.code === 'WEAPON_NOT_OWNED') {
          set({ queueError: message.code, queueStatus: 'idle' });
        }
      }),
    ];

    const unbindNet = () => {
      for (const unsub of unsubs) {
        unsub();
      }
      if (get().senders === senders) {
        set({ senders: null, unbindNet: null });
      }
    };
    set({ unbindNet });
    return unbindNet;
  },

  createGroup() {
    set({ groupError: null });
    get().senders?.groupCreate();
  },

  joinGroup(groupCode) {
    const code = groupCode.trim();
    if (!code) {
      return;
    }
    set({ groupError: null });
    get().senders?.groupJoin(code);
  },

  startQueue() {
    const { selectedWeaponId, group, senders } = get();
    if (!selectedWeaponId) {
      set({ queueError: 'WEAPON_NOT_OWNED' });
      return;
    }
    set({ queueError: null, queueStatus: 'joining' });
    senders?.queueJoin(selectedWeaponId, group?.groupId);
  },

  beginMatch(seed, waveConfig) {
    clearMatchFoundTimer();
    resetGameStore();
    getGameStore().setLocalUserId(useAuthStore.getState().userId);
    useAuthStore.setState({ screen: 'arena' });
    set({
      queueStatus: 'idle',
      queueError: null,
      match: { seed, waveConfig },
      matchFoundVisible: true,
    });
    matchFoundTimer = setTimeout(() => {
      matchFoundTimer = null;
      get().dismissMatchFound();
    }, MATCH_FOUND_DURATION_MS);
  },

  dismissMatchFound() {
    clearMatchFoundTimer();
    set({ matchFoundVisible: false });
  },
}));

export function resetHubStore(): void {
  clearMatchFoundTimer();
  useHubStore.getState().unbindNet?.();
  useHubStore.setState({ ...initialState });
  resetGameStore();
}
