import { EndPointClient } from '#@client/lib/clientUtils.js';
import { EndPointResponse, LiveNetDetailsResponse, LiveNetPresenceResponse, FollowListResponse, FollowListNetInfo, FollowListLimits, Client, Station, NPID } from '#@client/types/commonTypes.js';
import { SimpleInteractions, DefaultStateTypes } from '#@client/types/clientTypes.js';
export type NewDataReturnType = Promise<void>;
type NewDataCallback = () => NewDataReturnType;
export interface StoreSubscriber {
    readonly uuid: string;
    newData: NewDataCallback;
    online: boolean;
}
export declare abstract class ReactiveStore<T extends EndPointResponse> {
    protected endPoint: EndPointClient;
    protected enableSse: boolean;
    private isInitStoreRunning;
    private eventSource;
    private serverDataCache;
    private readonly subscriberMap;
    private readonly mainLooper;
    private readonly rttLooper;
    private lastHash;
    version: number;
    private _mainCache;
    private readonly inFlightWindowManager;
    private endPointError;
    constructor(endPoint: EndPointClient, compensatoryScheduling?: boolean, enableSse?: boolean);
    private handleNewData;
    init(): Promise<void>;
    protected onNetClose(): void;
    delayServerDataIngest(): void;
    private notifySubscribers;
    private mainCacheChanged;
    private checkRTT;
    subscribe(subscriber: StoreSubscriber): void;
    unsubscribe(subscriber: StoreSubscriber): void;
    protected set mainCache(value: T | null);
    private _readonlyCacheCopy;
    private _cachedVersion;
    private updateReadonlyCacheCopy;
    get mainCache(): T | null;
    get ready(): boolean;
    cachePropertyHasChanged<K extends keyof T>(property: K, priorObject: T[K]): boolean;
    protected abstract newData(): NewDataReturnType;
    protected abstract isValidStoreData(obj: unknown): obj is T;
}
export declare class StateGroup extends Set<string> {
    newData: boolean;
    add(callSign: string): this;
    delete(callSign: string): boolean;
}
declare const stateGroupKeysArr: readonly ["hand-up", "checked-in-ever", "loggers", "relays", "attendees", "checked-out", "netcontrols"];
export declare function isStateGroupKey(value: string): value is StateGroupKey;
export type StateGroupKey = (typeof stateGroupKeysArr)[number];
export type PropertiesOfInterest = (typeof StationIndexer.propertiesOfInterest)[number];
export interface ReadonlyStateGroup extends ReadonlySet<string> {
    readonly newData: boolean;
}
declare class StationIndexer {
    private readonly keySanitizer;
    private _stationIndex;
    private _priorStationIndex;
    private _changedPropertiesMap;
    private clientCallSign;
    private store;
    firstRun: boolean;
    private readonly stateGroupCollection;
    private generateIndexes;
    private processPerStationDiffs;
    private processAggregateDiffs;
    process(store: LiveNetReactiveStore, client: Promise<Client>): void;
    getGroup(groupName: StateGroupKey): ReadonlyStateGroup | undefined;
    isInGroup(groupName: StateGroupKey, callSign: string): boolean;
    private extractStationData;
    get(callSign: string): Readonly<Station> | null;
    getPrior(callSign: string): Readonly<Station> | null;
    private static asPropertiesOfInterest;
    static readonly propertiesOfInterest: ["displayName", "location", "checkedState", "hand", "role", "highlight", "presence", "level", "callSign", "photo", "averageSigReport", "chatEnabled"];
    static getPropertiesOfInterest(): ["displayName", "location", "checkedState", "hand", "role", "highlight", "presence", "level", "callSign", "photo", "averageSigReport", "chatEnabled"];
    havePropertiesChanged(properties: PropertiesOfInterest[], callSign?: string): boolean;
    haveMyStationPropertiesChanged(properties: PropertiesOfInterest[]): boolean;
    changedProperties(callSign?: string): ReadonlyArray<PropertiesOfInterest> | null;
    myChangedProperties(): ReadonlyArray<PropertiesOfInterest> | null;
    get list(): ReadonlyArray<Station>;
    get priorList(): ReadonlyArray<Station>;
    get map(): ReadonlyMap<string, Station> | null;
    get priorMap(): ReadonlyMap<string, Station> | null;
    get changedPropsMap(): ReadonlyMap<string, PropertiesOfInterest[]> | null;
    get iAmAdmin(): boolean;
    get iAmCheckedIn(): boolean;
    get mine(): Readonly<Station> | null;
    get minePrior(): Readonly<Station> | null;
}
export declare class LiveNetReactiveStore extends ReactiveStore<LiveNetDetailsResponse> implements SimpleInteractions<DefaultStateTypes> {
    private client;
    readonly stations: StationIndexer;
    init(client?: Promise<Client>): Promise<void>;
    protected isValidStoreData(obj: unknown): obj is LiveNetDetailsResponse;
    protected newData(): NewDataReturnType;
    private simpleInteractionWrapper;
    hand(callSign: string, state?: DefaultStateTypes): boolean;
    highlight(callSign: string, state?: DefaultStateTypes): boolean;
    checkState(callSign: string, state?: DefaultStateTypes): boolean | null;
}
export declare class LiveNetPresenceReactiveStore extends ReactiveStore<LiveNetPresenceResponse> {
    endPoint: EndPointClient;
    constructor(endPoint: EndPointClient);
    protected isValidStoreData(obj: unknown): obj is LiveNetPresenceResponse;
    protected newData(): NewDataReturnType;
}
export declare class FavoritesReactiveStore extends ReactiveStore<FollowListResponse> {
    private _favIndex;
    private _priorFavIndex;
    private _priorList;
    private _list;
    private readonly keySanitizer;
    protected isValidStoreData(obj: unknown): obj is FollowListResponse;
    get list(): ReadonlyArray<FollowListNetInfo> | null;
    get priorList(): ReadonlyArray<FollowListNetInfo> | null;
    get map(): ReadonlyMap<NPID, FollowListNetInfo> | null;
    get priorMap(): ReadonlyMap<NPID, FollowListNetInfo> | null;
    get limits(): Readonly<FollowListLimits> | undefined;
    get favoritesListChanged(): boolean;
    state(npid: NPID): boolean;
    protected newData(): NewDataReturnType;
}
export {};
//# sourceMappingURL=stores.d.ts.map