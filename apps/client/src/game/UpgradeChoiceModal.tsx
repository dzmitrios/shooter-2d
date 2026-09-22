import type { UpgradeOptionId } from '@shooter/shared';
import { UPGRADE_LABELS } from './hud.ts';
import { useHudStore, type HudState } from './hudStore.ts';

function useLiveHud<T>(selector: (state: HudState) => T): T {
  useHudStore(selector);
  return selector(useHudStore.getState());
}

export function UpgradeChoiceModal() {
  const choices = useLiveHud((state) => state.upgradeChoices);
  if (!choices) {
    return null;
  }

  return (
    <div className="upgrade-modal" data-overlay="upgrade" role="dialog" aria-modal="true">
      <div className="upgrade-modal-card">
        <h2>Level up</h2>
        <p>Choose an upgrade</p>
        <div className="upgrade-options">
          {choices.map((optionId) => (
            <UpgradeCard key={optionId} optionId={optionId} />
          ))}
        </div>
      </div>
    </div>
  );
}

function UpgradeCard({ optionId }: { optionId: UpgradeOptionId }) {
  return (
    <button
      type="button"
      className="upgrade-option"
      data-upgrade={optionId}
      onClick={() => useHudStore.getState().chooseUpgrade(optionId)}
    >
      {UPGRADE_LABELS[optionId]}
    </button>
  );
}
