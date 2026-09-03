/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

import { HttpClient, FavClient, Looper } from '#@client/lib/old__clientUtils.js';
import { serverInfo } from '#@client/lib/serverInfo.js';
import {
    formatConnectionLines,
    formatViewerDate,
    formatViewerTime,
    loadScheduledOccurrences
} from '#@client/lib/publicSchedule.js';

(async function () {
    const liveNetApi = new HttpClient('livenet', '/api/data/livenets');
    const favorites = new FavClient(1000, 1);
    const rowCollectionElem = document.getElementById('dashItemsContainer');
    const rowTemplateElem = document.getElementById('netTemplate');
    const netsStateElem = document.getElementById('nets-state');
    const liveNetsCountElem = document.getElementById('live-nets-count');
    let liveNetsLastHash;

    async function updateLiveNetsFromServer() {
        let liveNets;

        try {
            liveNets = await liveNetApi.index();
        } catch (error) {
            rowCollectionElem.setAttribute('aria-busy', 'false');
            if (netsStateElem) {
                netsStateElem.textContent = 'Live nets could not be loaded. Please try again shortly.';
            }
            if (error.response?.data?.errorMessage) {
                console.error(error.response.data.errorMessage);
            } else {
                console.error(error);
            }
        }

        const delMe = document.querySelectorAll('.liveNetRow');

        if (!liveNets?.data) {
            return undefined;
        }

        if (liveNetsLastHash != liveNets.data.hash) {
            const activeNets = liveNets.data.netlist;

            activeNets.slice(0, 4).forEach(liveNet => {
                const rowTemplateClone = rowTemplateElem.cloneNode(true);
                rowTemplateClone.id = `row-${liveNet.id}`;
                rowTemplateClone.classList.add('liveNetRow');

                const netTitleElem = rowTemplateClone.querySelector('#title');
                netTitleElem.innerText = liveNet.title;
                const netFreqElem = rowTemplateClone.querySelector('#frequency');
                const onAirStatusElem = rowTemplateClone.querySelector('#onairStatus');
                const checkInCountElem = rowTemplateClone.querySelector('#checkInCount');

                rowTemplateClone.dataset.href = liveNet.url;
                rowTemplateClone.setAttribute('role', 'link');
                rowTemplateClone.setAttribute('tabindex', '0');
                rowTemplateClone.setAttribute('aria-label', `Open ${liveNet.title}`);

                const iconElem = rowTemplateClone.querySelector('.favicon');
                iconElem.id = `fav-${liveNet.id}`;
                if (liveNet.permanent) {
                    iconElem.classList.add('d-none');
                }

                netFreqElem.innerText = formatConnectionLines(liveNet).join('\n');
                checkInCountElem.textContent = `${liveNet.checkInCount} Check-In${liveNet.checkInCount === 1 ? '' : 's'}`;

                const startTimeElem = rowTemplateClone.querySelector('#startTime');
                startTimeElem.textContent = '';
                onAirStatusElem.hidden = false;

                rowCollectionElem.appendChild(rowTemplateClone);
            });

            delMe.forEach(div => {
                rowCollectionElem.removeChild(div);
            });

            document.querySelectorAll('.liveNetRow').forEach(row => {
                row.classList.remove('d-none');
            });

            rowCollectionElem.setAttribute('aria-busy', 'false');
            if (netsStateElem) {
                netsStateElem.classList.toggle('d-none', activeNets.length > 0);
                if (activeNets.length === 0) {
                    netsStateElem.innerHTML =
                        '<i class="bi bi-moon-stars" aria-hidden="true"></i>No nets are currently live.';
                }
            }
            if (liveNetsCountElem) {
                liveNetsCountElem.hidden = activeNets.length === 0;
                liveNetsCountElem.textContent = activeNets.length > 0 ? `${activeNets.length}\u00A0LIVE NOW` : '';
            }

            return (liveNetsLastHash = liveNets.data.hash);
        } else {
            return undefined;
        }
    }

    const scheduledLists = {
        today: document.querySelector('[data-scheduled-net-list="today"]'),
        upcoming: document.querySelector('[data-scheduled-net-list="upcoming"]')
    };
    const scheduledTemplate = document.getElementById('scheduled-net-card-template');

    const renderScheduledNets = (kind, occurrences) => {
        const list = scheduledLists[kind];
        const empty = list.querySelector('[data-scheduled-net-empty]');
        list.querySelectorAll('.scheduledNetRow').forEach(row => row.remove());
        const previewLimit = kind === 'upcoming' ? 3 : 4;
        occurrences.slice(0, previewLimit).forEach(occurrence => {
            const card = scheduledTemplate.content.firstElementChild.cloneNode(true);
            card.classList.add('scheduledNetRow');
            card.dataset.href = occurrence.url;
            card.setAttribute('role', 'link');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-label', `Open ${occurrence.title}`);
            card.querySelector('[data-role="title"]').textContent = occurrence.title;
            card.querySelector('[data-role="date"]').textContent = kind === 'today'
                ? 'Today'
                : formatViewerDate(occurrence.startAt, { month: 'short', day: 'numeric' });
            card.querySelector('[data-role="start-time"]').textContent = formatViewerTime(occurrence.startAt);
            const description = card.querySelector('[data-role="description"]');
            description.textContent = occurrence.description;
            description.hidden = !occurrence.description;
            const followControl = card.querySelector('[data-role="follow-control"]');
            const followButton = followControl?.querySelector('.favicon');
            if (serverInfo.isLoggedIn && followControl && followButton) {
                followButton.id = `fav-${occurrence.netProfileId}`;
                followControl.hidden = false;
            }

            const connection = formatConnectionLines(occurrence).join(' · ');
            const connections = card.querySelector('[data-role="connection-methods"]');
            if (connection) {
                const term = document.createElement('dt');
                const details = document.createElement('dd');
                term.textContent = 'Connection';
                details.textContent = connection;
                details.title = connection;
                connections.append(term, details);
                connections.hidden = false;
            }
            list.appendChild(card);
        });
        empty.classList.toggle('d-none', occurrences.length > 0);
    };

    async function updateScheduledNetsFromServer() {
        try {
            const [today, upcoming] = await Promise.all([
                loadScheduledOccurrences({ window: 'today' }),
                loadScheduledOccurrences({ window: 'upcoming' })
            ]);
            renderScheduledNets('today', today.occurrences);
            renderScheduledNets('upcoming', upcoming.occurrences);
            if (serverInfo.isLoggedIn) await favorites.paintFromServerData();
        } catch (_error) {
            Object.values(scheduledLists).forEach(list => {
                const empty = list.querySelector('[data-scheduled-net-empty]');
                empty.classList.remove('d-none');
                empty.textContent = 'Scheduled nets could not be loaded.';
            });
        }
    }

    rowCollectionElem.addEventListener('click', event => {
        const favorite = event.target.closest('.favicon');
        if (favorite) {
            event.preventDefault();
            event.stopPropagation();
            favorites.handler({ target: favorite });
            return;
        }

        const row = event.target.closest('.liveNetRow');
        if (row?.dataset.href) {
            window.location.assign(row.dataset.href);
        }
    });

    rowCollectionElem.addEventListener('keydown', event => {
        const row = event.target.closest('.liveNetRow');
        if (event.target === row && row?.dataset.href && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            window.location.assign(row.dataset.href);
        }
    });

    Object.values(scheduledLists).forEach(list => {
        list.addEventListener('click', event => {
            const favorite = event.target.closest('.favicon');
            if (favorite) {
                event.preventDefault();
                event.stopPropagation();
                favorites.handler({ target: favorite });
                return;
            }

            const row = event.target.closest('.scheduledNetRow');
            if (row?.dataset.href) window.location.assign(row.dataset.href);
        });
        list.addEventListener('keydown', event => {
            const row = event.target.closest('.scheduledNetRow');
            if (event.target === row && row?.dataset.href && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                window.location.assign(row.dataset.href);
            }
        });
    });

    const loop = new Looper({
        label: 'Nets Update',
        refresh: 30000 / serverInfo.requestRateFactor,
        exec: async ({ i }) => {
            const [sig] = await Promise.all([updateLiveNetsFromServer(), updateScheduledNetsFromServer()]);
            if (Boolean(sig)) {
                console.debug(`updated dom for hash ${sig}`);
            }

            favorites.interval(i);
        }
    });

    try {
        await loop.run();
    } catch (error) {
        if (error.response?.data?.errorMessage) {
            console.error(error.response.data.errorMessage);
        } else {
            console.error(error);
        }
    }
})();
