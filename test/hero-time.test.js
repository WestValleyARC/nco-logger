/* hamlive-oss — MIT License. See LICENSE. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const heroTimeSource = fs.readFileSync(
    path.resolve(__dirname, '../client/dist/public/js/lib/heroTime.js'),
    'utf8'
);

const loadHeroTime = ({ nodeEnv = 'development', search = '', now = new Date(2026, 0, 15, 12) } = {}) => {
    const root = { dataset: {} };
    const listeners = {};
    const scheduled = [];
    class FakeDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : [now.getTime()]));
        }
    }
    const document = {
        currentScript: { dataset: { nodeEnv } },
        documentElement: root,
        hidden: false,
        addEventListener: (name, listener) => { listeners[name] = listener; }
    };
    const window = {
        location: { search },
        clearTimeout: () => {},
        setTimeout: (callback, delay) => {
            scheduled.push({ callback, delay });
            return scheduled.length;
        }
    };

    vm.runInNewContext(heroTimeSource, { Date: FakeDate, URLSearchParams, document, window });
    return { api: window.ncoLoggerHeroTime, listeners, root, scheduled };
};

test('hero period resolves normal day and night hours', () => {
    const { api } = loadHeroTime();
    assert.equal(api.resolvePeriod(new Date(2026, 0, 15, 5, 59)), 'night');
    assert.equal(api.resolvePeriod(new Date(2026, 0, 15, 6)), 'day');
    assert.equal(api.resolvePeriod(new Date(2026, 0, 15, 17, 59)), 'day');
    assert.equal(api.resolvePeriod(new Date(2026, 0, 15, 18)), 'night');
});

test('hero timer targets each next day/night boundary', () => {
    const { api } = loadHeroTime();
    assert.equal(api.millisecondsUntilNextBoundary(new Date(2026, 0, 15, 5)), 60 * 60 * 1000);
    assert.equal(api.millisecondsUntilNextBoundary(new Date(2026, 0, 15, 12)), 6 * 60 * 60 * 1000);
    assert.equal(api.millisecondsUntilNextBoundary(new Date(2026, 0, 15, 20)), 10 * 60 * 60 * 1000);
});

test('development day override survives apply and visibility updates without scheduling', () => {
    const state = loadHeroTime({ search: '?heroPeriod=day', now: new Date(2026, 0, 15, 22) });
    assert.equal(state.root.dataset.heroPeriod, 'day');
    state.api.applyPeriod(new Date(2026, 0, 15, 22));
    state.listeners.visibilitychange();
    assert.equal(state.root.dataset.heroPeriod, 'day');
    assert.equal(state.scheduled.length, 0);
});

test('development night override survives apply and visibility updates without scheduling', () => {
    const state = loadHeroTime({ search: '?heroPeriod=night', now: new Date(2026, 0, 15, 12) });
    assert.equal(state.root.dataset.heroPeriod, 'night');
    state.api.applyPeriod(new Date(2026, 0, 15, 12));
    state.listeners.visibilitychange();
    assert.equal(state.root.dataset.heroPeriod, 'night');
    assert.equal(state.scheduled.length, 0);
});

test('production ignores hero period query overrides', () => {
    const state = loadHeroTime({ nodeEnv: 'production', search: '?heroPeriod=day', now: new Date(2026, 0, 15, 22) });
    assert.equal(state.root.dataset.heroPeriod, 'night');
    assert.equal(state.scheduled.length, 1);
});
