/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

import { HttpClient, FavClient, Looper } from '#@client/lib/old__clientUtils.js';
import { serverInfo } from '#@client/lib/serverInfo.js';

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
            console.log('NEW Data, data signature changed');

            const activeNets = liveNets.data.netlist.filter(liveNet => !liveNet.closing);

            activeNets.forEach(liveNet => {
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

                if (!liveNet.frequency || parseInt(liveNet.frequency) == 0) {
                    liveNet.frequency = '';
                }

                netFreqElem.innerText =
                    liveNet.mode === 'CUSTOM'
                        ? `${liveNet.frequency} ${liveNet.modeDetails}`
                        : liveNet.mode === 'Reflector'
                          ? `${liveNet.modeDetails}`
                          : `${liveNet.frequency} ${liveNet.mode}`;
                checkInCountElem.textContent = `${liveNet.checkInCount} Check-In${liveNet.checkInCount === 1 ? '' : 's'}`;

                let startTime = new Date(liveNet.createdAt);

                startTime.setMinutes(startTime.getMinutes() + liveNet.countdownTimer);

                const startTimeElem = rowTemplateClone.querySelector('#startTime');

                if (liveNet.started) {
                    startTimeElem.textContent = '';
                    onAirStatusElem.hidden = false;
                } else {
                    startTimeElem.innerText = '@' + startTime.toLocaleTimeString([], { timeStyle: 'short' });
                }

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
                        '<i class="bi bi-moon-stars" aria-hidden="true"></i>No nets are live right now. Check back soon.';
                }
            }
            if (liveNetsCountElem) {
                liveNetsCountElem.hidden = activeNets.length === 0;
                liveNetsCountElem.textContent = activeNets.length > 0 ? `${activeNets.length} LIVE NOW` : '';
            }

            return (liveNetsLastHash = liveNets.data.hash);
        } else {
            return undefined;
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

    const loop = new Looper({
        label: 'Nets Update',
        refresh: 30000 / serverInfo.requestRateFactor,
        exec: async ({ i }) => {
            let sig;
            if (Boolean((sig = await updateLiveNetsFromServer()))) {
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
