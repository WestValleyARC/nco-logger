import { EndPointReponseError, isEndPointResponse, isInteractionPayload, isSigReportInteractionPayload, isNpid, isCommandList, isCommandResponse } from '#@client/types/commonTypesupport.js';
import { createLogger } from '#@client/lib/logger.js';
const logger = createLogger('lib/clientUtils.ts');
export class EndPointClient {
    url;
    options;
    itemId = null;
    params = [];
    payload = null;
    constructor(url, options = {
        redirectOnNotFound: false,
        redirectOnNonJson: false
    }) {
        this.url = url;
        this.options = options;
    }
    formattedParams() {
        return this.params.length ? this.params.reduce((p, c, idx) => `${p}${idx ? '&' : ''}${c[0]}=${c[1]}`, '?') : '';
    }
    reset() {
        this.itemId = null;
        this.params = [];
        this.payload = null;
    }
    handleRedirect(url) {
        if (typeof url === 'string') {
            logger.info(`Redirecting to ${url}`);
            window.location.href = url;
        }
        else if (url === true) {
            logger.info('Redirecting to /');
            window.location.href = '/';
        }
    }
    async processResponse(res) {
        let jsonResponse;
        const contentType = res.headers.get('Content-Type');
        if (contentType && contentType.includes('application/json')) {
            try {
                jsonResponse = (await res.json());
            }
            catch (err) {
                if (err instanceof Error) {
                    throw new Error(`${err.message} (${res.status}:${res.statusText})`);
                }
                else if (typeof err === 'string') {
                    throw new Error(`${err} (${res.status}:${res.statusText})`);
                }
            }
        }
        else {
            if (this.options.redirectOnNonJson) {
                logger.error(`Redirecting to due to non-JSON (${contentType}) response: ${res.status}:${res.statusText}`);
                this.handleRedirect(this.options.redirectOnNonJson);
            }
            else {
                throw new EndPointReponseError(`Expected JSON but received ${contentType}`, res.status);
            }
        }
        if (res.ok) {
            if (isEndPointResponse(jsonResponse)) {
                return jsonResponse;
            }
            else {
                logger.error(`server responded ${res.status}:${res.statusText}, but invalid format (missing endpoint property?)`);
                throw new Error(`server response did not pass validation`);
            }
        }
        else {
            if (res.status === 404) {
                if (this.options.redirectOnNotFound) {
                    logger.info(`Redirecting to due to 404: ${res.status}:${res.statusText}`);
                    this.handleRedirect(this.options.redirectOnNotFound);
                }
                else {
                    logger.error(`Resource not found: ${res.status}:${res.statusText}`);
                    throw new EndPointReponseError('Resource not found', res.status);
                }
            }
            let errorMessage = res.statusText;
            if (isEndPointResponse(jsonResponse) && jsonResponse.errorMessage) {
                errorMessage = jsonResponse.errorMessage;
            }
            throw new EndPointReponseError(errorMessage, res.status);
        }
    }
    async fetchWithMethod(method, data) {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: data instanceof FormData ? JSON.stringify(Object.fromEntries(data.entries())) : JSON.stringify(data)
        };
        if (method === 'GET' || method === 'DELETE') {
            delete options.headers;
            delete options.body;
        }
        logger.debug('fetching', `${this.url}${this.itemId ? `/${this.itemId}` : ''}${this.formattedParams()}`);
        const res = await fetch(`${this.url}${this.itemId ? `/${this.itemId}` : ''}${this.formattedParams()}`, options);
        return this.processResponse(res);
    }
    id(id) {
        if (typeof id === 'string' && id.length) {
            this.itemId = id;
            return this;
        }
        else {
            throw new Error('EndPoint id(): expected param of type string with non-zero length');
        }
    }
    data(d) {
        if (d instanceof FormData || typeof d === 'object') {
            this.payload = d;
        }
        else {
            throw new Error('EndPoint data(): expected param of type object or FormData');
        }
    }
    p(k, v) {
        if (typeof k === 'string' && typeof v === 'string') {
            if (k.length && v.length) {
                this.params.push([k, v]);
                return this;
            }
            else {
                throw new Error('EndPiont p(): expected non-zero length param key/val');
            }
        }
        else {
            throw new Error('EndPoint p(): expected param key/val of type string');
        }
    }
    get index() {
        if (this.itemId) {
            throw new Error('EndPoint index(): expected null id, please use show()');
        }
        return this.fetchWithMethod.bind(this, 'GET');
    }
    get show() {
        return this.fetchWithMethod.bind(this, 'GET');
    }
    get create() {
        return this.fetchWithMethod.bind(this, 'POST', this.payload ?? undefined);
    }
    get update() {
        if (!this.itemId) {
            throw new Error('EndPoint: update(): missing call to id()');
        }
        return this.fetchWithMethod.bind(this, 'PATCH', this.payload ?? undefined);
    }
    get remove() {
        if (!this.itemId) {
            throw new Error('EndPoint: remove(): missing call to id()');
        }
        return this.fetchWithMethod.bind(this, 'DELETE');
    }
}
export class InteractionClient extends EndPointClient {
    constructor(npid) {
        super('/api/station/interactions');
        this.id(npid?.toString() ?? getNpid().toString());
    }
    rawInteraction(ia) {
        if (!isInteractionPayload(ia)) {
            throw new Error('Invalid InteractionPayload');
        }
        this.data(ia);
        return this.create();
    }
    sigReport(callSign, report) {
        const interactionPayload = { action: 'sigReport', actionParams: report, dstStation: callSign };
        if (!isSigReportInteractionPayload(interactionPayload)) {
            throw new Error(`Invalid SigReportInteractionPayload (${JSON.stringify(interactionPayload)}) in ${this.constructor.name}`);
        }
        return this.rawInteraction(interactionPayload);
    }
    simpleInteractionWrapper(action, callSign, actionParams) {
        const interactionPayload = { action, actionParams, dstStation: callSign };
        if (!isInteractionPayload(interactionPayload)) {
            throw new Error('Invalid InteractionPayload');
        }
        return this.rawInteraction(interactionPayload);
    }
    hand(callSign, state) {
        return this.simpleInteractionWrapper('hand', callSign, { state });
    }
    checkState(callSign, state) {
        return this.simpleInteractionWrapper('checkState', callSign, { state });
    }
    highlight(callSign, state) {
        return this.simpleInteractionWrapper('highlight', callSign, { state });
    }
}
export class FavoriteClient extends EndPointClient {
    constructor() {
        super('/api/data/follow');
    }
    set(npid, state) {
        this.id(npid.toString());
        this.data({ follow: state });
        const action = state ? this.create() : this.remove();
        action.catch(error => {
            if (error instanceof EndPointReponseError) {
                logger.warn(error.message || 'Unknown error');
            }
            else {
                logger.warn(error);
            }
        });
    }
}
export class AdminClient extends EndPointClient {
    constructor(npid) {
        super('/api/admin/interactions', { redirectOnNotFound: false, redirectOnNonJson: '/views/dashboard' });
        this.id(npid?.toString() ?? getNpid().toString());
    }
    async exec(cmdLine) {
        this.data({ cmdLine });
        const response = await this.create();
        if (isCommandResponse(response)) {
            return response;
        }
        else {
            throw new Error('Invalid CommandResponse');
        }
    }
    async usageText() {
        const response = await this.show();
        if (isCommandList(response)) {
            return response.commandDetail
                .filter(c => !c.advanced)
                .map(c => `${c.label}: ${c.compactUsage}`)
                .join(', ');
        }
        else {
            throw new Error('Invalid CommandList');
        }
    }
}
export class Looper {
    label;
    compensatoryScheduling;
    interval;
    timeoutId = null;
    loopFunction = null;
    skipNext = false;
    intervalChanged = false;
    runCount = 0;
    lastRunTime = null;
    errorCount = 0;
    expectedNextRunTime = null;
    constructor(interval, label, compensatoryScheduling = false) {
        this.label = label;
        this.compensatoryScheduling = compensatoryScheduling;
        if (interval <= 0) {
            throw new Error(`Looper (${this.label}): Interval must be greater than 0`);
        }
        this.interval = interval;
    }
    start(loopFunction, runImmediately = true) {
        if (typeof loopFunction !== 'function') {
            throw new Error(`Looper (${this.label}): loop function must be a function`);
        }
        if (this.loopFunction !== null) {
            throw new Error(`Looper (${this.label}): loop is already running`);
        }
        this.loopFunction = loopFunction;
        if (runImmediately) {
            this.runLoop();
        }
        else {
            this.scheduleNextRun();
        }
    }
    stop() {
        if (this.loopFunction === null) {
            logger.warn(`Looper (${this.label}): stop() called but loop is not running`);
        }
        else {
            this.cancelNextRun();
            this.loopFunction = null;
        }
    }
    setInterval(interval) {
        if (interval <= 0) {
            throw new Error(`Looper (${this.label}): Interval must be greater than 0`);
        }
        this.interval = interval;
        logger.debug(`Looper (${this.label}): interval changed to ${interval}`);
        this.intervalChanged = true;
        if (this.loopFunction !== null) {
            this.cancelNextRun();
            this.scheduleNextRun();
        }
    }
    skip() {
        this.skipNext = true;
    }
    runLoop() {
        if (this.loopFunction !== null) {
            const stats = {
                interval: this.interval,
                firstRun: this.runCount === 0,
                runCount: this.runCount,
                lastRunTime: this.lastRunTime,
                nextRunTime: Date.now() + this.interval,
                errorCount: this.errorCount
            };
            this.loopFunction(stats)
                .catch(error => {
                this.errorCount++;
                logger.error(`Looper (${this.label}): Error in loop function: ${error}`);
            })
                .finally(() => {
                this.runCount++;
                this.lastRunTime = Date.now();
                if (!this.skipNext && !this.intervalChanged) {
                    this.scheduleNextRun();
                }
                this.skipNext = false;
                this.intervalChanged = false;
            });
        }
    }
    runImmediately() {
        this.cancelNextRun();
        this.runLoop();
        if (!this.skipNext && !this.intervalChanged) {
            this.scheduleNextRun();
        }
        this.skipNext = false;
        this.intervalChanged = false;
    }
    scheduleNextRun() {
        const BUFFER_MULTIPLIER = 2;
        const currentTime = Date.now();
        if (this.compensatoryScheduling) {
            if (this.expectedNextRunTime !== null && currentTime > this.expectedNextRunTime) {
                const delayInSeconds = Math.abs((currentTime - this.expectedNextRunTime) / 1000).toFixed(2);
                logger.warn(`Looper (${this.label}): is behind schedule: ${delayInSeconds}s, running now`);
                this.runLoop();
            }
            else {
                this.scheduleTimeout(this.interval);
            }
            this.expectedNextRunTime = currentTime + this.interval * BUFFER_MULTIPLIER;
        }
        else {
            this.scheduleTimeout(this.interval);
        }
    }
    scheduleTimeout(interval) {
        this.timeoutId = window.setTimeout(() => this.runLoop(), interval);
    }
    cancelNextRun() {
        if (this.timeoutId !== null) {
            window.clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }
}
export const getNpid = () => {
    const hexRegex = /^[0-9a-fA-F]{24}$/;
    const pathParts = window.location.pathname.split('/');
    const NPID = typeof pathParts[3] === 'string' && hexRegex.test(pathParts[3]) ? pathParts[3] : null;
    if (!NPID) {
        throw new Error('Could not find NPID in URL');
    }
    if (!isNpid(NPID)) {
        throw new Error('Malformed NPID');
    }
    return NPID;
};
export const hashString = async (input) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hash = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};
export const generateUUID = () => {
    let timestamp = BigInt(Date.now() * 1000);
    let performanceTime = BigInt(Math.round(performance?.now() ? performance.now() * 1000 : 0));
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        let r = BigInt(Math.floor(Math.random() * 16));
        if (timestamp > 0n) {
            r = (timestamp + r) % 16n;
            timestamp = timestamp / 16n;
        }
        else {
            r = (performanceTime + r) % 16n;
            performanceTime = performanceTime / 16n;
        }
        return (c === 'x' ? r : (r & 0x3n) | 0x8n).toString(16);
    });
};
const iconSvgs = {
    'bi-info-circle': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-info-circle" viewBox="0 0 16 16">
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
            <path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/>
        </svg>
    `,
    'bi-power': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-power" viewBox="0 0 16 16">
            <path d="M7.5 1v7h1V1z"/>
            <path d="M3 8.812a5 5 0 0 1 2.578-4.375l-.485-.874A6 6 0 1 0 11 3.616l-.501.865A5 5 0 1 1 3 8.812"/>
        </svg>
    `,
    'bi-mic-fill': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-mic-fill" viewBox="0 0 16 16">
            <path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z"/>
            <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5"/>
        </svg>
    `,
    'bi-journal-check': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-journal-check" viewBox="0 0 16 16">
            <path fill-rule="evenodd" d="M10.854 6.146a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 1 1 .708-.708L7.5 8.793l2.646-2.647a.5.5 0 0 1 .708 0"/>
            <path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-1h1v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v1H1V2a2 2 0 0 1 2-2"/>
            <path d="M1 5v-.5a.5.5 0 0 1 1 0V5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0V8h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0v.5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1z"/>
        </svg>
    `,
    'bi-person-check': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-person-check" viewBox="0 0 16 16">
            <path d="M12.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m1.679-4.493-1.335 2.226a.75.75 0 0 1-1.174.144l-.774-.773a.5.5 0 0 1 .708-.708l.547.548 1.17-1.951a.5.5 0 1 1 .858.514M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M8 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4"/>
            <path d="M8.256 14a4.5 4.5 0 0 1-.229-1.004H3c.001-.246.154-.986.832-1.664C4.484 10.68 5.711 10 8 10q.39 0 .74.025c.226-.341.496-.65.804-.918Q8.844 9.002 8 9c-5 0-6 3-6 4s1 1 1 1z"/>
        </svg>
    `,
    'bi-intersect': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-intersect" viewBox="0 0 16 16">
            <path d="M0 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2H2a2 2 0 0 1-2-2zm5 10v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2v5a2 2 0 0 1-2 2zm6-8V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2V6a2 2 0 0 1 2-2z"/>
        </svg>
    `,
    'bi-eye-fill': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eye-fill" viewBox="0 0 16 16">
            <path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0"/>
            <path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8m8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7"/>
        </svg>
    `,
    'bi-x-circle-fill': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-circle-fill" viewBox="0 0 16 16">
            <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z"/>
        </svg>
    `,
    'bi-dash-circle': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-dash-circle" viewBox="0 0 16 16">
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
            <path d="M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8"/>
        </svg>
    `,
    'bi-plus-circle': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-plus-circle" viewBox="0 0 16 16">
            <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
            <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/>
        </svg>
    `,
    'bi-star': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star" viewBox="0 0 16 16">
            <path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.56.56 0 0 0-.163-.505L1.71 6.745l4.052-.576a.53.53 0 0 0 .393-.288L8 2.223l1.847 3.658a.53.53 0 0 0 .393.288l4.052.575-2.906 2.77a.56.56 0 0 0-.163.506l.694 3.957-3.686-1.894a.5.5 0 0 0-.461 0z"/>
        </svg>
    `,
    'bi-star-fill': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-star-fill" viewBox="0 0 16 16">
            <path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/>
        </svg>
    `,
    'bi-heart': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-heart" viewBox="0 0 16 16">
            <path d="m8 2.748-.717-.737C5.6.281 2.514.878 1.4 3.053c-1.247 2.487-.258 5.348 1.633 7.574L8 15l4.966-4.373c1.891-2.226 2.88-5.087 1.633-7.574C13.486.878 10.4.28 8.717 2.01zm0 10.905-4.53-3.99C1.69 7.565.811 5.09 1.99 3.084c.93-1.58 3.065-2.12 4.517-.82L8 3.634l1.493-1.37c1.452-1.3 3.587-.76 4.517.82 1.179 2.006.3 4.481-1.48 6.579z"/>
        </svg>
    `,
    'bi-heart-fill': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-heart-fill" viewBox="0 0 16 16">
            <path fill-rule="evenodd" d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314"/>
        </svg>
    `,
    'bi-chevron-contract': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-contract" viewBox="0 0 16 16">
            <path fill-rule="evenodd" d="M3.646 13.854a.5.5 0 0 0 .708 0L8 10.207l3.646 3.647a.5.5 0 0 0 .708-.708l-4-4a.5.5 0 0 0-.708 0l-4 4a.5.5 0 0 0 0 .708m0-11.708a.5.5 0 0 1 .708 0L8 5.793l3.646-3.647a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 0-.708"/>
        </svg>
    `,
    'bi-chevron-double-down': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-chevron-double-down" viewBox="0 0 16 16">
            <path fill-rule="evenodd" d="M1.646 6.646a.5.5 0 0 1 .708 0L8 12.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708"/>
            <path fill-rule="evenodd" d="M1.646 2.646a.5.5 0 0 1 .708 0L8 8.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708"/>
        </svg>
    `,
    'bi-three-dots': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-three-dots" viewBox="0 0 16 16">
            <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3"/>
        </svg>
    `,
    'bi-file-earmark-arrow-up': `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-file-earmark-arrow-up" viewBox="0 0 16 16">
            <path d="M8.5 11.5a.5.5 0 0 1-1 0V7.707L6.354 8.854a.5.5 0 1 1-.708-.708l2-2a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 7.707z"/>
            <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2M9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5z"/>
        </svg>`
};
export const getIconSvg = (iconName) => {
    if (!(iconName in iconSvgs)) {
        console.warn(`Warning: Icon "${iconName}" does not exist.`);
        return '';
    }
    return iconSvgs[iconName];
};
export const makeNonBreaking = (htmlString) => {
    logger.warn('makeNonBreaking() is deprecated. Use CSS white-space: nowrap instead.');
    return htmlString.replace(/ /g, '\u00A0');
};
export class UserAgentPersistentPreferences {
    static STORAGE_KEY = 'userPreferences';
    preferences;
    constructor() {
        const storedPreferences = localStorage.getItem(UserAgentPersistentPreferences.STORAGE_KEY);
        this.preferences = storedPreferences
            ? JSON.parse(storedPreferences)
            : {
                usageCollapsed: false,
                autoScrollStationTable: false,
                chatCommandTipDismissed: false
            };
        logger.debug('Loaded preferences:', this.preferences);
    }
    savePreferences() {
        localStorage.setItem(UserAgentPersistentPreferences.STORAGE_KEY, JSON.stringify(this.preferences));
        logger.debug('Saved preferences:', this.preferences);
    }
    getPreference(key) {
        const value = this.preferences[key] ?? false;
        logger.debug(`Retrieved preference - ${key}:`, value);
        return value;
    }
    setPreference(key, value) {
        logger.debug(`Setting preference - ${key}:`, value);
        this.preferences[key] = value;
        this.savePreferences();
    }
    get usageCollapsed() {
        return this.getPreference('usageCollapsed');
    }
    set usageCollapsed(value) {
        this.setPreference('usageCollapsed', value);
    }
    get autoScrollStationTable() {
        return this.getPreference('autoScrollStationTable');
    }
    set autoScrollStationTable(value) {
        this.setPreference('autoScrollStationTable', value);
    }
    get chatCommandTipDismissed() {
        return this.getPreference('chatCommandTipDismissed');
    }
    set chatCommandTipDismissed(value) {
        this.setPreference('chatCommandTipDismissed', value);
    }
}
export const deepEqual = (a, b) => {
    if (a === b) {
        return true;
    }
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
        return false;
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) {
        return false;
    }
    for (const key of keysA) {
        if (!keysB.includes(key) ||
            !deepEqual(a[key], b[key])) {
            return false;
        }
    }
    return true;
};
export const createProxy = (map, keySanitizer, label) => {
    if (!map)
        return new Map();
    logger.debug(`Proxy created to ReadonlyMap: ${label}`);
    return new Proxy(map, {
        get: (target, prop, receiver) => {
            logger.debug(`readonly map proxy [${label}]: get() called with prop: ${String(prop)}`);
            if (!['get', 'has', 'entries', 'keys', 'values', 'size', 'forEach'].includes(prop.toString())) {
                throw new Error(`Property '${String(prop)}' is not a valid method or property of ReadonlyMap.`);
            }
            if (prop === 'get') {
                return (key) => {
                    const sanitizedKey = keySanitizer(key);
                    return target.get(sanitizedKey);
                };
            }
            if (prop === 'forEach') {
                return (callback) => {
                    for (const [key, value] of target.entries()) {
                        callback(value, key, target);
                    }
                };
            }
            const value = Reflect.get(target, prop, receiver);
            if (typeof value === 'function') {
                return value.bind(target);
            }
            return value;
        }
    });
};
export const deepClone = (obj) => {
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }
    try {
        return structuredClone(obj);
    }
    catch (error) {
        if (error instanceof Error) {
            logger.error(`structuredClone failed: ${error.message}`);
        }
        else {
            logger.error(`structuredClone failed: ${String(error)}`);
        }
        try {
            return JSON.parse(JSON.stringify(obj));
        }
        catch (jsonError) {
            if (jsonError instanceof Error) {
                logger.error(`JSON-based deep clone failed: ${jsonError.message}`);
            }
            else {
                logger.error(`JSON-based deep clone failed: ${String(jsonError)}`);
            }
            throw new Error('Deep clone failed using both structuredClone and JSON methods.');
        }
    }
};
export const initAndLogError = async (initFunction) => {
    try {
        const result = initFunction();
        if (result instanceof Promise) {
            await result;
        }
    }
    catch (error) {
        logger.error(String(error));
    }
};
export var SchedulingMethod;
(function (SchedulingMethod) {
    SchedulingMethod[SchedulingMethod["NextEventLoop"] = 0] = "NextEventLoop";
    SchedulingMethod[SchedulingMethod["Microtask"] = 1] = "Microtask";
    SchedulingMethod[SchedulingMethod["NextAnimationFrame"] = 2] = "NextAnimationFrame";
})(SchedulingMethod || (SchedulingMethod = {}));
export const schedule = (callback, method) => {
    switch (method) {
        case SchedulingMethod.NextEventLoop:
            setTimeout(callback, 0);
            break;
        case SchedulingMethod.Microtask:
            void Promise.resolve().then(callback);
            break;
        case SchedulingMethod.NextAnimationFrame:
            requestAnimationFrame(callback);
            break;
        default:
            throw new Error('Invalid scheduling method');
    }
};
export const getFileParts = (filename) => {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1 || lastDotIndex === 0) {
        return {
            baseName: filename,
            extension: ''
        };
    }
    const baseName = filename.slice(0, lastDotIndex);
    const extension = filename.slice(lastDotIndex + 1).toLowerCase();
    return {
        baseName,
        extension
    };
};
export const slugifyFilename = (filename) => {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1 || lastDotIndex === 0) {
        return filename
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '_')
            .replace(/[^\w\-]/g, '');
    }
    const name = filename.slice(0, lastDotIndex);
    const extension = filename.slice(lastDotIndex).toLowerCase();
    const slugifiedName = name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^\w\-]/g, '')
        .replace(/_+/g, '_');
    return `${slugifiedName}${extension}`;
};
//# sourceMappingURL=clientUtils.js.map