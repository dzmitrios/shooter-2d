import { useEffect, useRef } from 'react';
import { useHubStore, type HubState } from '../hub/hubStore.ts';

function useLiveHub<T>(selector: (state: HubState) => T): T {
  useHubStore(selector);
  return selector(useHubStore.getState());
}

export function ArenaPage() {
  const matchFoundVisible = useLiveHub((state) => state.matchFoundVisible);
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

  return (
    <main className="arena-page">
      {matchFoundVisible ? (
        <div className="match-found-overlay" data-overlay="match-found" role="status">
          Match found!
        </div>
      ) : (
        <div className="arena-stage" data-arena="ready" ref={hostRef} />
      )}
    </main>
  );
}
