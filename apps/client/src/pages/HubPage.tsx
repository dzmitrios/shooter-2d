import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../auth/authStore.ts';
import { useHubStore, type HubState } from '../hub/hubStore.ts';
import { useHubSocket } from '../hub/session.ts';
import type { WeaponCatalogItem } from '../hub/profileApi.ts';

function useLiveHub<T>(selector: (state: HubState) => T): T {
  useHubStore(selector);
  return selector(useHubStore.getState());
}

export function HubPage() {
  const token = useAuthStore((state) => state.token) ?? useAuthStore.getState().token;
  const loadedToken = useLiveHub((state) => state.loadedToken);
  const profile = useLiveHub((state) => state.profile);
  const weapons = useLiveHub((state) => state.weapons);
  const selectedWeaponId = useLiveHub((state) => state.selectedWeaponId);
  const group = useLiveHub((state) => state.group);
  const queueStatus = useLiveHub((state) => state.queueStatus);
  const loadError = useLiveHub((state) => state.loadError);
  const shopError = useLiveHub((state) => state.shopError);
  const groupError = useLiveHub((state) => state.groupError);
  const queueError = useLiveHub((state) => state.queueError);
  const unlockingId = useLiveHub((state) => state.unlockingId);
  const loading = useLiveHub((state) => state.loading);

  if (token && loadedToken !== token) {
    void useHubStore.getState().loadProfile(token);
  }

  useHubSocket(token);

  const owned = new Set(profile?.weaponUnlocks.map((row) => row.weaponId) ?? []);

  return (
    <main className="hub-page">
      <header className="hub-header">
        <h1>Hub</h1>
        {profile ? (
          <dl className="hub-stats">
            <div>
              <dt>Rank</dt>
              <dd>{profile.rank}</dd>
            </div>
            <div>
              <dt>Meta currency</dt>
              <dd>{profile.metaCurrency}</dd>
            </div>
            <div>
              <dt>Total runs</dt>
              <dd>{profile.totalRuns}</dd>
            </div>
            <div>
              <dt>Best waves</dt>
              <dd>{profile.bestWaves}</dd>
            </div>
            <div>
              <dt>Total kills</dt>
              <dd>{profile.totalKills}</dd>
            </div>
          </dl>
        ) : loading ? (
          <p className="hub-muted">Loading profile…</p>
        ) : null}
        {loadError ? <p className="hub-error">{loadError}</p> : null}
      </header>

      <section className="hub-panel">
        <h2>Weapons</h2>
        <div className="weapon-grid">
          {weapons.map((weapon) => (
            <WeaponCard
              key={weapon.id}
              weapon={weapon}
              owned={owned.has(weapon.id)}
              selected={selectedWeaponId === weapon.id}
              buying={unlockingId === weapon.id}
            />
          ))}
        </div>
        {shopError ? <p className="hub-error">{shopError}</p> : null}
      </section>

      <GroupPanel groupCode={group?.groupCode ?? null} members={group?.members ?? []} error={groupError} />

      <section className="hub-start">
        <button
          type="button"
          className="hub-start-btn"
          disabled={queueStatus !== 'idle'}
          onClick={() => useHubStore.getState().startQueue()}
        >
          Start
        </button>
        {queueStatus !== 'idle' ? (
          <p className="hub-queue" data-queue-status={queueStatus}>
            Finding match…
          </p>
        ) : null}
        {queueError ? <p className="hub-error">{queueError}</p> : null}
      </section>
    </main>
  );
}

function WeaponCard({
  weapon,
  owned,
  selected,
  buying,
}: {
  weapon: WeaponCatalogItem;
  owned: boolean;
  selected: boolean;
  buying: boolean;
}) {
  const className = [
    'weapon-card',
    owned ? 'owned' : 'locked',
    selected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article data-weapon-id={weapon.id} className={className}>
      <h3>{weapon.name}</h3>
      {owned ? (
        <button type="button" onClick={() => useHubStore.getState().selectWeapon(weapon.id)}>
          {selected ? 'Selected' : 'Select'}
        </button>
      ) : (
        <>
          <p className="weapon-cost">Cost: {weapon.xpCost}</p>
          <button
            type="button"
            disabled={buying}
            onClick={() => void useHubStore.getState().buyWeapon(weapon.id)}
          >
            Buy
          </button>
        </>
      )}
    </article>
  );
}

function GroupPanel({
  groupCode,
  members,
  error,
}: {
  groupCode: string | null;
  members: { userId: string; username: string; isLeader: boolean }[];
  error: string | null;
}) {
  const [joinCode, setJoinCode] = useState('');

  function onJoin(event: FormEvent): void {
    event.preventDefault();
    useHubStore.getState().joinGroup(joinCode);
  }

  return (
    <section className="hub-panel">
      <h2>Group</h2>
      <div className="hub-group-actions">
        <button type="button" onClick={() => useHubStore.getState().createGroup()}>
          Create Group
        </button>
        <form className="hub-join" onSubmit={onJoin}>
          <label>
            Group code
            <input
              name="groupCode"
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value)}
              maxLength={6}
            />
          </label>
          <button type="submit">Join Group</button>
        </form>
      </div>
      {groupCode ? (
        <p className="hub-group-code">
          Code: <strong>{groupCode}</strong>
        </p>
      ) : null}
      {members.length > 0 ? (
        <ul className="hub-members">
          {members.map((member) => (
            <li key={member.userId}>
              {member.username}
              {member.isLeader ? ' (leader)' : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="hub-error">{error}</p> : null}
    </section>
  );
}
