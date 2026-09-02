/* hamlive-oss — MIT License. See LICENSE. */

'use strict';

import { HttpClient, Looper, FavClient } from '#@client/lib/old__clientUtils.js';
import { serverInfo } from '#@client/lib/serverInfo.js';
import { formatConnectionLines } from '#@client/lib/publicSchedule.js';

(async function () {
    const id = window.location.pathname.split('/')[3];
    const netProfileDetailApi = new HttpClient('netProfileDetail', `/api/data/netprofiles/${id}`);
    const favorites = new FavClient(20000 / serverInfo.requestRateFactor, 4);
    const favIconElem = document.getElementById('fav-' + id);
    favIconElem.addEventListener('click', favorites.handler.bind(favorites));
    const scheduledStartElem = document.getElementById('scheduledStart');
    const showScheduledStart = value => {
        const startAt = new Date(value);
        if (!value || Number.isNaN(startAt.getTime())) {
            scheduledStartElem.hidden = true;
            return;
        }
        const minutes = Math.ceil((startAt.getTime() - Date.now()) / 60000);
        scheduledStartElem.innerText = minutes > 1
            ? `Starts in ${minutes} minutes`
            : minutes === 1
              ? 'Starts in 1 minute'
              : 'Starting soon';
        scheduledStartElem.hidden = false;
    };
    showScheduledStart(scheduledStartElem.dataset.startAt);

    const loop = new Looper({
        label: 'Net polling',
        refresh: 20000 / serverInfo.requestRateFactor,
        exec: async ({ i }) => {
            const np = await netProfileDetailApi.index();
            document.getElementById('netTitle').innerText = `${np.data.title}`;
            document.getElementById('waiting-card-title').innerText = `${np.data.title}`;

            const connectionGroup = document.getElementById('netConnection');
            const connectionLines = document.getElementById('netConnectionLines');
            connectionLines.replaceChildren(...formatConnectionLines(np.data).map(line => {
                const item = document.createElement('p');
                item.textContent = line;
                return item;
            }));
            connectionGroup.hidden = !connectionLines.childElementCount;
            showScheduledStart(np.data.scheduledStartAt);

            favorites.interval(i);

            np.data.live === true && location.reload(true);
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
