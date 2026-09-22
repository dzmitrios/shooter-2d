import { useHudStore, type HudState } from './hudStore.ts';

function useLiveHud<T>(selector: (state: HudState) => T): T {
  useHudStore(selector);
  return selector(useHudStore.getState());
}

export function SpectatorOverlay() {
  const spectator = useLiveHud((state) => state.spectator);
  if (!spectator) {
    return null;
  }

  return (
    <div className="spectator-banner" data-overlay="spectator" role="status">
      You died — watching
    </div>
  );
}
