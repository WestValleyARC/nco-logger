import { EndPointResponse, InteractionPayload, SimpleInteractionParams, RstReportBase, CommandResponse, NPID } from '#@client/types/commonTypes.js';
import { SimpleInteractions, SimpleInteractionMethodNames } from '#@client/types/clientTypes.js';
type PostData = object | FormData;
export declare class EndPointClient {
    private url;
    protected options: {
        redirectOnNotFound: boolean | string;
        redirectOnNonJson: boolean | string;
    };
    private itemId;
    private params;
    private payload;
    constructor(url: string, options?: {
        redirectOnNotFound: boolean | string;
        redirectOnNonJson: boolean | string;
    });
    private formattedParams;
    protected reset(): void;
    private handleRedirect;
    private processResponse;
    private fetchWithMethod;
    id(id: string): this;
    data(d: PostData): void;
    p(k: string, v: string): this;
    get index(): (data?: PostData | undefined) => Promise<EndPointResponse>;
    get show(): (data?: PostData | undefined) => Promise<EndPointResponse>;
    get create(): () => Promise<EndPointResponse>;
    get update(): () => Promise<EndPointResponse>;
    get remove(): (data?: PostData | undefined) => Promise<EndPointResponse>;
}
export declare class InteractionClient extends EndPointClient implements SimpleInteractions<Promise<EndPointResponse>, true, boolean> {
    constructor(npid?: NPID);
    protected rawInteraction(ia: InteractionPayload): Promise<EndPointResponse>;
    sigReport(callSign: string, report: RstReportBase): Promise<EndPointResponse>;
    protected simpleInteractionWrapper(action: SimpleInteractionMethodNames, callSign: string, actionParams: SimpleInteractionParams): Promise<EndPointResponse>;
    hand(callSign: string, state: boolean): Promise<EndPointResponse>;
    checkState(callSign: string, state: boolean): Promise<EndPointResponse>;
    highlight(callSign: string, state: boolean): Promise<EndPointResponse>;
}
export declare class FavoriteClient extends EndPointClient {
    constructor();
    set(npid: NPID, state: boolean): void;
}
export declare class AdminClient extends EndPointClient {
    constructor(npid?: NPID);
    exec(cmdLine: string): Promise<CommandResponse>;
    usageText(): Promise<string>;
}
export interface LoopStats {
    interval: number;
    firstRun: boolean;
    runCount: number;
    lastRunTime: number | null;
    nextRunTime: number;
    errorCount: number;
}
export declare class Looper {
    readonly label: string;
    private readonly compensatoryScheduling;
    private interval;
    private timeoutId;
    private loopFunction;
    skipNext: boolean;
    private intervalChanged;
    private runCount;
    private lastRunTime;
    private errorCount;
    private expectedNextRunTime;
    constructor(interval: number, label: string, compensatoryScheduling?: boolean);
    start(loopFunction: (stats: LoopStats) => Promise<void>, runImmediately?: boolean): void;
    stop(): void;
    setInterval(interval: number): void;
    skip(): void;
    private runLoop;
    runImmediately(): void;
    private scheduleNextRun;
    private scheduleTimeout;
    protected cancelNextRun(): void;
}
export declare const getNpid: () => NPID;
export declare const hashString: (input: string) => Promise<string>;
export declare const generateUUID: () => string;
declare const iconSvgs: {
    readonly 'bi-info-circle': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-info-circle\" viewBox=\"0 0 16 16\">\n            <path d=\"M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16\"/>\n            <path d=\"m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0\"/>\n        </svg>\n    ";
    readonly 'bi-power': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-power\" viewBox=\"0 0 16 16\">\n            <path d=\"M7.5 1v7h1V1z\"/>\n            <path d=\"M3 8.812a5 5 0 0 1 2.578-4.375l-.485-.874A6 6 0 1 0 11 3.616l-.501.865A5 5 0 1 1 3 8.812\"/>\n        </svg>\n    ";
    readonly 'bi-mic-fill': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-mic-fill\" viewBox=\"0 0 16 16\">\n            <path d=\"M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z\"/>\n            <path d=\"M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5\"/>\n        </svg>\n    ";
    readonly 'bi-journal-check': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-journal-check\" viewBox=\"0 0 16 16\">\n            <path fill-rule=\"evenodd\" d=\"M10.854 6.146a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 1 1 .708-.708L7.5 8.793l2.646-2.647a.5.5 0 0 1 .708 0\"/>\n            <path d=\"M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-1h1v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v1H1V2a2 2 0 0 1 2-2\"/>\n            <path d=\"M1 5v-.5a.5.5 0 0 1 1 0V5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0V8h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0v.5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1z\"/>\n        </svg>\n    ";
    readonly 'bi-person-check': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-person-check\" viewBox=\"0 0 16 16\">\n            <path d=\"M12.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m1.679-4.493-1.335 2.226a.75.75 0 0 1-1.174.144l-.774-.773a.5.5 0 0 1 .708-.708l.547.548 1.17-1.951a.5.5 0 1 1 .858.514M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0M8 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4\"/>\n            <path d=\"M8.256 14a4.5 4.5 0 0 1-.229-1.004H3c.001-.246.154-.986.832-1.664C4.484 10.68 5.711 10 8 10q.39 0 .74.025c.226-.341.496-.65.804-.918Q8.844 9.002 8 9c-5 0-6 3-6 4s1 1 1 1z\"/>\n        </svg>\n    ";
    readonly 'bi-intersect': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-intersect\" viewBox=\"0 0 16 16\">\n            <path d=\"M0 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2H2a2 2 0 0 1-2-2zm5 10v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2v5a2 2 0 0 1-2 2zm6-8V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2V6a2 2 0 0 1 2-2z\"/>\n        </svg>\n    ";
    readonly 'bi-eye-fill': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-eye-fill\" viewBox=\"0 0 16 16\">\n            <path d=\"M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0\"/>\n            <path d=\"M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8m8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7\"/>\n        </svg>\n    ";
    readonly 'bi-x-circle-fill': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-x-circle-fill\" viewBox=\"0 0 16 16\">\n            <path d=\"M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z\"/>\n        </svg>\n    ";
    readonly 'bi-dash-circle': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-dash-circle\" viewBox=\"0 0 16 16\">\n            <path d=\"M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16\"/>\n            <path d=\"M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8\"/>\n        </svg>\n    ";
    readonly 'bi-plus-circle': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-plus-circle\" viewBox=\"0 0 16 16\">\n            <path d=\"M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16\"/>\n            <path d=\"M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4\"/>\n        </svg>\n    ";
    readonly 'bi-star': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-star\" viewBox=\"0 0 16 16\">\n            <path d=\"M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.56.56 0 0 0-.163-.505L1.71 6.745l4.052-.576a.53.53 0 0 0 .393-.288L8 2.223l1.847 3.658a.53.53 0 0 0 .393.288l4.052.575-2.906 2.77a.56.56 0 0 0-.163.506l.694 3.957-3.686-1.894a.5.5 0 0 0-.461 0z\"/>\n        </svg>\n    ";
    readonly 'bi-star-fill': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-star-fill\" viewBox=\"0 0 16 16\">\n            <path d=\"M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z\"/>\n        </svg>\n    ";
    readonly 'bi-heart': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-heart\" viewBox=\"0 0 16 16\">\n            <path d=\"m8 2.748-.717-.737C5.6.281 2.514.878 1.4 3.053c-1.247 2.487-.258 5.348 1.633 7.574L8 15l4.966-4.373c1.891-2.226 2.88-5.087 1.633-7.574C13.486.878 10.4.28 8.717 2.01zm0 10.905-4.53-3.99C1.69 7.565.811 5.09 1.99 3.084c.93-1.58 3.065-2.12 4.517-.82L8 3.634l1.493-1.37c1.452-1.3 3.587-.76 4.517.82 1.179 2.006.3 4.481-1.48 6.579z\"/>\n        </svg>\n    ";
    readonly 'bi-heart-fill': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-heart-fill\" viewBox=\"0 0 16 16\">\n            <path fill-rule=\"evenodd\" d=\"M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314\"/>\n        </svg>\n    ";
    readonly 'bi-chevron-contract': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-chevron-contract\" viewBox=\"0 0 16 16\">\n            <path fill-rule=\"evenodd\" d=\"M3.646 13.854a.5.5 0 0 0 .708 0L8 10.207l3.646 3.647a.5.5 0 0 0 .708-.708l-4-4a.5.5 0 0 0-.708 0l-4 4a.5.5 0 0 0 0 .708m0-11.708a.5.5 0 0 1 .708 0L8 5.793l3.646-3.647a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 0-.708\"/>\n        </svg>\n    ";
    readonly 'bi-chevron-double-down': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-chevron-double-down\" viewBox=\"0 0 16 16\">\n            <path fill-rule=\"evenodd\" d=\"M1.646 6.646a.5.5 0 0 1 .708 0L8 12.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708\"/>\n            <path fill-rule=\"evenodd\" d=\"M1.646 2.646a.5.5 0 0 1 .708 0L8 8.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708\"/>\n        </svg>\n    ";
    readonly 'bi-three-dots': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-three-dots\" viewBox=\"0 0 16 16\">\n            <path d=\"M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3\"/>\n        </svg>\n    ";
    readonly 'bi-file-earmark-arrow-up': "\n        <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" fill=\"currentColor\" class=\"bi bi-file-earmark-arrow-up\" viewBox=\"0 0 16 16\">\n            <path d=\"M8.5 11.5a.5.5 0 0 1-1 0V7.707L6.354 8.854a.5.5 0 1 1-.708-.708l2-2a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 7.707z\"/>\n            <path d=\"M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2M9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5z\"/>\n        </svg>";
};
type IconName = keyof typeof iconSvgs;
export declare const getIconSvg: (iconName: IconName) => string;
export declare const makeNonBreaking: (htmlString: string) => string;
interface UserPreferences {
    usageCollapsed: boolean;
    autoScrollStationTable: boolean;
    chatCommandTipDismissed: boolean;
    [key: string]: boolean;
}
export declare class UserAgentPersistentPreferences {
    private static readonly STORAGE_KEY;
    private preferences;
    constructor();
    private savePreferences;
    getPreference(key: keyof UserPreferences): boolean;
    setPreference(key: keyof UserPreferences, value: boolean): void;
    get usageCollapsed(): boolean;
    set usageCollapsed(value: boolean);
    get autoScrollStationTable(): boolean;
    set autoScrollStationTable(value: boolean);
    get chatCommandTipDismissed(): boolean;
    set chatCommandTipDismissed(value: boolean);
}
export declare const deepEqual: (a: unknown, b: unknown) => boolean;
type KeySanitizer<K> = (key: K) => K;
export declare const createProxy: <K, T>(map: ReadonlyMap<K, T> | null, keySanitizer: KeySanitizer<K>, label: string) => ReadonlyMap<K, T>;
export declare const deepClone: <T>(obj: T) => T;
export declare const initAndLogError: (initFunction: () => Promise<void> | void) => Promise<void>;
export declare enum SchedulingMethod {
    NextEventLoop = 0,
    Microtask = 1,
    NextAnimationFrame = 2
}
export declare const schedule: (callback: () => void, method: SchedulingMethod) => void;
export interface FileParts {
    baseName: string;
    extension: string;
}
export declare const getFileParts: (filename: string) => FileParts;
export declare const slugifyFilename: (filename: string) => string;
export {};
//# sourceMappingURL=clientUtils.d.ts.map