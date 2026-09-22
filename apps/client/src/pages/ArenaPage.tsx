import { useEffect, useRef } from 'react';
import { ArenaHud } from '../game/ArenaHud.tsx';
import { ResultsScreen } from '../game/ResultsScreen.tsx';
import { SpectatorOverlay } from '../game/SpectatorOverlay.tsx';
import { UpgradeChoiceModal } from '../game/UpgradeChoiceModal.tsx';
import { useHudStore, type HudState } from '../game/hudStore.ts';
import { useHubStore, type HubState } from '../hub/hubStore.ts';

function useLiveHub<T>(selector: (state: HubState) => T): T {
  useHubStore(selector);
  return selector(useHubStore.getState());
}

function useLiveHud<T>(selector: (state: HudState) => T): T {
  useHudStore(selector);
  return selector(useHudStore.getState());
}

export function ArenaPage() {
  const matchFoundVisible = useLiveHub((state) => state.matchFoundVisible);
  const results = useLiveHud((state) => state.results);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (matchFoundVisible) {
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }
    let cancelled = false;
    let handle: { destroy(): void } | null = null;
    void import('../game/arenaRenderer.ts').then(({ mountArenaRenderer }) => {
      if (cancelled) {
        return;
      }
      return mountArenaRenderer(host).then((mounted) => {
        if (cancelled) {
          mounted.destroy();
          return;
        }
        handle = mounted;
      });
    });
    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }, [matchFoundVisible]);

  if (matchFoundVisible) {
    return (
      <main className="arena-page">
        <div className="match-found-overlay" data-overlay="match-found" role="status">
          Match found!
        </div>
      </main>
    );
  }

  return (
    <main className="arena-page">
      <div className="arena-stage" data-arena="ready" ref={hostRef} />
      {results ? (
        <ResultsScreen />
      ) : (
        <>
          <ArenaHud />
          <SpectatorOverlay />
          <UpgradeChoiceModal />
        </>
      )}
    </main>
  );
}
