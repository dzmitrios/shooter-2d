import { useHubStore, type HubState } from '../hub/hubStore.ts';

function useLiveHub<T>(selector: (state: HubState) => T): T {
  useHubStore(selector);
  return selector(useHubStore.getState());
}

export function ArenaPage() {
  const matchFoundVisible = useLiveHub((state) => state.matchFoundVisible);

  return (
    <main className="arena-page">
      {matchFoundVisible ? (
        <div className="match-found-overlay" data-overlay="match-found" role="status">
          Match found!
        </div>
      ) : (
        <div className="arena-stage" data-arena="ready" />
      )}
    </main>
  );
}
