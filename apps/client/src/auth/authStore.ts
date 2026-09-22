import { create } from 'zustand';
import { readValidJwt } from './jwt.ts';

export const AUTH_TOKEN_KEY = 'shooter.jwt';

export type AppScreen = 'auth' | 'hub';

export interface AuthState {
  token: string | null;
  userId: string | null;
  screen: AppScreen;
  hydrated: boolean;
  setSession: (token: string, userId: string) => void;
  hydrate: () => void;
  clearSession: () => void;
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  userId: null,
  screen: 'auth',
  hydrated: false,

  setSession(token, userId) {
    getLocalStorage()?.setItem(AUTH_TOKEN_KEY, token);
    set({ token, userId, screen: 'hub', hydrated: true });
  },

  hydrate() {
    const stored = getLocalStorage()?.getItem(AUTH_TOKEN_KEY) ?? null;
    const payload = readValidJwt(stored);
    if (!payload || !stored) {
      if (stored) {
        getLocalStorage()?.removeItem(AUTH_TOKEN_KEY);
      }
      set({ token: null, userId: null, screen: 'auth', hydrated: true });
      return;
    }
    set({ token: stored, userId: payload.userId, screen: 'hub', hydrated: true });
  },

  clearSession() {
    getLocalStorage()?.removeItem(AUTH_TOKEN_KEY);
    set({ token: null, userId: null, screen: 'auth', hydrated: true });
  },
}));

export function resetAuthStore(): void {
  useAuthStore.setState({
    token: null,
    userId: null,
    screen: 'auth',
    hydrated: false,
  });
}
