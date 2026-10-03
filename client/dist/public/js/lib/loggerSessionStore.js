import { LiveNetReactiveStore } from '#@client/lib/stores.js';
import { createLogger } from '#@client/lib/logger.js';
import { clearLoggerSession, prepareLoggerSession } from '#@client/lib/loggerSession.js';
const logger = createLogger('lib/loggerSessionStore.ts');
export class LoggerSessionReactiveStore extends LiveNetReactiveStore {
    npid;
    sessionCreatedAt = null;
    resolveLoggerReady;
    loggerReady = new Promise(resolve => {
        this.resolveLoggerReady = resolve;
    });
    constructor(endPoint, npid) {
        super(endPoint, true);
        this.npid = npid;
    }
    async newData() {
        const createdAt = this.mainCache?.net.createdAt;
        if (createdAt !== undefined && this.sessionCreatedAt !== String(createdAt)) {
            const replacingSession = this.sessionCreatedAt !== null;
            try {
                prepareLoggerSession(window.localStorage, this.npid, createdAt);
            }
            catch (error) {
                logger.warn(`Unable to prepare logger session: ${String(error)}`);
            }
            this.sessionCreatedAt = String(createdAt);
            if (replacingSession) {
                window.location.reload();
                return;
            }
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