import { useHudStore, type HudState } from './hudStore.ts';
import { xpBar } from './hud.ts';

function useLiveHud<T>(selector: (state: HudState) => T): T {
  useHudStore(selector);
  return selector(useHudStore.getState());
}

export function ArenaHud() {
  const hp = useLiveHud((state) => state.hp);
  const maxHp = useLiveHud((state) => state.maxHp);
  const level = useLiveHud((state) => state.level);
  const xp = useLiveHud((state) => state.xp);
  const wave = useLiveHud((state) => state.wave);
  const kills = useLiveHud((state) => state.kills);
  const bar = xpBar(xp, level);
  const hpRatio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;

  return (
    <div className="arena-hud" data-hud="main">
      <div className="hud-vitals">
        <div className="hud-meter" data-hud="hp">
          <span className="hud-label">HP</span>
          <div className="hud-bar">
            <div className="hud-bar-fill hp" style={{ width: `${hpRatio * 100}%` }} />
          </div>
          <span className="hud-value">
            {hp}/{maxHp}
          </span>
        </div>
        <div className="hud-meter" data-hud="xp">
          <span className="hud-label">XP</span>
          <div className="hud-bar">
            <div className="hud-bar-fill xp" style={{ width: `${bar.ratio * 100}%` }} />
          </div>
          <span className="hud-value">
            {bar.current}/{bar.next}
          </span>
        </div>
        <p className="hud-level" data-hud="level">
          Lv {level}
        </p>
      </div>
      <div className="hud-run">
        <p data-hud="wave">Wave {wave}</p>
        <p data-hud="kills">Kills {kills}</p>
      </div>
    </div>
  );
}
