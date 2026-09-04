/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

(() => {
    if (window.ncoLoggerHeroTime) return;

    const DAY_START_HOUR = 6;
    const NIGHT_START_HOUR = 18;
    const root = document.documentElement;
    const requestedOverride = new URLSearchParams(window.location.search).get('heroPeriod');
    const periodOverride = document.currentScript?.dataset.nodeEnv === 'development' &&
        ['day', 'night'].includes(requestedOverride) ? requestedOverride : null;
    let boundaryTimer;

    const resolvePeriod = date => {
        const hour = date.getHours();
        return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? 'day' : 'night';
    };

    const millisecondsUntilNextBoundary = date => {
        const nextBoundary = new Date(date);
        const hour = date.getHours();

        if (hour < DAY_START_HOUR) {
            nextBoundary.setHours(DAY_START_HOUR, 0, 0, 0);
        } else if (hour < NIGHT_START_HOUR) {
            nextBoundary.setHours(NIGHT_START_HOUR, 0, 0, 0);
        } else {
            nextBoundary.setDate(nextBoundary.getDate() + 1);
            nextBoundary.setHours(DAY_START_HOUR, 0, 0, 0);
        }

        return Math.max(1, nextBoundary.getTime() - date.getTime());
    };

    const applyPeriod = (date = new Date()) => {
        root.dataset.heroPeriod = periodOverride || resolvePeriod(date);
        window.clearTimeout(boundaryTimer);
        if (!periodOverride) boundaryTimer = window.setTimeout(applyPeriod, millisecondsUntilNextBoundary(date));
    };

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) applyPeriod();
    });

    window.ncoLoggerHeroTime = Object.freeze({
        DAY_START_HOUR,
        NIGHT_START_HOUR,
        resolvePeriod,
        millisecondsUntilNextBoundary,
        applyPeriod
    });

    applyPeriod();
})();
