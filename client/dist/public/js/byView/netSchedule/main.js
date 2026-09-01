/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

import {
    formatConnection,
    formatViewerDate,
    formatViewerTime,
    getViewerTimeZone,
    loadScheduledOccurrences,
    viewerDateKey
} from '#@client/lib/publicSchedule.js';

const params = new URLSearchParams(window.location.search);
const view = params.get('view') === 'upcoming' ? 'upcoming' : 'today';
let start = params.get('start') || '';
const results = document.getElementById('schedule-results');
const state = document.getElementById('schedule-state');
const dayTemplate = document.getElementById('schedule-day-template');
const itemTemplate = document.getElementById('schedule-item-template');
const periodControls = document.getElementById('schedule-period-controls');

document.querySelector(`[data-schedule-view="${view}"]`).classList.add('is-current');
document.getElementById('schedule-eyebrow').textContent = view === 'today' ? "Today's Schedule" : '7-Day Schedule';
document.getElementById('schedule-timezone').textContent = `Times shown in ${getViewerTimeZone()}`;
periodControls.hidden = view !== 'upcoming';

const shiftDate = (dateKey, days) => {
    const date = dateKey ? new Date(`${dateKey}T12:00:00`) : new Date();
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const render = occurrences => {
    results.querySelectorAll('.schedule-day').forEach(day => day.remove());
    const groups = new Map();
    occurrences.forEach(occurrence => {
        const key = viewerDateKey(occurrence.startAt);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(occurrence);
    });
    groups.forEach(items => {
        const day = dayTemplate.content.firstElementChild.cloneNode(true);
        day.querySelector('[data-role="day"]').textContent = formatViewerDate(items[0].startAt, {
            weekday: 'long', month: 'long', day: 'numeric'
        });
        const container = day.querySelector('[data-role="items"]');
        items.forEach(occurrence => {
            const item = itemTemplate.content.firstElementChild.cloneNode(true);
            item.href = occurrence.url;
            item.querySelector('[data-role="time"]').textContent = formatViewerTime(occurrence.startAt);
            item.querySelector('[data-role="title"]').textContent = occurrence.title;
            item.querySelector('[data-role="connection"]').textContent = formatConnection(occurrence);
            const description = item.querySelector('[data-role="description"]');
            description.textContent = occurrence.description;
            description.hidden = !occurrence.description;
            container.appendChild(item);
        });
        results.appendChild(day);
    });
    state.hidden = occurrences.length > 0;
    if (!occurrences.length) {
        state.innerHTML = `<i class="bi bi-calendar2-x" aria-hidden="true"></i>${
            view === 'today' ? 'No scheduled nets today.' : 'No scheduled nets in this 7-day period.'
        }`;
    }
};

const refresh = async () => {
    try {
        const data = await loadScheduledOccurrences({
            window: view === 'today' ? 'today' : 'seven-day',
            start: view === 'upcoming' ? start : undefined
        });
        if (view === 'upcoming' && !start) start = data.range.localStart;
        render(data.occurrences);
        results.setAttribute('aria-busy', 'false');
    } catch (_error) {
        state.hidden = false;
        state.textContent = 'The net schedule could not be loaded. Please try again shortly.';
        results.setAttribute('aria-busy', 'false');
    }
};

periodControls.addEventListener('click', event => {
    const button = event.target.closest('[data-shift]');
    if (!button) return;
    const nextStart = shiftDate(start, Number(button.dataset.shift));
    window.location.assign(`/views/schedule?view=upcoming&start=${nextStart}`);
});

await refresh();
window.setInterval(refresh, 30000);
