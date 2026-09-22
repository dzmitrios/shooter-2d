import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../App.tsx';
import { resetAuthStore, useAuthStore } from '../auth/authStore.ts';
import { resetHubStore, useHubStore } from '../hub/hubStore.ts';
import { ArenaPage } from './ArenaPage.tsx';

describe('ArenaPage matchmaking transition', () => {
  beforeEach(() => {
    resetAuthStore();
    resetHubStore();
  });

  afterEach(() => {
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
});
