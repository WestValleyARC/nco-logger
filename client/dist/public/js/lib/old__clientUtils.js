/* hamlive-oss — MIT License. See LICENSE. */

import { serverInfo } from '#@client/lib/serverInfo.js';

class HttpClient {
    #url;
    #label;
    #httpClient;

    constructor(_label, url, config = {}) {
        this.#label = _label;
        this.#url = url;

        this.#httpClient = axios.create({ ...config });
        this.#httpClient.defaults.timeout = serverInfo.httpClientTimeout;
    }

    get label() {
        return this.#label;
    }

    get url() {
        return this.#url;
    }

    async index(options = { followRedirs: false }) {
        const response = await this.#httpClient.get(this.#url);

        //detect redirects:
        if (options.followRedirs && response.request.responseURL != window.location.origin + this.#url) {
            console.warn(`redirect detected, go to ${response.request.responseURL}`);
            window.location.replace(response.request.responseURL);
        } else {
            return response;
        }
    }

    async show(id) {
        return this.#httpClient.get(`${this.#url}/${id}`);
    }

    async update(data, id) {
        return this.#httpClient.patch(`${this.#url}/${id}`, data);
    }

    async create(data, id) {
        if (id) {
            return this.#httpClient.post(`${this.#url}/${id}`, data);
        } else {
            return this.#httpClient.post(this.#url, data);
        }
    }

    async delete(id) {
        return this.#httpClient.delete(`${this.#url}/${id}`);
    }
}

class FavClient {
    #favClicked;
    #delayedFavReqScheduled;
    #delayedFavReqTimer;
    #followIdsSet;
    #uxDelay;
    #mod;
    #favApi;
    #followDataCache;

    constructor(_uxDelay, _mod) {
        this.#uxDelay = _uxDelay;
        this.#mod = _mod;
        this.#favApi = new HttpClient('follow', '/api/data/follow');
        this.#favClicked = false;
    }

    async populateCache() {
        if (!serverInfo.isLoggedIn) return; // we wont be able to access the fav api if not logged in

        try {
            this.#followDataCache = (await this.#favApi.index()).data.message;
        } catch (error) {
            if (error.response?.data?.errorMessage) {
                console.warn(error.response.data.errorMessage);
            } else {
                console.warn(error);
            }
        }

        if (Array.isArray(this.#followDataCache?.netlist)) {
            this.#followIdsSet = new Set(
                this.#followDataCache.netlist.map(n => {
                    return n.id;
                })
            );
            return true;
        } else {
            throw new Error('could not parse follow data from server, not logged in? ?');
        }
    }

    get cache() {
        return this.#followDataCache;
    }

    get clicked() {
        return this.#favClicked;
    }

    async #favorite(npid, state) {
        if (state) {
            this.#followIdsSet.add(npid);
            await this.paintFromCacheData();

            try {
                await this.#favApi.create({ follow: state }, npid);
            } catch (error) {
                if (error.response.data.errorMessage) {
                    console.warn(error.response.data.errorMessage);
                } else {
                    console.warn(error);
                }
            }
        } else {
            this.#followIdsSet.delete(npid);
            await this.paintFromCacheData();

            try {
                await this.#favApi.delete(npid);
            } catch (error) {
                if (error.response.data.errorMessage) {
                    console.warn(error.response.data.errorMessage);
                } else {
                    console.warn(error);
                }
            }
        }
    }

    async handler(event) {
        const targetClass = event.target.getAttribute('class');
        if (targetClass?.includes('favicon')) {
            this.#favClicked = true;

            const npid = event.target.getAttribute('id')?.replace(/fav\-/, '');

            if (targetClass.includes('bi-heart-fill')) {
                await this.#favorite(npid, false);
            } else {
                await this.#favorite(npid, true);
            }
        }
    }

    async #paint({ updateCache = false }) {
        updateCache && (await this.populateCache());

        document.querySelectorAll('.favicon').forEach(iconElem => {
            const npid = iconElem.getAttribute('id')?.replace(/fav\-/, '');

            let currentClass = iconElem.getAttribute('class');

            if (npid) {
                if (typeof this.#followIdsSet !== 'undefined') {
                    if (this.#followIdsSet.has(npid)) {
                        if (!currentClass.includes('bi-heart-fill')) {
                            iconElem.setAttribute('class', currentClass.replace('bi-heart', 'bi-heart-fill'));
                        }
                        iconElem.setAttribute('aria-label', 'Remove from Favorites');
                        iconElem.setAttribute('title', 'Remove from Favorites');
                    } else {
                        iconElem.setAttribute('class', currentClass.replace('bi-heart-fill', 'bi-heart'));
                        iconElem.setAttribute('aria-label', 'Add to Favorites');
                        iconElem.setAttribute('title', 'Add to Favorites');
                    }
                }
            }
        });
    }

    async paintFromCacheData() {
        await this.#paint({ updateCache: false });
    }

    async paintFromServerData() {
        await this.#paint({ updateCache: true });
    }

    async interval(i) {
        if (this.#favClicked) {
            this.#favClicked = false;

            if (this.#delayedFavReqScheduled) {
                clearTimeout(this.#delayedFavReqTimer);
                console.debug('canceling prev delayed favreq, so we can push out further');
            }

            console.debug('scheduling delayed favreq');
            this.#delayedFavReqScheduled = true;

            this.#delayedFavReqTimer = setTimeout(async () => {
                console.debug('delayed favreq running...');

                try {
                    await this.paintFromServerData();
                } catch (error) {
                    if (error.response?.data?.errorMessage) {
                        console.warn(error.response.data.errorMessage);
                    } else {
                        console.warn(error);
                    }
                }

                this.#delayedFavReqScheduled = false;
            }, this.#uxDelay);
        } else if (i === 0 || (i % this.#mod == 0 && !this.#delayedFavReqScheduled)) {
            console.debug('getting favs from server...');
            try {
                await this.paintFromServerData();
            } catch (error) {
                if (error.response?.data?.errorMessage) {
                    console.warn(error.response.data.errorMessage);
                } else {
                    console.warn(error);
                }
            }
        }
    }
}

