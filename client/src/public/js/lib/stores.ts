/* hamlive-oss — MIT License. See LICENSE. */

/* eslint-disable @typescript-eslint/require-await */
import { EndPointClient, Looper, LoopStats, deepEqual, deepClone, createProxy } from '#@client/lib/clientUtils.js';
import {
    EndPointResponse,
    LiveNetDetailsResponse,
    LiveNetPresenceResponse,
    FollowListResponse,
    FollowListNetInfo,
    FollowListLimits,
    Client,
    Station,
    NPID
} from '#@client/types/commonTypes.js';
import { SimpleInteractions, SimpleInteractionMethodNames, DefaultStateTypes } from '#@client/types/clientTypes.js';
import {
    isLiveNetDetailsResponse,
    isLiveNetPresenceResponse,
    isFollowListResponse,
    isNpid
} from '#@client/types/commonTypesupport.js';
import { serverInfo } from '#@client/lib/serverInfo.js';
import { createLogger } from '#@client/lib/logger.js';
import { produce } from 'immer';

const logger = createLogger('lib/stores.ts');

/**
 * The InFlightWindowManager class manages an "in-flight window": a period when mainCache changes, initiated by widgets (based on user interaction),
 * are also sent to the server and await acknowledgment.
 *
 * It prevents ReactiveStore from updating its main cache with server data during this window to avoid overwriting local changes that are still in-flight (POSTed to server).
 *
 * The window's duration is based on the last widget-initiated mainCache modification time plus the server's round-trip time (RTT), which is periodically measured and adjusted.
 *
 * The class uses two Loopers:
 * - One measures the RTT and adjusts the window.
 * - The other triggers the ReactiveStore loop to fetch new server data after the window expires, if server data changes during the window.
 *
 * The class operates as follows:
 * 1. It starts the RTT check and adjusts the window duration.
 * 2. When widget changes are ready to be POST-ed, `updateInFlightWindow()` sets the window's end and schedules a check.
 * 3. `scheduleInFlightWindowCheck()` verifies if the window is active. If it is, it schedules another check. If not, and server data has changed, it triggers the main loop to process the new data.
 * 4. ReactiveStore uses `isInFlightWindow()` to determine if it should update its main cache, based on the window's status.
 */
class InFlightWindowManager {
    // Flag to indicate if a check is scheduled. This is used to prevent multiple checks from being scheduled concurrently.
    private isCheckScheduled = false;
    // Timestamp until which changes are in-flight. This is used by ReactiveStore to determine if it should update its main cache.
    private changesInFlightUntilTimestamp: number | null = null;
    // Default round-trip time (RTT) in milliseconds. This is used to initialize the in-flight window.
    private inFlightRttMs = 2000;
    // Hash of the server data before the in-flight window. This is used to check if server data has changed during the in-flight window.
    private serverDataHashBeforeInFlight: string | null = null;

    constructor(
        // Looper for checking RTT. This is used to periodically measure the RTT.
        private readonly rttLooper: Looper,
        // Main looper for the application. This is used to run the main loop immediately when server data changes during the in-flight window.
        private readonly mainLooper: Looper,
        // Function to check RTT. This is used to measure the RTT.
        private readonly checkRTT: () => Promise<number>
    ) {}

