import { EndPointClient } from '#@client/lib/clientUtils.js';
import { LiveNetReactiveStore } from '#@client/lib/stores.js';
export declare class LoggerSessionReactiveStore extends LiveNetReactiveStore {
    private readonly npid;
    private sessionPrepared;
    private resolveLoggerReady;
    readonly loggerReady: Promise<void>;
    constructor(endPoint: EndPointClient, npid: string);
    protected newData(): Promise<void>;
    protected onNetClose(): void;
}
//# sourceMappingURL=loggerSessionStore.d.ts.map