import { useAuthStore } from '../auth/authStore.ts';
import { useHubStore } from '../hub/hubStore.ts';
import { useHudStore, type HudState } from './hudStore.ts';

function useLiveHud<T>(selector: (state: HudState) => T): T {
  useHudStore(selector);
  return selector(useHudStore.getState());
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function ResultsScreen() {
  const results = useLiveHud((state) => state.results);
  const localUserId = useAuthStore.getState().userId;
  if (!results) {
    return null;
  }

  return (
    <div className="results-screen" data-overlay="results" role="dialog" aria-modal="true">
      <div className="results-card">
        <h2>Run complete</h2>
        <table className="results-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Waves</th>
              <th>Kills</th>
              <th>Survival</th>
              <th>Meta-points</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr
                key={row.userId}
                data-result-user={row.userId}
                className={row.userId === localUserId ? 'local' : undefined}
              >
                <td>{row.userId === localUserId ? 'You' : row.userId.slice(0, 8)}</td>
                <td>{row.waves}</td>
                <td>{row.kills}</td>
                <td>{formatTime(row.survivedSec)}</td>
                <td>{row.metaPointsEarned}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          className="results-return"
          onClick={() => useHubStore.getState().returnToHub()}
        >
          Return to Hub
        </button>
      </div>
    </div>
  );
}
