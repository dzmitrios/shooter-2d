export interface WeaponUnlock {
  id: string;
  weaponId: string;
}

export interface WeaponCatalogItem {
  id: string;
  name: string;
  xpCost: number;
  defaultUnlock: boolean;
  damage?: number;
  fireRate?: number;
}

export interface PlayerProfile {
  rank: number;
  metaCurrency: number;
  totalRuns: number;
  bestWaves: number;
  totalKills: number;
  weaponUnlocks: WeaponUnlock[];
  weapons: WeaponCatalogItem[];
}

export class ProfileApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ProfileApiError';
    this.status = status;
  }
}

function getApiBase(): string {
  const env = (import.meta as ImportMeta & { env?: { VITE_API_URL?: string } }).env;
  return env?.VITE_API_URL ?? '';
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function readError(status: number, body: unknown, fallback: string): ProfileApiError {
  const record = asRecord(body);
  const message = typeof record.error === 'string' ? record.error : fallback;
  return new ProfileApiError(status, message);
}

function parseUnlock(raw: unknown): WeaponUnlock | null {
  const record = asRecord(raw);
  if (typeof record.id !== 'string' || typeof record.weaponId !== 'string') {
    return null;
  }
  return { id: record.id, weaponId: record.weaponId };
}

function parseWeapon(raw: unknown): WeaponCatalogItem | null {
  const record = asRecord(raw);
  if (
    typeof record.id !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.xpCost !== 'number'
  ) {
    return null;
  }
  const item: WeaponCatalogItem = {
    id: record.id,
    name: record.name,
    xpCost: record.xpCost,
    defaultUnlock: record.defaultUnlock === true,
  };
  if (typeof record.damage === 'number') {
    item.damage = record.damage;
  }
  if (typeof record.fireRate === 'number') {
    item.fireRate = record.fireRate;
  }
  return item;
}

function parseProfile(body: unknown): PlayerProfile {
  const record = asRecord(body);
  const unlocks = Array.isArray(record.weaponUnlocks)
    ? record.weaponUnlocks.map(parseUnlock).filter((row): row is WeaponUnlock => row !== null)
    : [];
  const weapons = Array.isArray(record.weapons)
    ? record.weapons.map(parseWeapon).filter((row): row is WeaponCatalogItem => row !== null)
    : [];
  if (
    typeof record.rank !== 'number' ||
    typeof record.metaCurrency !== 'number' ||
    typeof record.totalRuns !== 'number' ||
    typeof record.bestWaves !== 'number' ||
    typeof record.totalKills !== 'number'
  ) {
    throw new ProfileApiError(200, 'Invalid profile response');
  }
  return {
    rank: record.rank,
    metaCurrency: record.metaCurrency,
    totalRuns: record.totalRuns,
    bestWaves: record.bestWaves,
    totalKills: record.totalKills,
    weaponUnlocks: unlocks,
    weapons,
  };
}

export async function fetchProfile(token: string): Promise<PlayerProfile> {
  const res = await fetch(`${getApiBase()}/profile/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw readError(res.status, body, `Profile failed (${res.status})`);
  }
  return parseProfile(body);
}

export async function unlockWeapon(
  token: string,
  weaponId: string,
): Promise<{ weaponId: string; metaCurrency: number }> {
  const res = await fetch(`${getApiBase()}/profile/weapons/unlock`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ weaponId }),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw readError(res.status, body, `Unlock failed (${res.status})`);
  }
  const record = asRecord(body);
  if (typeof record.weaponId !== 'string' || typeof record.metaCurrency !== 'number') {
    throw new ProfileApiError(res.status, 'Invalid unlock response');
  }
  return { weaponId: record.weaponId, metaCurrency: record.metaCurrency };
}
