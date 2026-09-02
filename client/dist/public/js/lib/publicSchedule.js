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

const clean = value => typeof value === 'string' ? value.trim() : '';
const withMHz = value => {
    const frequency = clean(value);
    return frequency && !/\bMHz\b/i.test(frequency) ? `${frequency} MHz` : frequency;
};

const formatStructuredConnection = connection => {
    switch (connection?.type) {
        case 'FM':
            return `FM: ${[
                withMHz(connection.frequency),
                connection.operation === 'Repeater' && withMHz(connection.offset),
                connection.operation === 'Simplex' && 'Simplex',
                clean(connection.tone) && `PL ${clean(connection.tone)}`
            ].filter(Boolean).join(' · ')}`;
        case 'HF':
            return `HF: ${[withMHz(connection.frequency), clean(connection.mode)].filter(Boolean).join(' · ')}`;
        case 'AllStarLink':
            return `AllStarLink: ${clean(connection.node)}`;
        case 'EchoLink':
            return `EchoLink: ${clean(connection.callsign) || clean(connection.node)}`;
        case 'DMR':
            return `DMR: ${[clean(connection.talkgroup) && `TG ${clean(connection.talkgroup)}`, clean(connection.colorCode) && `CC ${clean(connection.colorCode)}`].filter(Boolean).join(' · ')}`;
        case 'D-STAR':
            return `D-STAR: ${[clean(connection.reflector), clean(connection.module)].filter(Boolean).join(' ')}`;
        case 'YSF':
            return `YSF: ${clean(connection.room) || clean(connection.reflector)}`;
        case 'P25':
            return `P25: ${clean(connection.talkgroup) && `TG ${clean(connection.talkgroup)}`}`;
        case 'M17':
            return `M17: ${[clean(connection.reflector), clean(connection.module)].filter(Boolean).join(' / ')}`;
        case 'NXDN':
            return `NXDN: ${clean(connection.talkgroup) && `TG ${clean(connection.talkgroup)}`}`;
        case 'Zello':
            return `Zello: ${clean(connection.channel)}`;
        case 'Other':
            return `Other: ${[clean(connection.label), clean(connection.value)].filter(Boolean).join(': ')}`;
        case 'Legacy':
            return `Connection: ${clean(connection.value)}`;
        default:
            return '';
    }
};

export const formatConnectionLines = net => {
    if (Array.isArray(net?.connections) && net.connections.length) {
        return net.connections.map(formatStructuredConnection).filter(line => line && !line.endsWith(': '));
    }
    const frequency = net.frequency && Number.parseFloat(net.frequency) !== 0 ? net.frequency : '';
    if (net.mode === 'Reflector') return net.modeDetails ? [`Connection: ${net.modeDetails}`] : [];
    if (net.mode === 'CUSTOM') return [[frequency, net.modeDetails].filter(Boolean).join(' · ')].filter(Boolean);
    return [[frequency, net.mode].filter(Boolean).join(' · ')].filter(Boolean);
};

export const formatConnection = net => formatConnectionLines(net).join('\n');

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
