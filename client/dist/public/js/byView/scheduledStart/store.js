import { ReactiveStore } from '#@client/lib/stores.js';
import { isEndPointResponse } from '#@client/types/commonTypesupport.js';
export class ScheduledOpeningStore extends ReactiveStore {
    prepareEndpoint;
    constructor(endpoint, prepareEndpoint) {
        super(endpoint);
        this.prepareEndpoint = prepareEndpoint;
    }
    isValidStoreData(value) {
        return (isEndPointResponse(value) &&
            'title' in value &&
            typeof value.title === 'string' &&
            'startAt' in value &&
            typeof value.startAt === 'string' &&
            'status' in value &&
            typeof value.status === 'string');
    }
    async newData() { }
    async open(roomOpening) {
        this.prepareEndpoint.data({ roomOpening });
        const result = await this.prepareEndpoint.create();
        if (!('liveNet' in result) ||
            !result.liveNet ||
            typeof result.liveNet !== 'object' ||
            !('url' in result.liveNet) ||
            typeof result.liveNet.url !== 'string' ||
            !result.liveNet.url.startsWith('/views/livenet/')) {
            throw new Error('The server did not return a net room. Refresh and try again.');
        }
        return result.liveNet.url;
    }
}
//# sourceMappingURL=store.js.map