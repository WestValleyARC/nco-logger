import { isServerInfo } from '#@client/types/commonTypesupport.js';
export const serverInfo = (() => {
    const metaElem = document.querySelector('#serverInfo');
    if (!metaElem) {
        throw new Error('serverInfo() could not find HTMLElement with id #serverInfo');
    }
    const { dataset } = metaElem;
    if (!(typeof dataset['ts'] === 'string')) {
        throw new Error(`serverInfo(): expected ts string for parseInt(), but received ${dataset['ts']}`);
    }
    const si = {
        ...dataset,
        requestRateFactor: parseInt(dataset['requestRateFactor'] || '5'),
        httpClientTimeout: parseInt(dataset['httpClientTimeout'] || '2000'),
        awayInMs: parseInt(dataset['awayInMs'] || '20000'),
        isLoggedIn: dataset['isLoggedIn'] === 'true',
        newAccount: dataset['newAccount'] === 'true',
        callSign: dataset['callSign'] || null,
        userId: dataset['userId'] || null,
        displayName: dataset['displayName'] || null,
        chat: dataset['chat'] === 'true',
        ts: new Date(parseInt(dataset['ts']))
    };
    if (isServerInfo(si)) {
        if (si.nodeEnv === 'development') {
            console.table(si);
        }
        else {
            console.table(si);
        }
        return si;
    }
    else {
        throw new Error('serverInfo(): serverInfo type validation error');
    }
})();
//# sourceMappingURL=serverInfo.js.map