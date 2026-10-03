/* hamlive-oss — MIT License. See LICENSE. */

import { EndPointClient } from '#@client/lib/clientUtils.js';
import { LiveNetReactiveStore } from '#@client/lib/stores.js';
import { createLogger } from '#@client/lib/logger.js';
import { clearLoggerSession, prepareLoggerSession } from '#@client/lib/loggerSession.js';

const logger = createLogger('lib/loggerSessionStore.ts');

export class LoggerSessionReactiveStore extends LiveNetReactiveStore {
    private sessionPrepared = false;
    private resolveLoggerReady!: () => void;
    public readonly loggerReady = new Promise<void>(resolve => {
        this.resolveLoggerReady = resolve;
    });

    public constructor(endPoint: EndPointClient, private readonly npid: string) {
        super(endPoint, true);
    }

    protected override async newData(): Promise<void> {
        if (!this.sessionPrepared && this.mainCache) {
            try {
                prepareLoggerSession(window.localStorage, this.npid, this.mainCache.net.createdAt);
            } catch (error) {
                logger.warn(`Unable to prepare logger session: ${String(error)}`);
            }
            this.sessionPrepared = true;
            this.resolveLoggerReady();
        }
        await super.newData();
    }

    protected override onNetClose(): void {
        try {
            clearLoggerSession(window.localStorage, this.npid);
        } catch (error) {
            logger.warn(`Unable to clear logger session: ${String(error)}`);
        }
    }
}
