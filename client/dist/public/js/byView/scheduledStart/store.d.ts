import { EndPointClient } from '#@client/lib/clientUtils.js';
import { ReactiveStore } from '#@client/lib/stores.js';
import { EndPointResponse } from '#@client/types/commonTypes.js';
interface OpeningResponse extends EndPointResponse {
    title: string;
    startAt: string;
    status: string;
}
export type RoomOpening = 'early' | 'scheduled';
export declare class ScheduledOpeningStore extends ReactiveStore<OpeningResponse> {
    private readonly prepareEndpoint;
    constructor(endpoint: EndPointClient, prepareEndpoint: EndPointClient);
    protected isValidStoreData(value: unknown): value is OpeningResponse;
    protected newData(): Promise<void>;
    open(roomOpening: RoomOpening): Promise<string>;
}
export {};
//# sourceMappingURL=store.d.ts.map