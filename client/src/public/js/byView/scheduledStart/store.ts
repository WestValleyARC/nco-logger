import { EndPointClient } from '#@client/lib/clientUtils.js';
import { ReactiveStore } from '#@client/lib/stores.js';
import { EndPointResponse } from '#@client/types/commonTypes.js';
import { isEndPointResponse } from '#@client/types/commonTypesupport.js';

interface OpeningResponse extends EndPointResponse {
    title: string;
    startAt: string;
    status: string;
}
export type RoomOpening = 'early' | 'scheduled';

export class ScheduledOpeningStore extends ReactiveStore<OpeningResponse> {
    constructor(
        endpoint: EndPointClient,
        private readonly prepareEndpoint: EndPointClient
    ) {
        super(endpoint);
    }

    protected isValidStoreData(value: unknown): value is OpeningResponse {
        return (
            isEndPointResponse(value) &&
            'title' in value &&
            typeof value.title === 'string' &&
            'startAt' in value &&
            typeof value.startAt === 'string' &&
            'status' in value &&
            typeof value.status === 'string'
        );
    }

    protected async newData(): Promise<void> {}

    public async open(roomOpening: RoomOpening): Promise<string> {
        this.prepareEndpoint.data({ roomOpening });
        const result = await this.prepareEndpoint.create();
        if (
            !('liveNet' in result) ||
            !result.liveNet ||
            typeof result.liveNet !== 'object' ||
            !('url' in result.liveNet) ||
            typeof result.liveNet.url !== 'string' ||
            !result.liveNet.url.startsWith('/views/livenet/')
        ) {
            throw new Error('The server did not return a net room. Refresh and try again.');
        }
        return result.liveNet.url;
    }
}
