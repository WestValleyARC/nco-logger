import { Looper, deepEqual, deepClone, createProxy } from '#@client/lib/clientUtils.js';
import { isLiveNetDetailsResponse, isLiveNetPresenceResponse, isFollowListResponse, isNpid } from '#@client/types/commonTypesupport.js';
import { serverInfo } from '#@client/lib/serverInfo.js';
import { createLogger } from '#@client/lib/logger.js';
import { produce } from 'immer';
const logger = createLogger('lib/stores.ts');
class InFlightWindowManager {
    rttLooper;
    mainLooper;
    checkRTT;
    isCheckScheduled = false;
    changesInFlightUntilTimestamp = null;
    inFlightRttMs = 2000;
    serverDataHashBeforeInFlight = null;
    constructor(rttLooper, mainLooper, checkRTT) {
        this.rttLooper = rttLooper;
        this.mainLooper = mainLooper;
        this.checkRTT = checkRTT;
    }
    startRttCheck() {
        const RTT_FLOOR = 1000;
        const RTT_CEILING = 1500;
        const BUFFER = 500;
        const measurements = [];
        this.validateConstants(RTT_FLOOR, RTT_CEILING, BUFFER);
        this.rttLooper.start(async (loopStats) => {
            let measuredRtt = await this.checkRTT();
            measuredRtt = this.adjustAndLogRtt(measuredRtt, RTT_FLOOR, RTT_CEILING);
            const totalRtt = measuredRtt + BUFFER;
            this.updateMeasurements(measurements, totalRtt);
            this.inFlightRttMs = Math.max(RTT_FLOOR, Math.min(RTT_CEILING, Math.max(...measurements)));
            if (loopStats.runCount % 3 === 0) {
                this.logInFlightWait(measuredRtt, BUFFER, RTT_FLOOR, RTT_CEILING);
            }
        }, true);
    }
    validateConstants(RTT_FLOOR, RTT_CEILING, BUFFER) {
        if (RTT_FLOOR >= RTT_CEILING) {
            throw new Error('RTT_FLOOR must be less than RTT_CEILING');
        }
        if (BUFFER > RTT_CEILING) {
            throw new Error('BUFFER must be less than RTT_CEILING');
        }
    }
    adjustAndLogRtt(measuredRtt, RTT_FLOOR, RTT_CEILING) {
        if (measuredRtt < RTT_FLOOR) {
            return RTT_FLOOR;
        }
        else if (measuredRtt > RTT_CEILING) {
            logger.debug(`Measured RTT of ${(measuredRtt / 1000).toFixed(2)} seconds is greater than ceiling, setting to ceiling.`);
            return RTT_CEILING;
        }
        return measuredRtt;
    }
    updateMeasurements(measurements, totalRtt) {
        measurements.push(totalRtt);
        if (measurements.length > 3) {
            measurements.shift();
        }
    }
    logInFlightWait(measuredRtt, BUFFER, RTT_FLOOR, RTT_CEILING) {
        const measuredRttSeconds = (measuredRtt / 1000).toFixed(2);
        const bufferSeconds = (BUFFER / 1000).toFixed(2);
        const totalRttSeconds = (this.inFlightRttMs / 1000).toFixed(2);
        let logMessage = `Calculated In-flight Window: ${totalRttSeconds}s (Measured RTT: ${measuredRttSeconds}s, Buffer: ${bufferSeconds}s)`;
        if (this.inFlightRttMs === RTT_FLOOR + BUFFER) {
            logMessage += ' (at floor)';
        }
        else if (this.inFlightRttMs === RTT_CEILING + BUFFER) {
            logMessage += ' (at ceiling)';
        }
        logger.debug(logMessage);
    }
    isInFlightWindow() {
        return this.changesInFlightUntilTimestamp !== null && performance.now() < this.changesInFlightUntilTimestamp;
    }
    scheduleInFlightWindowCheck(lastHash) {
        if (this.isCheckScheduled) {
            return;
        }
        if (this.isInFlightWindow()) {
            const remainingMs = this.changesInFlightUntilTimestamp
                ? this.changesInFlightUntilTimestamp - performance.now()
                : 0;
            this.isCheckScheduled = true;
            setTimeout(() => {
                this.isCheckScheduled = false;
                this.scheduleInFlightWindowCheck(lastHash);
            }, remainingMs);
        }
        else {
            if (this.serverDataHashBeforeInFlight !== lastHash) {
                logger.warn('Server data has changed during the in-flight window. Now that window has expired, running the main loop immediately.');
                this.mainLooper.runImmediately();
            }
        }
    }
    updateInFlightWindow(lastHash) {
        this.changesInFlightUntilTimestamp = performance.now() + this.inFlightRttMs;
        const remainingSeconds = this.changesInFlightUntilTimestamp
            ? ((this.changesInFlightUntilTimestamp - performance.now()) / 1000).toFixed(2)
            : 'No changes in flight';
        logger.info(`Client --> Service data in flight for the next: ${remainingSeconds} seconds`);
        this.serverDataHashBeforeInFlight = lastHash;
        this.scheduleInFlightWindowCheck(lastHash);
    }
}
export class ReactiveStore {
    endPoint;
    enableSse;
    isInitStoreRunning = false;
    eventSource = null;
    serverDataCache = null;
    subscriberMap = new Map();
    mainLooper;
    rttLooper;
    lastHash = null;
    version = 0;
    _mainCache = null;
    inFlightWindowManager;
    endPointError = false;
    constructor(endPoint, compensatoryScheduling = false, enableSse = true) {
        this.endPoint = endPoint;
        this.enableSse = enableSse;
        this.rttLooper = new Looper(60000, 'RTT Measurements', false);
        this.mainLooper = new Looper(5000, this.constructor.name, compensatoryScheduling);
        this.inFlightWindowManager = new InFlightWindowManager(this.rttLooper, this.mainLooper, this.checkRTT.bind(this));
    }
    handleNewData(data) {
        if (!this.isValidStoreData(data)) {
            throw new Error('Invalid data format');
        }
        if (data.hash === this.lastHash) {
            return;
        }
        else {
            logger.info(`${this.constructor.name}: current hash: ${data.hash} ≠ prior hash: ${this.lastHash}`);
        }
        this.lastHash = data.hash;
        this.serverDataCache = data;
        if (!this.inFlightWindowManager.isInFlightWindow()) {
            this.mainCache = this.serverDataCache;
        }
        if (this.enableSse && data.ssePath && !this.eventSource) {
            this.eventSource = new EventSource(data.ssePath);
            this.mainLooper.stop();
            this.eventSource.addEventListener('net-close', event => {
                logger.info('Received net-close event:', event.data);
                this.eventSource?.close();
                window.location.href = '/';
            });
            this.eventSource.onopen = () => {
                logger.info('SSE Connection to server opened.');
                this.notifySubscribers('ONLINE').catch(err => logger.error(String(err)));
            };
            this.eventSource.onerror = error => {
                logger.error('EventSource failed:', error);
                this.notifySubscribers('OFFLINE').catch(err => logger.error(String(err)));
            };
            this.eventSource.onmessage = event => {
                if (typeof event.data !== 'string') {
                    throw new Error('Event data is not a string');
                }
                logger.info('Received Server-Sent Event');
                const sseData = JSON.parse(event.data);
                this.handleNewData(sseData);
            };
        }
    }
    async init() {
        if (this.isInitStoreRunning) {
            logger.info('initStore is already running');
            return;
        }
        this.isInitStoreRunning = true;
        this.inFlightWindowManager.startRttCheck();
        this.mainLooper.start(async (stats) => {
            try {
                const response = await this.endPoint.show();
                this.handleNewData(response);
                if (this.endPointError) {
                    this.endPointError = false;
                    this.notifySubscribers('ONLINE').catch(err => logger.error(String(err)));
                }
                if (response.ttlMs !== stats.interval) {
                    logger.info(`Service endpoint ttlMs is ${response.ttlMs}, telling looper to adjust interval`);
                    this.mainLooper.setInterval(response.ttlMs);
                }
            }
            catch (error) {
                this.endPointError = true;
                this.notifySubscribers('OFFLINE').catch(err => logger.error(String(err)));
                logger.error(String(error));
            }
        }, true);
        this.isInitStoreRunning = false;
    }
    delayServerDataIngest() {
        if (this.lastHash) {
            this.inFlightWindowManager.updateInFlightWindow(this.lastHash);
        }
    }
    async notifySubscribers(mesg) {
        if (this.subscriberMap.size) {
            logger.info(`${mesg} message from ${this.constructor.name} to ${this.subscriberMap.size} subscribers`);
            for (const subscriber of this.subscriberMap.values()) {
                switch (mesg) {
                    case 'NEWDATA':
                        await subscriber.newData();
                        break;
                    case 'ONLINE':
                        subscriber.online = true;
                        break;
                    case 'OFFLINE':
                        subscriber.online = false;
                        break;
                }
            }
        }
        else {
            logger.info(`No current subscribers to ${this.constructor.name}`);
        }
    }
    async mainCacheChanged() {
        try {
            await this.newData();
            await this.notifySubscribers('NEWDATA');
        }
        catch (err) {
            logger.error(String(err));
        }
    }
    async checkRTT() {
        const start = performance.now();
        await fetch('/', { method: 'HEAD' });
        const end = performance.now();
        return end - start;
    }
    subscribe(subscriber) {
        this.subscriberMap.set(subscriber.uuid, subscriber);
        logger.debug(`${this.constructor.name} has a new subscriber`);
    }
    unsubscribe(subscriber) {
        logger.debug(`widget ${subscriber.uuid} unsubscribed from ${this.constructor.name}`);
        this.subscriberMap.delete(subscriber.uuid);
    }
    set mainCache(value) {
        try {
            if (this.isValidStoreData(value)) {
                this._mainCache = value;
                this.version++;
                logger.info(`${this.constructor.name}: updated to version ${this.version}`);
                this.mainCacheChanged().catch(err => logger.error(String(err)));
            }
            else {
                throw new Error('Invalid data provided to mainCache');
            }
        }
        catch (error) {
            logger.error(String(error));
        }
    }
    _readonlyCacheCopy = null;
    _cachedVersion = -1;
    updateReadonlyCacheCopy() {
        this._readonlyCacheCopy = Object.freeze(deepClone(this._mainCache));
        this._cachedVersion = this.version;
        logger.info(`${this.constructor.name} received a request for mainCache, returning [UPDATED] v${this.version} ${this._readonlyCacheCopy === null ? '(null store data)' : ''}`);
    }
    get mainCache() {
        if (this.version !== this._cachedVersion) {
            this.updateReadonlyCacheCopy();
        }
        return this._readonlyCacheCopy;
    }
    get ready() {
        return this._mainCache !== null;
    }
    cachePropertyHasChanged(property, priorObject) {
        if (!this._mainCache) {
            logger.warn('mainCache not *yet initialized in cachePropertyHasChanged(), returning true');
            return true;
        }
        return !deepEqual(this._mainCache[property], priorObject);
    }
}
export class StateGroup extends Set {
    newData = false;
    add(callSign) {
        this.newData = true;
        return super.add(callSign.toUpperCase());
    }
    delete(callSign) {
        const result = super.delete(callSign.toUpperCase());
        if (result) {
            this.newData = true;
        }
        return result;
    }
}
const stateGroupKeysArr = [
    'hand-up',
    'checked-in-ever',
    'loggers',
    'relays',
    'attendees',
    'checked-out',
    'netcontrols'
];
export function isStateGroupKey(value) {
    return stateGroupKeysArr.includes(value);
}
class StateGroupCollection {
    stateGroups = {
        'hand-up': new StateGroup(),
        'checked-in-ever': new StateGroup(),
        'checked-out': new StateGroup(),
        netcontrols: new StateGroup(),
        loggers: new StateGroup(),
        relays: new StateGroup(),
        attendees: new StateGroup()
    };
    get newData() {
        return Object.values(this.stateGroups).some(group => group.newData);
    }
    set newData(value) {
        Object.values(this.stateGroups).forEach(group => (group.newData = value));
    }
    getGroup(groupName) {
        return this.stateGroups[groupName];
    }
    addToGroup(groupName, callSign) {
        const group = this.getGroup(groupName);
        if (group) {
            group.add(callSign);
        }
        else {
            logger.error(`Group ${groupName} does not exist.`);
        }
    }
    deleteFromGroup(groupName, callSign) {
        const group = this.getGroup(groupName);
        if (group) {
            return group.delete(callSign);
        }
        else {
            logger.error(`Group ${groupName} does not exist.`);
            return false;
        }
    }
    isInGroup(groupName, callSign) {
        const group = this.getGroup(groupName);
        if (group) {
            return group.has(callSign);
        }
        else {
            logger.error(`Group ${groupName} does not exist.`);
            return false;
        }
    }
    report() {
        return Object.entries(this.stateGroups)
            .map(([groupName, group]) => `Group Name: ${groupName}, New Data: ${group.newData}, Contents: [${[...group].join(', ')}]`)
            .join('\n');
    }
}
class StationIndexer {
    keySanitizer = (key) => key.toUpperCase();
    _stationIndex = null;
    _priorStationIndex = null;
    _changedPropertiesMap = null;
    clientCallSign = null;
    store = null;
    firstRun = true;
    stateGroupCollection = new StateGroupCollection();
    generateIndexes() {
        if (!this.store?.mainCache) {
            throw new Error('store mainCache is required in StationIndexer generateIndexes()');
        }
        this._priorStationIndex = this._stationIndex ? new Map(this._stationIndex) : null;
        this.firstRun = this._priorStationIndex === null;
        const { stations } = this.store.mainCache;
        logger.info(`Indexing ${stations.length} stations...`);
        this._stationIndex = new Map(stations.map(station => [station.callSign, station]));
    }
    processPerStationDiffs(hooks) {
        const changedPropertiesMap = new Map();
        this._stationIndex?.forEach((currentStation, callSign) => {
            const priorStation = this._priorStationIndex?.get(callSign);
            let currentStationChangedProperties = [];
            if (priorStation) {
                currentStationChangedProperties = StationIndexer.propertiesOfInterest.filter(property => currentStation[property] !== priorStation[property]);
            }
            else {
                currentStationChangedProperties = StationIndexer.propertiesOfInterest;
            }
            if (currentStationChangedProperties.length > 0) {
                logger.info(`${callSign} has changed properties: ${currentStationChangedProperties.join(', ')}`);
                changedPropertiesMap.set(callSign, currentStationChangedProperties);
            }
            hooks.forEach(hook => hook(currentStation, currentStationChangedProperties, priorStation));
        });
        this._changedPropertiesMap = changedPropertiesMap;
    }
    processAggregateDiffs() {
        if (this._stationIndex) {
            this.stateGroupCollection.stateGroups.attendees = new StateGroup(this._stationIndex.keys());
            if (this.firstRun) {
                this.stateGroupCollection.stateGroups.attendees.newData = true;
            }
            if (this._priorStationIndex) {
                const priorCallSigns = Array.from(this._priorStationIndex.keys());
                const currentCallSigns = Array.from(this._stationIndex.keys());
                const addedCallSigns = currentCallSigns.filter(callSign => !priorCallSigns.includes(callSign));
                const removedCallSigns = priorCallSigns.filter(callSign => !currentCallSigns.includes(callSign));
                let orderChanged = false;
                if (priorCallSigns.length === currentCallSigns.length) {
                    for (let i = 0; i < priorCallSigns.length; i++) {
                        if (priorCallSigns[i] !== currentCallSigns[i]) {
                            orderChanged = true;
                            break;
                        }
                    }
                }
                else {
                    orderChanged = true;
                }
                if (orderChanged)
                    logger.debug('Order of call signs has changed');
                if (addedCallSigns.length || removedCallSigns.length || orderChanged) {
                    this.stateGroupCollection.stateGroups.attendees.newData = true;
                }
                removedCallSigns.forEach(callSign => {
                    if (this._priorStationIndex?.get(callSign)?.checkedState) {
                        this.stateGroupCollection.deleteFromGroup('checked-in-ever', callSign);
                        this.stateGroupCollection.stateGroups['checked-in-ever'].newData = true;
                    }
                });
            }
        }
    }
    process(store, client) {
        this.store = store;
        if (!this.clientCallSign) {
            if (serverInfo.callSign) {
                this.clientCallSign = serverInfo.callSign.toUpperCase();
                logger.debug(`Received my callSign from DOM (${this.clientCallSign})`);
            }
            else {
                client
                    .then(client => {
                    this.clientCallSign = client.callSign.toUpperCase();
                    logger.debug(`Received my callSign from Presence (${this.clientCallSign})`);
                })
                    .catch(err => {
                    logger.error(`Failed to get client callSign: ${err}`);
                });
            }
        }
        if (!this.store) {
            throw new Error('store is required in StationIndexer process()');
        }
        if (!this.clientCallSign) {
            throw new Error('clientCallSign is required in StationIndexer process()');
        }
        if (!this.store.mainCache?.stations.length) {
            throw new Error('mainCache should have at least one station in StationIndexer process()');
        }
        this.generateIndexes();
        if (this.firstRun) {
            this.stateGroupCollection.newData = true;
        }
        else {
            this.stateGroupCollection.newData = false;
        }
        this.processPerStationDiffs([
            (currentStation, currentStationChangedProperties) => {
                if (currentStationChangedProperties.includes('hand')) {
                    if (currentStation.hand) {
                        this.stateGroupCollection.addToGroup('hand-up', currentStation.callSign);
                    }
                    else {
                        this.stateGroupCollection.deleteFromGroup('hand-up', currentStation.callSign);
                    }
                }
            },
            (currentStation, currentStationChangedProperties, priorStation) => {
                if (currentStationChangedProperties.includes('checkedState') || !priorStation) {
                    if (typeof currentStation.checkedState === 'boolean') {
                        this.stateGroupCollection.addToGroup('checked-in-ever', currentStation.callSign);
                    }
                    else {
                        this.stateGroupCollection.deleteFromGroup('checked-in-ever', currentStation.callSign);
                    }
                    if (typeof currentStation.checkedState !== typeof priorStation?.checkedState) {
                        this.stateGroupCollection.stateGroups['checked-in-ever'].newData = true;
                    }
                }
            },
            (currentStation, currentStationChangedProperties) => {
                if (currentStationChangedProperties.includes('checkedState')) {
                    if (currentStation.checkedState === false) {
                        this.stateGroupCollection.addToGroup('checked-out', currentStation.callSign);
                    }
                    else {
                        this.stateGroupCollection.deleteFromGroup('checked-out', currentStation.callSign);
                    }
                    this.stateGroupCollection.stateGroups['checked-out'].newData = true;
                }
            },
            (currentStation, currentStationChangedProperties, priorStation) => {
                if (currentStationChangedProperties.includes('role')) {
                    switch (currentStation.role) {
                        case 'netlogger':
                            this.stateGroupCollection.addToGroup('loggers', currentStation.callSign);
                            if (priorStation?.role === 'netrelay') {
                                this.stateGroupCollection.deleteFromGroup('relays', currentStation.callSign);
                            }
                            if (priorStation?.role === 'netcontrol') {
                                this.stateGroupCollection.deleteFromGroup('netcontrols', currentStation.callSign);
                            }
                            break;
                        case 'netrelay':
                            this.stateGroupCollection.addToGroup('relays', currentStation.callSign);
                            if (priorStation?.role === 'netlogger') {
                                this.stateGroupCollection.deleteFromGroup('loggers', currentStation.callSign);
                            }
                            if (priorStation?.role === 'netcontrol') {
                                this.stateGroupCollection.deleteFromGroup('netcontrols', currentStation.callSign);
                            }
                            break;
                        case 'netcontrol':
                            this.stateGroupCollection.addToGroup('netcontrols', currentStation.callSign);
                            if (priorStation?.role === 'netlogger') {
                                this.stateGroupCollection.deleteFromGroup('loggers', currentStation.callSign);
                            }
                            if (priorStation?.role === 'netrelay') {
                                this.stateGroupCollection.deleteFromGroup('relays', currentStation.callSign);
                            }
                            break;
                        case 'netuser':
                            if (priorStation?.role === 'netlogger') {
                                this.stateGroupCollection.deleteFromGroup('loggers', currentStation.callSign);
                            }
                            if (priorStation?.role === 'netrelay') {
                                this.stateGroupCollection.deleteFromGroup('relays', currentStation.callSign);
                            }
                            if (priorStation?.role === 'netcontrol') {
                                this.stateGroupCollection.deleteFromGroup('netcontrols', currentStation.callSign);
                            }
                            break;
                    }
                }
            }
        ]);
        this.processAggregateDiffs();
        logger.info(this.stateGroupCollection.report());
    }
    getGroup(groupName) {
        return this.stateGroupCollection.getGroup(groupName);
    }
    isInGroup(groupName, callSign) {
        return this.stateGroupCollection.isInGroup(groupName, callSign);
    }
    extractStationData(index, extractor) {
        return index ? extractor(index) : null;
    }
    get(callSign) {
        if (!this._stationIndex) {
            throw new Error('in StationIndexer, get(): stationIndex not found');
        }
        return this.extractStationData(this._stationIndex, index => index.get(callSign.toUpperCase()) || null);
    }
    getPrior(callSign) {
        if (!this._priorStationIndex) {
            logger.info('in StationIndexer, getPrior(): priorStationIndex not found. First run?');
            return null;
        }
        return this.extractStationData(this._priorStationIndex, index => index.get(callSign.toUpperCase()) || null);
    }
    static asPropertiesOfInterest(properties) {
        return properties;
    }
    static propertiesOfInterest = StationIndexer.asPropertiesOfInterest([
        'displayName',
        'location',
        'checkedState',
        'hand',
        'role',
        'highlight',
        'presence',
        'level',
        'callSign',
        'photo',
        'averageSigReport',
        'chatEnabled'
    ]);
    static getPropertiesOfInterest() {
        return StationIndexer.propertiesOfInterest;
    }
    havePropertiesChanged(properties, callSign) {
        const effectiveCallSign = (callSign || this.clientCallSign) ?? '';
        return properties.some(property => this._changedPropertiesMap?.get(effectiveCallSign)?.includes(property) ?? false);
    }
    haveMyStationPropertiesChanged(properties) {
        if (!this.clientCallSign) {
            throw new Error('clientCallSign is required in StationIndexer: haveMyStationPropertiesChanged()');
        }
        return this.havePropertiesChanged(properties, this.clientCallSign);
    }
    changedProperties(callSign) {
        const effectiveCallSign = (callSign || this.clientCallSign) ?? '';
        return this._changedPropertiesMap?.get(effectiveCallSign) ?? null;
    }
    myChangedProperties() {
        if (!this.clientCallSign) {
            throw new Error('clientCallSign is required in StationIndexer: myChangedProperties()');
        }
        return this.changedProperties(this.clientCallSign);
    }
    get list() {
        return this.store?.mainCache?.stations ?? [];
    }
    get priorList() {
        return this.extractStationData(this._priorStationIndex, index => Array.from(index.values())) ?? [];
    }
    get map() {
        return createProxy(this._stationIndex, this.keySanitizer, 'StationIndexer._stationIndex');
    }
    get priorMap() {
        return createProxy(this._priorStationIndex, this.keySanitizer, 'StationIndexer._priorStationIndex');
    }
    get changedPropsMap() {
        return createProxy(this._changedPropertiesMap, this.keySanitizer, 'StationIndexer._changedPropertiesMap');
    }
    get iAmAdmin() {
        if (!this.mine) {
            logger.warn('Client callSign not *yet known in StationIndexer: iAmAdmin() returning false');
            return false;
        }
        return this.mine.level < 2;
    }
    get iAmCheckedIn() {
        if (!this.mine) {
            logger.warn('Client callSign not *yet known in StationIndexer: iAmCheckedIn() returning false');
            return false;
        }
        return this.mine.checkedState === true;
    }
    get mine() {
        if (!this.clientCallSign) {
            logger.warn('Client callSign not *yet known in StationIndexer: mine(). Waiting on initial response from /presence?');
            return null;
        }
        return this.get(this.clientCallSign);
    }
    get minePrior() {
        if (!this.clientCallSign) {
            logger.warn('Client callSign not *yet known in StationIndexer: minePrior(). Waiting on initial response from /presence?');
            return null;
        }
        return this.getPrior(this.clientCallSign);
    }
}
export class LiveNetReactiveStore extends ReactiveStore {
    client = null;
    stations = new StationIndexer();
    async init(client) {
        if (!client) {
            throw new Error('client is required in LiveNetReactiveStore init()');
        }
        this.client = client;
        return super.init();
    }
    isValidStoreData(obj) {
        return isLiveNetDetailsResponse(obj);
    }
    async newData() {
        logger.info('New data received, processing in LiveNetReactiveStore');
        if (!this.client) {
            throw new Error('client is required in LiveNetReactiveStore newData()');
        }
        this.stations.process(this, this.client);
    }
    simpleInteractionWrapper(action, callSign, state) {
        const station = this.stations.get(callSign);
        if (!station) {
            throw new Error(`in LiveNetReactiveStore, ${action}: ${callSign} not found`);
        }
        if (action === 'highlight' && typeof state !== 'undefined' && station.checkedState === false) {
            throw new Error(`in LiveNetReactiveStore, ${action}: ${station.callSign} is checked out`);
        }
        const stateProperty = action === 'checkState' ? 'checkedState' : action;
        let targetState;
        if (state === null) {
            targetState = !station[stateProperty];
        }
        else if (typeof state === 'boolean') {
            targetState = state;
        }
        else {
            return station[stateProperty];
        }
        if (!this.mainCache) {
            throw new Error(`in LiveNetReactiveStore, ${action}: mainCache is not defined`);
        }
        if (action !== 'checkState') {
            this.delayServerDataIngest();
        }
        const nextMainCache = produce(this.mainCache, draftMainCache => {
            const draftStation = draftMainCache.stations.find(station => station.callSign.toUpperCase() === callSign.toUpperCase());
            if (draftStation) {
                draftStation[stateProperty] = targetState;
            }
        });
        if (!nextMainCache) {
            throw new Error(`${action}: produce function call failed`);
        }
        this.mainCache = nextMainCache;
        return targetState;
    }
    hand(callSign, state) {
        return this.simpleInteractionWrapper('hand', callSign, state) ?? false;
    }
    highlight(callSign, state) {
        return this.simpleInteractionWrapper('highlight', callSign, state) ?? false;
    }
    checkState(callSign, state) {
        return this.simpleInteractionWrapper('checkState', callSign, state);
    }
}
export class LiveNetPresenceReactiveStore extends ReactiveStore {
    endPoint;
    constructor(endPoint) {
        super(endPoint, true, false);
        this.endPoint = endPoint;
    }
    isValidStoreData(obj) {
        return isLiveNetPresenceResponse(obj);
    }
    async newData() {
        logger.info('New data received, processing in LiveNetPresenceReactiveStore');
    }
}
export class FavoritesReactiveStore extends ReactiveStore {
    _favIndex = null;
    _priorFavIndex = null;
    _priorList = null;
    _list = null;
    keySanitizer = (key) => {
        if (!isNpid(key)) {
            throw new Error('in FavoritesReactiveStore, keySanitizer: key did not pass validation');
        }
        return key;
    };
    isValidStoreData(obj) {
        return isFollowListResponse(obj);
    }
    get list() {
        return this._list;
    }
    get priorList() {
        return this._priorList;
    }
    get map() {
        return createProxy(this._favIndex, this.keySanitizer, 'FavoritesReactiveStore._favIndex');
    }
    get priorMap() {
        return createProxy(this._priorFavIndex, this.keySanitizer, 'FavoritesReactiveStore._priorFavIndex');
    }
    get limits() {
        return this.mainCache?.message.limits;
    }
    get favoritesListChanged() {
        if (!this.list || !this.priorList) {
            return true;
        }
        return !deepEqual(this.list, this.priorList);
    }
    state(npid) {
        if (!isNpid(npid)) {
            throw new Error('in FavoritesReactiveStore, favoriteState(): npid did not pass validation');
        }
        if (!this._favIndex) {
            throw new Error('in FavoritesReactiveStore, favoriteState(): favIndex not found');
        }
        return this._favIndex.has(npid);
    }
    async newData() {
        logger.info('New data received, processing in FavoritesReactiveStore');
        if (!this.mainCache) {
            logger.warn('mainCache is not defined in FavoritesReactiveStore newData()');
            return;
        }
        this._priorList = [...(this._list ?? [])];
        this._list = this.mainCache.message.netlist;
        this._priorFavIndex = this._favIndex ? new Map(this._favIndex) : null;
        this._favIndex = new Map(this.mainCache.message.netlist.map(net => [net.id, net]));
    }
}
//# sourceMappingURL=stores.js.map