    // Starts the RTT check. This is used to periodically measure the RTT and adjust the in-flight window.
    // The in-flight window is adjusted by assigning the maximum of the RTT_FLOOR and the minimum of the RTT_CEILING and
    // the maximum of the recent RTT measurements to this.inFlightRttMs.
    startRttCheck(): void {
        const RTT_FLOOR = 1000;
        const RTT_CEILING = 1500;
        const BUFFER = 500;
        const measurements: number[] = [];

        this.validateConstants(RTT_FLOOR, RTT_CEILING, BUFFER);

        this.rttLooper.start(async (loopStats: LoopStats) => {
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

    // Validates the constants used in the RTT check. This is used to ensure that the RTT check parameters are valid.
    validateConstants(RTT_FLOOR: number, RTT_CEILING: number, BUFFER: number): void {
        if (RTT_FLOOR >= RTT_CEILING) {
            throw new Error('RTT_FLOOR must be less than RTT_CEILING');
        }

        if (BUFFER > RTT_CEILING) {
            throw new Error('BUFFER must be less than RTT_CEILING');
        }
    }

    // Adjusts and logs the measured RTT. This is used to ensure that the measured RTT is within the valid range.
    adjustAndLogRtt(measuredRtt: number, RTT_FLOOR: number, RTT_CEILING: number): number {
        if (measuredRtt < RTT_FLOOR) {
            // logger.debug(
            //     `Measured RTT of ${(measuredRtt / 1000).toFixed(2)} seconds is less than floor, setting to floor.`
            // );
            return RTT_FLOOR;
        } else if (measuredRtt > RTT_CEILING) {
            logger.debug(
                `Measured RTT of ${(measuredRtt / 1000).toFixed(
                    2
                )} seconds is greater than ceiling, setting to ceiling.`
            );
            return RTT_CEILING;
        }
        return measuredRtt;
    }

    // Updates the measurements used to calculate the in-flight window. This is used to keep track of the most recent 3 RTT measurements.
    updateMeasurements(measurements: number[], totalRtt: number): void {
        measurements.push(totalRtt);
        if (measurements.length > 3) {
            measurements.shift();
        }
    }

    // Logs the current in-flight wait. This is used to provide visibility into the current state of the in-flight window.
    logInFlightWait(measuredRtt: number, BUFFER: number, RTT_FLOOR: number, RTT_CEILING: number): void {
        const measuredRttSeconds = (measuredRtt / 1000).toFixed(2);
        const bufferSeconds = (BUFFER / 1000).toFixed(2);
        const totalRttSeconds = (this.inFlightRttMs / 1000).toFixed(2);

        let logMessage = `Calculated In-flight Window: ${totalRttSeconds}s (Measured RTT: ${measuredRttSeconds}s, Buffer: ${bufferSeconds}s)`;

        if (this.inFlightRttMs === RTT_FLOOR + BUFFER) {
            logMessage += ' (at floor)';
        } else if (this.inFlightRttMs === RTT_CEILING + BUFFER) {
            logMessage += ' (at ceiling)';
        }

        logger.debug(logMessage);
    }

    // Checks if we are currently in the in-flight window. ReactiveStore uses this to determine if it should update its main cache from the server cache.
    // If we are in the in-flight window, it means that there are changes, sent by widgets, that have not yet been acknowledged by the server (so ReactiveStore should not update its cache via new inbound data from server).
    isInFlightWindow(): boolean {
        // If changesInFlightUntilTimestamp is not null and the current time is less than it, we are in the in-flight window
        return this.changesInFlightUntilTimestamp !== null && performance.now() < this.changesInFlightUntilTimestamp;
    }

    // Schedules a check of the in-flight window. This is used to ensure that the in-flight window is checked after it is expected to end.
    // If the server data has changed during the in-flight window (indicated by a change in the lastHash), this method will also trigger the main loop to process the new data.
    // The check is scheduled to run after the duration of the in-flight window (this.inFlightRttMs).
    scheduleInFlightWindowCheck(lastHash: string): void {
        if (this.isCheckScheduled) {
            return;
        }

        if (this.isInFlightWindow()) {
            // Calculate the remaining time in the in-flight window
            const remainingMs = this.changesInFlightUntilTimestamp
                ? this.changesInFlightUntilTimestamp - performance.now()
                : 0;
            // Schedule another check after the remaining time

            //Keep in mind, the duration of the window can be extended by updateInFlightWindow() which calls this method

            this.isCheckScheduled = true;
            setTimeout(() => {
                this.isCheckScheduled = false;
                this.scheduleInFlightWindowCheck(lastHash);
            }, remainingMs);
        } else {
            // If the server data has changed during the in-flight window
            if (this.serverDataHashBeforeInFlight !== lastHash) {
                // Log the change and run the main loop immediately to process the new data
                logger.warn(
                    'Server data has changed during the in-flight window. Now that window has expired, running the main loop immediately.'
                );
                this.mainLooper.runImmediately();
            }
        }
    }

    // Called by the ReactiveStore to indicate that widets are about to post new data to the server, this ultimately triggers an "in-flight window"
    // (a period of time where the store will not update its main cache from the server cache, until the server data contains the changes POSTed by
    // the widgets).
    updateInFlightWindow(lastHash: string): void {
        // Update the in-flight window to end after now + the current RTT
        this.changesInFlightUntilTimestamp = performance.now() + this.inFlightRttMs;

        const remainingSeconds = this.changesInFlightUntilTimestamp
            ? ((this.changesInFlightUntilTimestamp - performance.now()) / 1000).toFixed(2)
            : 'No changes in flight';

        logger.info(`Client --> Service data in flight for the next: ${remainingSeconds} seconds`);

        // Store the hash of the server data before the in-flight window
        this.serverDataHashBeforeInFlight = lastHash;
        // Schedule a check of the in-flight window
        this.scheduleInFlightWindowCheck(lastHash);
    }
}

export type NewDataReturnType = Promise<void>;
type NewDataCallback = () => NewDataReturnType;

export interface StoreSubscriber {
    readonly uuid: string;
    newData: NewDataCallback;
    online: boolean;
}

// ReactiveStore is an abstract class that manages the main data cache for the application.
// It uses an instance of InFlightWindowManager to manage the "in-flight window", a period during which updates from the *server to the main cache are delayed to prevent overwriting changes that are still being processed by the server.
// The class employs two Loopers: one for the main application logic and another for measuring the Round-Trip Time (RTT) to the server. The RTT is used by the InFlightWindowManager to adjust the duration of the in-flight window.
export abstract class ReactiveStore<T extends EndPointResponse> {
    private isInitStoreRunning = false;
    // Holds the EventSource object for server-sent events (SSE)
    private eventSource: EventSource | null = null;
    // Holds the latest server response data
    private serverDataCache: T | null = null;
    // Map of widget UUID to callback function
    private readonly subscriberMap: Map<string, StoreSubscriber> = new Map();
    // Looper for the main server data retrieval loop
    private readonly mainLooper: Looper;
    // Looper for measuring Round-Trip Time (RTT), used by the InFlightWindowManager
    private readonly rttLooper: Looper;
    // Hash of the last received server response
    private lastHash: string | null = null;
    // Primary data cache version
    public version = 0;
    // Primary data cache for the store
    private _mainCache: T | null = null;
    // Manages the in-flight window, a period during which cache updates from server are delayed
    private readonly inFlightWindowManager: InFlightWindowManager;

    private endPointError = false;

    public constructor(
        protected endPoint: EndPointClient,
        compensatoryScheduling: boolean = false,
        protected enableSse = true
    ) {
        // Initialize the RTT and main loopers
        this.rttLooper = new Looper(60000, 'RTT Measurements', false);
        this.mainLooper = new Looper(5000, this.constructor.name, compensatoryScheduling);
        // Initialize the InFlightWindowManager
        this.inFlightWindowManager = new InFlightWindowManager(
            this.rttLooper,
            this.mainLooper,
            this.checkRTT.bind(this)
        );
    }

    private handleNewData(data: unknown): void {
        // Validate the data
        if (!this.isValidStoreData(data)) {
            throw new Error('Invalid data format');
        }

        // If the data hasn't changed, there's no need to update the cache
        if (data.hash === this.lastHash) {
            return;
        } else {
            logger.info(`${this.constructor.name}: current hash: ${data.hash} ≠ prior hash: ${this.lastHash}`);
        }

        // Updates the server data cache and the hash of the last received response
        this.lastHash = data.hash;
        this.serverDataCache = data;

        // If we're not in the in-flight window, updates the main cache with the server data
        if (!this.inFlightWindowManager.isInFlightWindow()) {
            this.mainCache = this.serverDataCache;
        }

        // If the data contains an ssePath field, subscribe to the SSE events
        if (this.enableSse && data.ssePath && !this.eventSource) {
            // Create an EventSource object
            this.eventSource = new EventSource(data.ssePath);

            // Stop short-polliing
            this.mainLooper.stop();

            //SSE Setup:
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

            // Listen for messages
            this.eventSource.onmessage = event => {
                // Parse the event data
                if (typeof event.data !== 'string') {
                    throw new Error('Event data is not a string');
                }

                logger.info('Received Server-Sent Event');
                const sseData = JSON.parse(event.data) as { type?: string };

                // Handle the new data
                this.handleNewData(sseData);
            };
        }
    }

    // Starts the main application loop. During each iteration, it fetches the latest data from the server and updates the server data cache.
    // IMPORTANT: If the application is not in the in-flight window (as determined by the InFlightWindowManager), it also updates the main cache with the new server data.
    public async init(): Promise<void> {
        if (this.isInitStoreRunning) {
            logger.info('initStore is already running');
            return;
        }

        this.isInitStoreRunning = true;

        // Begins the RTT measurement process
        this.inFlightWindowManager.startRttCheck();

        // Starts the main application loop
        this.mainLooper.start(async (stats: LoopStats) => {
            try {
                const response = await this.endPoint.show();

                // Handle the new data
                this.handleNewData(response);

                // Notify subscribers that the store is online
                if (this.endPointError) {
                    this.endPointError = false;
                    this.notifySubscribers('ONLINE').catch(err => logger.error(String(err)));
                }

                // Adjusts the loop interval based on the server's ttlMs value
                if (response.ttlMs !== stats.interval) {
                    logger.info(`Service endpoint ttlMs is ${response.ttlMs}, telling looper to adjust interval`);
                    this.mainLooper.setInterval(response.ttlMs);
                }
            } catch (error) {
                // Handle the error here
                this.endPointError = true;
                this.notifySubscribers('OFFLINE').catch(err => logger.error(String(err)));
                logger.error(String(error));
            }
        }, true);

        this.isInitStoreRunning = false;
    }

    // Called when the main cache is about to be modified. It informs the InFlightWindowManager to start the in-flight window, during which updates to the main cache from the server data cache are delayed.
    public delayServerDataIngest(): void {
        // Updates the in-flight window if there's a last received hash
        if (this.lastHash) {
            this.inFlightWindowManager.updateInFlightWindow(this.lastHash);
        }
    }
    private async notifySubscribers(mesg: 'NEWDATA' | 'ONLINE' | 'OFFLINE'): Promise<void> {
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
        } else {
            logger.info(`No current subscribers to ${this.constructor.name}`);
        }
    }
    // Executes all registered callbacks when the main cache changes
    private async mainCacheChanged(): Promise<void> {
        try {
            // Allow store subclasses to process the new data
            await this.newData();

            // Notify all widgets of the new data
            await this.notifySubscribers('NEWDATA');
        } catch (err) {
            logger.error(String(err));
        }
    }

    // Measures the RTT by making a HEAD request to the server
    private async checkRTT(): Promise<number> {
        const start = performance.now();
        await fetch('/', { method: 'HEAD' });
        const end = performance.now();
        return end - start;
    }

    public subscribe(subscriber: StoreSubscriber): void {
        // Bind handleNewData() method to subscriber context and store it in the map
        this.subscriberMap.set(subscriber.uuid, subscriber);
        logger.debug(`${this.constructor.name} has a new subscriber`);
    }

    // Unsubscribe method
    public unsubscribe(subscriber: StoreSubscriber): void {
        // Remove the subscriber from the map
        logger.debug(`widget ${subscriber.uuid} unsubscribed from ${this.constructor.name}`);
        this.subscriberMap.delete(subscriber.uuid);
    }

    // Updates the main cache if the provided data is valid
    protected set mainCache(value: T | null) {
        try {
            if (this.isValidStoreData(value)) {
                this._mainCache = value;
                this.version++;
                logger.info(`${this.constructor.name}: updated to version ${this.version}`);
                this.mainCacheChanged().catch(err => logger.error(String(err)));
            } else {
                throw new Error('Invalid data provided to mainCache');
            }
        } catch (error) {
            // Handle the error here
            logger.error(String(error));
        }
    }

    // Private properties to store the cached value and its version
    private _readonlyCacheCopy: T | null = null; // Will contain frozen deep clone of _mainCache
    private _cachedVersion: number = -1;
    // Private method to update the cache
    private updateReadonlyCacheCopy(): void {
        this._readonlyCacheCopy = Object.freeze(deepClone(this._mainCache));
        this._cachedVersion = this.version;
        logger.info(
            `${this.constructor.name} received a request for mainCache, returning [UPDATED] v${this.version} ${this._readonlyCacheCopy === null ? '(null store data)' : ''}`
        );
    }

    // Returns the current state of the main cache
    public get mainCache(): T | null {
        if (this.version !== this._cachedVersion) {
            this.updateReadonlyCacheCopy();
        }
        return this._readonlyCacheCopy;
    }

    public get ready(): boolean {
        return this._mainCache !== null;
    }

    public cachePropertyHasChanged<K extends keyof T>(property: K, priorObject: T[K]): boolean {
        if (!this._mainCache) {
            logger.warn('mainCache not *yet initialized in cachePropertyHasChanged(), returning true');
            return true;
        }

        return !deepEqual(this._mainCache[property], priorObject);
    }

    protected abstract newData(): NewDataReturnType;

    // Validates the store data; to be implemented by subclasses
    protected abstract isValidStoreData(obj: unknown): obj is T;
}

export class StateGroup extends Set<string> {
    public newData = false;

    override add(callSign: string): this {
        this.newData = true;
        return super.add(callSign.toUpperCase());
    }

    override delete(callSign: string): boolean {
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
] as const;
export function isStateGroupKey(value: string): value is StateGroupKey {
    return (stateGroupKeysArr as readonly string[]).includes(value);
}
export type StateGroupKey = (typeof stateGroupKeysArr)[number];

class StateGroupCollection {
    public stateGroups: Record<StateGroupKey, StateGroup> = {
        'hand-up': new StateGroup(),
        'checked-in-ever': new StateGroup(),
        'checked-out': new StateGroup(),
        netcontrols: new StateGroup(),
        loggers: new StateGroup(),
        relays: new StateGroup(),
        attendees: new StateGroup()
    };

    get newData(): boolean {
        return Object.values(this.stateGroups).some(group => group.newData);
    }

    set newData(value: boolean) {
        Object.values(this.stateGroups).forEach(group => (group.newData = value));
    }

    public getGroup(groupName: StateGroupKey): StateGroup | undefined {
        return this.stateGroups[groupName];
    }

    public addToGroup(groupName: StateGroupKey, callSign: string): void {
        const group = this.getGroup(groupName);
        if (group) {
            group.add(callSign);
        } else {
            logger.error(`Group ${groupName} does not exist.`);
        }
    }

    public deleteFromGroup(groupName: StateGroupKey, callSign: string): boolean {
        const group = this.getGroup(groupName);
        if (group) {
            return group.delete(callSign);
        } else {
            logger.error(`Group ${groupName} does not exist.`);
            return false;
        }
    }

    public isInGroup(groupName: StateGroupKey, callSign: string): boolean {
        const group = this.getGroup(groupName);
        if (group) {
            return group.has(callSign);
        } else {
            logger.error(`Group ${groupName} does not exist.`);
            return false;
        }
    }

    public report(): string {
        return Object.entries(this.stateGroups)
            .map(
                ([groupName, group]) =>
                    `Group Name: ${groupName}, New Data: ${group.newData}, Contents: [${[...group].join(', ')}]`
            )
            .join('\n');
    }
}

export type PropertiesOfInterest = (typeof StationIndexer.propertiesOfInterest)[number];

type StationDiffHook = (
    currentStation: Station,
    currentStationChangedProperties: PropertiesOfInterest[],
    priorStation: Station | undefined
) => void;

// StationInexer makes readonly state groups available to widgets:
export interface ReadonlyStateGroup extends ReadonlySet<string> {
    readonly newData: boolean;
}

class StationIndexer {
    private readonly keySanitizer = (key: string) => key.toUpperCase();
    private _stationIndex: ReadonlyMap<string, Station> | null = null;
    private _priorStationIndex: ReadonlyMap<string, Station> | null = null;
    private _changedPropertiesMap: ReadonlyMap<string, PropertiesOfInterest[]> | null = null;
    private clientCallSign: string | null = null;
    private store: LiveNetReactiveStore | null = null;
    public firstRun = true;
    private readonly stateGroupCollection: StateGroupCollection = new StateGroupCollection();

    private generateIndexes(): void {
        if (!this.store?.mainCache) {
            throw new Error('store mainCache is required in StationIndexer generateIndexes()');
        }

        // Copy the current station index to the prior station index
        this._priorStationIndex = this._stationIndex ? new Map(this._stationIndex) : null;
        this.firstRun = this._priorStationIndex === null;

        // Index all the new station data
        const { stations } = this.store.mainCache;
        logger.info(`Indexing ${stations.length} stations...`);

        this._stationIndex = new Map<string, Station>(stations.map(station => [station.callSign, station]));
    }

    private processPerStationDiffs(hooks: StationDiffHook[]): void {
        const changedPropertiesMap = new Map<string, PropertiesOfInterest[]>();

        this._stationIndex?.forEach((currentStation, callSign) => {
            const priorStation = this._priorStationIndex?.get(callSign);

            let currentStationChangedProperties: PropertiesOfInterest[] = [];

            if (priorStation) {
                currentStationChangedProperties = StationIndexer.propertiesOfInterest.filter(
                    property => currentStation[property] !== priorStation[property]
                );
            } else {
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

    private processAggregateDiffs(): void {
        // Attendees and CheckedInEver (part 2)
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

                // Check if the order of keys has changed
                let orderChanged = false;
                if (priorCallSigns.length === currentCallSigns.length) {
                    for (let i = 0; i < priorCallSigns.length; i++) {
                        if (priorCallSigns[i] !== currentCallSigns[i]) {
                            orderChanged = true;
                            break;
                        }
                    }
                } else {
                    orderChanged = true; // Different lengths mean different order
                }

                if (orderChanged) logger.debug('Order of call signs has changed');

                // Signal that the attendees group has changed if there are any changes
                if (addedCallSigns.length || removedCallSigns.length || orderChanged) {
                    this.stateGroupCollection.stateGroups.attendees.newData = true;
                }

                // Signal that the checkedInEver group has changed if
                // missing now but was present (and checkedIn) before
                removedCallSigns.forEach(callSign => {
                    if (this._priorStationIndex?.get(callSign)?.checkedState) {
                        this.stateGroupCollection.deleteFromGroup('checked-in-ever', callSign);
                        this.stateGroupCollection.stateGroups['checked-in-ever'].newData = true;
                    }
                });
            }
        }
    }

    public process(store: LiveNetReactiveStore, client: Promise<Client>): void {
        this.store = store;

        if (!this.clientCallSign) {
            //Getting the client callSign from DOM (should exist/be faster) or Presence
            if (serverInfo.callSign) {
                this.clientCallSign = serverInfo.callSign.toUpperCase();
                logger.debug(`Received my callSign from DOM (${this.clientCallSign})`);
            } else {
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
            //This way widgets will render the initial data on first run
            this.stateGroupCollection.newData = true;
        } else {
            //Otherwise default to false, but allow the processDiffs to set it to true if applicable
            this.stateGroupCollection.newData = false;
        }

        this.processPerStationDiffs([
            //handUp
            (currentStation, currentStationChangedProperties) => {
                if (currentStationChangedProperties.includes('hand')) {
                    if (currentStation.hand) {
                        this.stateGroupCollection.addToGroup('hand-up', currentStation.callSign);
                    } else {
                        this.stateGroupCollection.deleteFromGroup('hand-up', currentStation.callSign);
                    }
                }
            },
            //checkedInEver (part 1)
            (currentStation, currentStationChangedProperties, priorStation) => {
                //If this is the first checkIn, changedProperties will be empty, so lets check !priorStation:
                if (currentStationChangedProperties.includes('checkedState') || !priorStation) {
                    if (typeof currentStation.checkedState === 'boolean') {
                        this.stateGroupCollection.addToGroup('checked-in-ever', currentStation.callSign);
                    } else {
                        this.stateGroupCollection.deleteFromGroup('checked-in-ever', currentStation.callSign);
                    }
                    if (typeof currentStation.checkedState !== typeof priorStation?.checkedState) {
                        this.stateGroupCollection.stateGroups['checked-in-ever'].newData = true;
                    }
                }
            },
            //checkedOut
            (currentStation, currentStationChangedProperties) => {
                if (currentStationChangedProperties.includes('checkedState')) {
                    if (currentStation.checkedState === false) {
                        this.stateGroupCollection.addToGroup('checked-out', currentStation.callSign);
                    } else {
                        this.stateGroupCollection.deleteFromGroup('checked-out', currentStation.callSign);
                    }
                    this.stateGroupCollection.stateGroups['checked-out'].newData = true;
                }
            },
            // Role-based groups
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

    public getGroup(groupName: StateGroupKey): ReadonlyStateGroup | undefined {
        return this.stateGroupCollection.getGroup(groupName);
    }

    public isInGroup(groupName: StateGroupKey, callSign: string): boolean {
        return this.stateGroupCollection.isInGroup(groupName, callSign);
    }

    private extractStationData<T>(
        index: ReadonlyMap<string, Station> | null,
        extractor: (index: ReadonlyMap<string, Station>) => T
    ): T | null {
        return index ? extractor(index) : null;
    }

    public get(callSign: string): Readonly<Station> | null {
        if (!this._stationIndex) {
            throw new Error('in StationIndexer, get(): stationIndex not found');
        }

        return this.extractStationData(this._stationIndex, index => index.get(callSign.toUpperCase()) || null);
    }

    public getPrior(callSign: string): Readonly<Station> | null {
        if (!this._priorStationIndex) {
            logger.info('in StationIndexer, getPrior(): priorStationIndex not found. First run?');
            return null;
        }

        return this.extractStationData(this._priorStationIndex, index => index.get(callSign.toUpperCase()) || null);
    }

    private static asPropertiesOfInterest<T extends (keyof Station)[]>(properties: [...T]) {
        return properties;
    }

    static readonly propertiesOfInterest = StationIndexer.asPropertiesOfInterest([
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
    ] as const);

    public static getPropertiesOfInterest() {
        return StationIndexer.propertiesOfInterest;
    }

    public havePropertiesChanged(properties: PropertiesOfInterest[], callSign?: string): boolean {
        const effectiveCallSign: string = (callSign || this.clientCallSign) ?? '';
        return properties.some(
            property => this._changedPropertiesMap?.get(effectiveCallSign)?.includes(property) ?? false
        );
    }

    public haveMyStationPropertiesChanged(properties: PropertiesOfInterest[]): boolean {
        if (!this.clientCallSign) {
            throw new Error('clientCallSign is required in StationIndexer: haveMyStationPropertiesChanged()');
        }
        return this.havePropertiesChanged(properties, this.clientCallSign);
    }

    public changedProperties(callSign?: string): ReadonlyArray<PropertiesOfInterest> | null {
        const effectiveCallSign: string = (callSign || this.clientCallSign) ?? ''; // Use parentheses to clarify precedence
        return this._changedPropertiesMap?.get(effectiveCallSign) ?? null;
    }

    public myChangedProperties(): ReadonlyArray<PropertiesOfInterest> | null {
        if (!this.clientCallSign) {
            throw new Error('clientCallSign is required in StationIndexer: myChangedProperties()');
        }
        return this.changedProperties(this.clientCallSign);
    }

    public get list(): ReadonlyArray<Station> {
        return this.store?.mainCache?.stations ?? [];
    }

    public get priorList(): ReadonlyArray<Station> {
        return this.extractStationData(this._priorStationIndex, index => Array.from(index.values())) ?? [];
    }

    public get map(): ReadonlyMap<string, Station> | null {
        return createProxy(this._stationIndex, this.keySanitizer, 'StationIndexer._stationIndex');
    }

    public get priorMap(): ReadonlyMap<string, Station> | null {
        return createProxy(this._priorStationIndex, this.keySanitizer, 'StationIndexer._priorStationIndex');
    }

    public get changedPropsMap(): ReadonlyMap<string, PropertiesOfInterest[]> | null {
        return createProxy(this._changedPropertiesMap, this.keySanitizer, 'StationIndexer._changedPropertiesMap');
    }

    public get iAmAdmin(): boolean {
        if (!this.mine) {
            logger.warn('Client callSign not *yet known in StationIndexer: iAmAdmin() returning false');
            return false;
        }

        return this.mine.level < 2;
    }

    public get iAmCheckedIn(): boolean {
        if (!this.mine) {
            logger.warn('Client callSign not *yet known in StationIndexer: iAmCheckedIn() returning false');
            return false;
        }

        return this.mine.checkedState === true;
    }

    public get mine(): Readonly<Station> | null {
        if (!this.clientCallSign) {
            logger.warn(
                'Client callSign not *yet known in StationIndexer: mine(). Waiting on initial response from /presence?'
            );
            return null;
        }
        return this.get(this.clientCallSign);
    }

    public get minePrior(): Readonly<Station> | null {
        if (!this.clientCallSign) {
            logger.warn(
                'Client callSign not *yet known in StationIndexer: minePrior(). Waiting on initial response from /presence?'
            );
            return null;
        }
        return this.getPrior(this.clientCallSign);
    }
}

export class LiveNetReactiveStore
    extends ReactiveStore<LiveNetDetailsResponse>
    implements SimpleInteractions<DefaultStateTypes>
{
    private client: Promise<Client> | null = null;
    public readonly stations = new StationIndexer();

    public override async init(client?: Promise<Client>): Promise<void> {
        if (!client) {
            throw new Error('client is required in LiveNetReactiveStore init()');
        }

        this.client = client;
        return super.init();
    }

    protected isValidStoreData(obj: unknown): obj is LiveNetDetailsResponse {
        return isLiveNetDetailsResponse(obj);
    }

    protected async newData(): NewDataReturnType {
        logger.info('New data received, processing in LiveNetReactiveStore');

        if (!this.client) {
            throw new Error('client is required in LiveNetReactiveStore newData()');
        }

        // Index all the station data:
        this.stations.process(this, this.client);
    }

    private simpleInteractionWrapper(
        action: SimpleInteractionMethodNames,
        callSign: string,
        state?: DefaultStateTypes
    ): DefaultStateTypes {
        //state true: set action to 'on' for this callsign
        //state false: set action to 'off' for this callsign
        //state null: toggle action for this callsign
        //state undefined: read action for this callsign

        const station = this.stations.get(callSign);

        if (!station) {
            throw new Error(`in LiveNetReactiveStore, ${action}: ${callSign} not found`);
        }

        if (action === 'highlight' && typeof state !== 'undefined' && station.checkedState === false) {
            throw new Error(`in LiveNetReactiveStore, ${action}: ${station.callSign} is checked out`);
        }

        //eventually lets globally rename checkedState to checkState throughout the codebase
        //so that this will be unnecessary:
        const stateProperty = action === 'checkState' ? 'checkedState' : action;

        // Determine the target state
        let targetState: boolean;

        if (state === null) {
            // Toggle the current state
            targetState = !station[stateProperty];
        } else if (typeof state === 'boolean') {
            // Use the provided state
            targetState = state;
        } else {
            // we are only reading the state from the store
            return station[stateProperty];
        }

        if (!this.mainCache) {
            throw new Error(`in LiveNetReactiveStore, ${action}: mainCache is not defined`);
        }

        // We bypass the in-flight window for checkouts, so we get an immediate table re-sort (attendee state group change due to sort order)
        if (action !== 'checkState') {
            // Start the in-flight window
            this.delayServerDataIngest();
        }

        // Prep the next mainCache version
        const nextMainCache = produce(this.mainCache, draftMainCache => {
            const draftStation = draftMainCache.stations.find(
                station => station.callSign.toUpperCase() === callSign.toUpperCase()
            );
            if (draftStation) {
                draftStation[stateProperty] = targetState;
            }
        });

        // Check if produce function call was successful
        if (!nextMainCache) {
            throw new Error(`${action}: produce function call failed`);
        }

        // Set the next mainCache
        this.mainCache = nextMainCache;

        return targetState;
    }

    // The below methods (hand, highlight, checkState) are used for read and write operations on the store data
    // if state is omitted, will return interaction state for callsign
    //
    public hand(callSign: string, state?: DefaultStateTypes): boolean {
        return this.simpleInteractionWrapper('hand', callSign, state) ?? false;
    }

    public highlight(callSign: string, state?: DefaultStateTypes): boolean {
        return this.simpleInteractionWrapper('highlight', callSign, state) ?? false;
    }

    public checkState(callSign: string, state?: DefaultStateTypes): boolean | null {
        return this.simpleInteractionWrapper('checkState', callSign, state);
    }
}

export class LiveNetPresenceReactiveStore extends ReactiveStore<LiveNetPresenceResponse> {
    constructor(public override endPoint: EndPointClient) {
        super(endPoint, true, false);
    }

    protected isValidStoreData(obj: unknown): obj is LiveNetPresenceResponse {
        return isLiveNetPresenceResponse(obj);
    }

    protected async newData(): NewDataReturnType {
        logger.info('New data received, processing in LiveNetPresenceReactiveStore');
    }
}

export class FavoritesReactiveStore extends ReactiveStore<FollowListResponse> {
    private _favIndex: ReadonlyMap<NPID, FollowListNetInfo> | null = null;
    private _priorFavIndex: ReadonlyMap<NPID, FollowListNetInfo> | null = null;
    private _priorList: FollowListNetInfo[] | null = null;
    private _list: FollowListNetInfo[] | null = null;
    private readonly keySanitizer = (key: NPID) => {
        if (!isNpid(key)) {
            throw new Error('in FavoritesReactiveStore, keySanitizer: key did not pass validation');
        }
        return key;
    };

    protected isValidStoreData(obj: unknown): obj is FollowListResponse {
        return isFollowListResponse(obj);
    }

    public get list(): ReadonlyArray<FollowListNetInfo> | null {
        return this._list;
    }

    public get priorList(): ReadonlyArray<FollowListNetInfo> | null {
        return this._priorList;
    }

    public get map(): ReadonlyMap<NPID, FollowListNetInfo> | null {
        return createProxy(this._favIndex, this.keySanitizer, 'FavoritesReactiveStore._favIndex');
    }

    public get priorMap(): ReadonlyMap<NPID, FollowListNetInfo> | null {
        return createProxy(this._priorFavIndex, this.keySanitizer, 'FavoritesReactiveStore._priorFavIndex');
    }

    public get limits(): Readonly<FollowListLimits> | undefined {
        return this.mainCache?.message.limits;
    }

    public get favoritesListChanged(): boolean {
        if (!this.list || !this.priorList) {
            return true;
        }

        return !deepEqual(this.list, this.priorList);
    }

    public state(npid: NPID): boolean {
        if (!isNpid(npid)) {
            throw new Error('in FavoritesReactiveStore, favoriteState(): npid did not pass validation');
        }

        if (!this._favIndex) {
            throw new Error('in FavoritesReactiveStore, favoriteState(): favIndex not found');
        }

        return this._favIndex.has(npid);
    }

    // Processes new data received by the store
    protected async newData(): NewDataReturnType {
        logger.info('New data received, processing in FavoritesReactiveStore');

        if (!this.mainCache) {
            logger.warn('mainCache is not defined in FavoritesReactiveStore newData()');
            return;
        }

        //setup lists:
        this._priorList = [...(this._list ?? [])]; // we don't want a reference to the same array
        this._list = this.mainCache.message.netlist;
        //setup indexes:
        this._priorFavIndex = this._favIndex ? new Map(this._favIndex) : null; // we don't want a reference to the same map
        this._favIndex = new Map<NPID, FollowListNetInfo>(this.mainCache.message.netlist.map(net => [net.id, net]));
    }
}
