/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

import { FavClient } from '#@client/lib/old__clientUtils.js';
import { formatConnectionLines } from '#@client/lib/publicSchedule.js';
import { serverInfo } from '#@client/lib/serverInfo.js';

const list = document.getElementById('public-live-list');
const state = document.getElementById('public-live-state');
const template = document.getElementById('public-live-template');
const total = document.getElementById('public-live-total');
const favorites = new FavClient(1000, 1);

const refresh = async () => {
    try {
        const response = await fetch('/api/data/livenets', { headers: { Accept: 'application/json' } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.errorMessage || 'Live nets could not be loaded');
        list.querySelectorAll('.public-live-card').forEach(card => card.remove());
        data.netlist.forEach(net => {
            const card = template.content.firstElementChild.cloneNode(true);
            card.dataset.href = net.url;
            card.setAttribute('aria-label', `Open ${net.title}`);
            const favorite = card.querySelector('.landing-net-favorite');
            if (favorite) {
                favorite.id = `fav-${net.id}`;
                if (net.permanent) favorite.classList.add('d-none');
            }
            card.querySelector('[data-role="title"]').textContent = net.title;
            const connection = card.querySelector('[data-role="connection"]');
            const connectionLines = formatConnectionLines(net);
            connection.replaceChildren(...(connectionLines.length ? connectionLines : ['Connection details not listed']).map(line => {
                const item = document.createElement('span');
                item.textContent = line;
                return item;
            }));
            card.querySelector('[data-role="check-ins"]').textContent =
                `${net.checkInCount} Check-In${net.checkInCount === 1 ? '' : 's'}`;
            list.appendChild(card);
        });
        if (serverInfo.isLoggedIn) await favorites.paintFromServerData();
        state.hidden = data.netlist.length > 0;
        if (!data.netlist.length) {
            state.innerHTML = '<i class="bi bi-moon-stars" aria-hidden="true"></i>No nets are currently live.';
        }
        total.hidden = data.netlist.length === 0;
        total.textContent = `${data.netlist.length} LIVE NOW`;
        list.setAttribute('aria-busy', 'false');
    } catch (error) {
        state.hidden = false;
        state.textContent = 'Live nets could not be loaded. Please try again shortly.';
        list.setAttribute('aria-busy', 'false');
    }
};

list.addEventListener('click', event => {
    const favorite = event.target.closest('.landing-net-favorite');
    if (favorite) {
        event.preventDefault();
        event.stopPropagation();
        void favorites.handler({ target: favorite });
        return;
    }

    const card = event.target.closest('.public-live-card');
    if (card?.dataset.href) window.location.assign(card.dataset.href);
});

list.addEventListener('keydown', event => {
    const card = event.target.closest('.public-live-card');
    if (event.target === card && card?.dataset.href && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        window.location.assign(card.dataset.href);
    }
});

await refresh();
window.setInterval(refresh, 30000);
