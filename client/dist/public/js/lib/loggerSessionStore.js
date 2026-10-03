import { LiveNetReactiveStore } from '#@client/lib/stores.js';
import { createLogger } from '#@client/lib/logger.js';
import { clearLoggerSession, prepareLoggerSession } from '#@client/lib/loggerSession.js';
const logger = createLogger('lib/loggerSessionStore.ts');
export class LoggerSessionReactiveStore extends LiveNetReactiveStore {
    npid;
    sessionPrepared = false;
    resolveLoggerReady;
    loggerReady = new Promise(resolve => {
        this.resolveLoggerReady = resolve;
    });
    constructor(endPoint, npid) {
        super(endPoint, true);
        this.npid = npid;
    }
    async newData() {
        if (!this.sessionPrepared && this.mainCache) {
            try {
                prepareLoggerSession(window.localStorage, this.npid, this.mainCache.net.createdAt);
            }
            catch (error) {
                logger.warn(`Unable to prepare logger session: ${String(error)}`);
            }
            this.sessionPrepared = true;
            this.resolveLoggerReady();
        }
        await super.newData();
    }
    onNetClose() {
        try {
            clearLoggerSession(window.localStorage, this.npid);
        }
        catch (error) {
            logger.warn(`Unable to clear logger session: ${String(error)}`);
        }
    }
}
//# sourceMappingURL=loggerSessionStore.js.map