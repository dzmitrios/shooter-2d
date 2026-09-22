import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../App.tsx';
import { resetAuthStore, useAuthStore } from '../auth/authStore.ts';
import { resetHudStore, useHudStore } from '../game/hudStore.ts';
import { resetHubStore, useHubStore } from '../hub/hubStore.ts';
import { ArenaPage } from './ArenaPage.tsx';

describe('ArenaPage matchmaking transition', () => {
  beforeEach(() => {
    resetAuthStore();
    resetHubStore();
    resetHudStore();
  });

  afterEach(() => {
    resetHudStore();
    resetHubStore();
    resetAuthStore();
  });

  it('shows Match found overlay before the arena renders', () => {
    useHubStore.setState({ matchFoundVisible: true, match: { seed: 1, waveConfig: [] } });
    const html = renderToStaticMarkup(createElement(ArenaPage));
    assert.match(html, /Match found!/);
    assert.match(html, /data-overlay="match-found"/);
    assert.doesNotMatch(html, /data-arena="ready"/);
  });

  it('renders the arena after the overlay is dismissed', () => {
    useHubStore.setState({ matchFoundVisible: false, match: { seed: 1, waveConfig: [] } });
    const html = renderToStaticMarkup(createElement(ArenaPage));
    assert.match(html, /data-arena="ready"/);
    assert.doesNotMatch(html, /Match found!/);
  });

  it('App navigates to ArenaPage on arena screen', () => {
    useAuthStore.setState({ screen: 'arena', hydrated: true, token: 'tok', userId: 'u' });
    useHubStore.setState({ matchFoundVisible: true, match: { seed: 9, waveConfig: [] } });
    const html = renderToStaticMarkup(createElement(App));
    assert.match(html, /Match found!/);
    assert.doesNotMatch(html, />Hub</);
  });

  it('arena stage is a full-viewport host for the PixiJS canvas', () => {
    useHubStore.setState({ matchFoundVisible: false, match: { seed: 1, waveConfig: [] } });
    const html = renderToStaticMarkup(createElement(ArenaPage));
    assert.match(html, /class="arena-page"/);
    assert.match(html, /class="arena-stage"/);
    assert.match(html, /data-arena="ready"/);
  });
});

describe('ArenaPage HUD and overlays', () => {
  beforeEach(() => {
    resetAuthStore();
    resetHubStore();
    resetHudStore();
    useAuthStore.setState({ screen: 'arena', hydrated: true, token: 'tok', userId: 'u-local' });
    useHubStore.setState({ matchFoundVisible: false, match: { seed: 1, waveConfig: [] } });
  });

  afterEach(() => {
    resetHudStore();
    resetHubStore();
    resetAuthStore();
  });

  it('renders HP, level, and XP bars over the arena', () => {
    useHudStore.setState({ hp: 72, maxHp: 100, level: 3, xp: 280 });
    const html = renderToStaticMarkup(createElement(ArenaPage));
    assert.match(html, /data-hud="main"/);
    assert.match(html, /data-hud="hp"/);
    assert.match(html, /72\/100/);
    assert.match(html, /data-hud="level"/);
    assert.match(html, /Lv 3/);
    assert.match(html, /data-hud="xp"/);
    assert.doesNotMatch(html, /ammo/i);
    assert.match(html, /data-arena="ready"/);
  });

  it('renders wave counter and kill count', () => {
    useHudStore.setState({ wave: 4, kills: 17 });
    const html = renderToStaticMarkup(createElement(ArenaPage));
    assert.match(html, /data-hud="wave"/);
    assert.match(html, /Wave 4/);
    assert.match(html, /data-hud="kills"/);
    assert.match(html, /Kills 17/);
  });

  it('renders upgrade choice modal that covers the arena', () => {
    useHudStore.setState({
      upgradeChoices: ['move_speed', 'reload_speed', 'damage'],
      pendingUpgrades: 1,
      inputBlocked: true,
    });
    const html = renderToStaticMarkup(createElement(ArenaPage));
    assert.match(html, /data-overlay="upgrade"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /data-upgrade="move_speed"/);
    assert.match(html, /data-upgrade="reload_speed"/);
    assert.match(html, /data-upgrade="damage"/);
    assert.match(html, /data-arena="ready"/);
  });

  it('shows spectator banner while the arena keeps rendering', () => {
    useHudStore.setState({ spectator: true, hp: 0 });
    const html = renderToStaticMarkup(createElement(ArenaPage));
    assert.match(html, /data-overlay="spectator"/);
    assert.match(html, /You died — watching/);
    assert.match(html, /data-arena="ready"/);
    assert.match(html, /data-hud="main"/);
  });

  it('renders results with per-player stats and a return button', () => {
    useHudStore.setState({
      results: [
        { userId: 'u-local', waves: 5, kills: 21, survivedSec: 95, metaPointsEarned: 40 },
        { userId: 'u-other', waves: 4, kills: 11, survivedSec: 80, metaPointsEarned: 22 },
      ],
      inputBlocked: true,
    });
    const html = renderToStaticMarkup(createElement(ArenaPage));
    assert.match(html, /data-overlay="results"/);
    assert.match(html, /data-result-user="u-local"/);
    assert.match(html, />You</);
    assert.match(html, />5</);
    assert.match(html, />21</);
    assert.match(html, /1:35/);
    assert.match(html, />40</);
    assert.match(html, /Return to Hub/);
    assert.doesNotMatch(html, /data-hud="main"/);
  });
});