class FormState {
    #_mode;
    #_label;
    #formElement;
    #formStatusElement;
    #formStateElement;

    constructor(_label, _mode) {
        this.#_mode = _mode;
        this.#_label = _label;
        this.#formElement = document.getElementById(this.#_label + '_form');
        this.#formStatusElement = document.getElementById(this.#_label + '_form_status');
        this.#formStateElement = document.getElementById(`input_${this.#_label}_mode`);
    }

    mesg(type, mesg = '') {
        let color;

        switch (type) {
            case 'info':
                color = 'secondary';
                break;
            case 'error':
            case 'warning':
            case 'danger':
                color = 'danger';
                break;
            default:
                color = 'secondary';
        }

        this.#formStatusElement.setAttribute('class', `text-${color}`);
        this.#formStatusElement.innerText = mesg;

        return { mesg, color };
    }

    get mode() {
        return this.#_mode;
    }

    get label() {
        return this.#_label;
    }

    set mode(newMode) {
        this.#_mode = newMode;

        if (newMode === 'new') {
            // this.#formElement.reset();
            this.#formStateElement.value = newMode;
            this.mesg('info', `create new ${this.#_label}`);
        } else if (newMode === 'edit') {
            this.#formStateElement.value = newMode;
            this.mesg('info', `edit existing ${this.#_label}`);
        }
    }
}

class Looper {
    #label;
    #refresh;
    #exec;
    #timerId;
    #iteration = 0;

    constructor({ label, refresh, exec }) {
        this.#label = label;
        this.#refresh = parseInt(refresh) || 500;
        this.#exec = exec;
    }

    async run() {
        const that = this;

        await this.runOnce();

        console.time(`${this.#label} loop`);
        that.#timerId = setTimeout(async function interval() {
            console.timeEnd(`${that.#label} loop`);
            console.time(`${that.#label} loop`);

            await that.runOnce();

            that.#timerId = setTimeout(interval, that.#refresh);
        }, that.#refresh);

        return that.#timerId;
    }

    async runOnce() {
        console.debug(
            `loop iteration:${this.#iteration}, specified refresh:${(1 / (this.#refresh / 1000)).toFixed(2)} Hz`
        );
        await this.#exec({ i: this.#iteration, refresh: this.#refresh });
        this.#iteration++;
    }

    get i() {
        return this.#iteration;
    }

    get refresh() {
        return this.#refresh;
    }
}

export { HttpClient, FavClient, FormState, Looper };
