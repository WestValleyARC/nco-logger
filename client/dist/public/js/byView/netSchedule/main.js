/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

import { FavClient } from '#@client/lib/old__clientUtils.js';
import { serverInfo } from '#@client/lib/serverInfo.js';
import {
    formatConnectionLines,
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
const favorites = new FavClient(1000, 1);

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
            const row = itemTemplate.content.firstElementChild.cloneNode(true);
            const item = row.querySelector('.schedule-item');
            item.href = occurrence.url;
            item.querySelector('[data-role="time"]').textContent = formatViewerTime(occurrence.startAt);
            item.querySelector('[data-role="title"]').textContent = occurrence.title;
            const connection = item.querySelector('[data-role="connection"]');
            connection.replaceChildren(...formatConnectionLines(occurrence).map(line => {
                const detail = document.createElement('span');
                detail.textContent = line;
                return detail;
            }));
            const description = item.querySelector('[data-role="description"]');
            description.textContent = occurrence.description;
            description.hidden = !occurrence.description;

            const followControl = row.querySelector('[data-role="follow-control"]');
            const followButton = followControl?.querySelector('.favicon');
            if (serverInfo.isLoggedIn && followControl && followButton) {
                followButton.id = `fav-${occurrence.netProfileId}`;
                followControl.hidden = false;
            }

            container.appendChild(row);
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
        if (serverInfo.isLoggedIn) await favorites.paintFromServerData();
        results.setAttribute('aria-busy', 'false');
    } catch (_error) {
        state.hidden = false;
        state.textContent = 'The net schedule could not be loaded. Please try again shortly.';
        results.setAttribute('aria-busy', 'false');
    }
};

results.addEventListener('click', event => {
    const favorite = event.target.closest('.favicon');
    if (!favorite) return;
    event.preventDefault();
    event.stopPropagation();
    favorites.handler({ target: favorite });
});

periodControls.addEventListener('click', event => {
    const button = event.target.closest('[data-shift]');
    if (!button) return;
    const nextStart = shiftDate(start, Number(button.dataset.shift));
    window.location.assign(`/views/schedule?view=upcoming&start=${nextStart}`);
});

await refresh();
window.setInterval(refresh, 30000);
