/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

export const getViewerTimeZone = () => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (_error) {
        return 'UTC';
    }
};

export const loadScheduledOccurrences = async ({ window, start, limit = 100 }) => {
    const params = new URLSearchParams({ window, timezone: getViewerTimeZone(), limit: String(limit) });
    if (start) params.set('start', start);
    const response = await fetch(`/api/data/scheduled-occurrences?${params.toString()}`, {
        headers: { Accept: 'application/json' }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.errorMessage || 'Scheduled nets could not be loaded');
    return data;
};

export const formatConnection = net => {
    const frequency = net.frequency && Number.parseFloat(net.frequency) !== 0 ? net.frequency : '';
    if (net.mode === 'Reflector') return net.modeDetails || 'Reflector';
    if (net.mode === 'CUSTOM') return [frequency, net.modeDetails].filter(Boolean).join(' · ');
    return [frequency, net.mode].filter(Boolean).join(' · ');
};

export const formatViewerTime = value =>
    new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date(value));

export const formatViewerDate = (value, options = {}) =>
    new Intl.DateTimeFormat([], options).format(new Date(value));

export const viewerDateKey = value => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: getViewerTimeZone(),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
};
