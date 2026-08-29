/* hamlive-oss — MIT License. See LICENSE. */

import { conf } from '#@server/lib/configLib.js';
const { dburi: dbUri, dbname: dbName } = conf;

// The change stream must watch the SAME database Mongoose writes to. Mongoose
// uses the database named in the connection URI path, so derive it from there
// and fall back to conf.dbname only if the URI has no path component.
const resolvedDbName = (() => {
    try {
        const fromUri = new URL(dbUri).pathname.replace(/^\//, '').split('?')[0];
        return fromUri || dbName;
    } catch {
        return dbName;
    }
})();
import SSE from 'express-sse-ts';
import { type NextFunction, type Request, type Response, type RequestHandler } from 'express';
import { ChangeStreamDocument, Collection, MongoClient, ObjectId } from 'mongodb';
import { logger } from '#@server/lib/logger.js';
import { FlexOptions } from '#@client/types/commonTypes.js';
import { isFlexOptions, isLiveNetDetailsResponse, NetNotFoundError } from '#@server/types/commonTypesupport.js';
// Dependency injection is used here to avoid a circular dependency with genLiveNetDetails.
// The type is imported, but the actual function is passed in via the init() method from the route.
import type { genLiveNetDetails } from '#@server/lib/controllers/liveNetHelpers.js';

interface SSEItems {
    mw: RequestHandler;
    sse: SSE;
    lastPush: number | null;
    flexOpts: FlexOptions;
}

const dynoId = process.env['INSTANCE_ID'] || process.env['DYNO'] || 'node';

export class RealtimeClients {
    private middlewareMap = new Map<string, SSEItems>();
    private dbClient: MongoClient;
    private dataGenerator: null | typeof genLiveNetDetails = null;

    constructor() {
        this.dbClient = new MongoClient(dbUri);
    }

    async init(dataGenerator: typeof genLiveNetDetails) {
        this.dataGenerator = dataGenerator;

        try {
            await this.dbClient.connect();

            const collection = this.dbClient.db(resolvedDbName).collection('stationinteractions');

            let changeStream = this.createChangeStream(collection);

            let retryDelay = 1000; // Start with a delay of 1 second

            changeStream.on('error', error => {
                logger.error('RTC: Error in MongoDB change stream: ' + error.toString());
                // Wait for a while before trying to reconnect
                setTimeout(() => {
                    // Then try to reconnect the change stream
                    changeStream = this.createChangeStream(collection);
                    // Double the delay for the next retry
                    retryDelay *= 2;
                }, retryDelay);
            });

            /*
            This code serves to:
            1. Maintain real-time presence information: Presence is inferred from the
               'lastSeen' value in the interaction document, but isn't stored there. To
               keep clients updated on others' present/away status, we push presence info
               at intervals less than 'awayInMs'.
            2. Keep the Server-Sent Events (SSE) connection active: many proxies and
               load balancers drop idle connections (commonly ~55s), so regular pushes
               prevent disconnection. Tune via the SSE_IDLE_TIMEOUT_MS env var.
            3. Trigger cleanup of SSE items in push() if the data generator returns
               NetNotFound.
            */

            // Constants
            const PUSH_INTERVAL_FLOOR_MS = 10000; // 10s
            const LOOP_EXEC_TIME_MS = 500; // 0.5s
            const SSE_IDLE_TIMEOUT_MS = Number(process.env['SSE_IDLE_TIMEOUT_MS']) || 55000; // proxy/LB idle timeout
            //This buffer % should come form flexOpts eventually (common between this file, presence.ts, liveNetController.js and frequency.js)
            const AWAY_BUFFER_PCT = 20; // 20% buffer for awayInMs

            let pushIntervalMs = PUSH_INTERVAL_FLOOR_MS;

            const schedulePush = () => {
                const npidsArr = Array.from(this.middlewareMap.keys());

                if (npidsArr.length) {
                    logger.debug(
                        `RTC(${dynoId}): Check if presence push is needed for npids: ${JSON.stringify(npidsArr)}`
                    );

                    this.middlewareMap.forEach((sseItem, npid) => {
                        const {
                            flexOpts: { awayInMs },
                            lastPush
                        } = sseItem;

                        pushIntervalMs = Math.max(awayInMs * (1 - AWAY_BUFFER_PCT / 100), PUSH_INTERVAL_FLOOR_MS); // 80% of awayInMs or 10s, whichever is greater
                        pushIntervalMs > SSE_IDLE_TIMEOUT_MS &&
                            logger.error(
                                `pushIntervalMs (${pushIntervalMs}) exceeds the SSE idle timeout (${SSE_IDLE_TIMEOUT_MS}ms), risking proxy/load-balancer disconnects.`
                            );

                        if (lastPush === null || Date.now() - lastPush + LOOP_EXEC_TIME_MS > pushIntervalMs) {
                            logger.info(
                                `RTC(${dynoId}): Starting presence push (every ${pushIntervalMs / 1000}s) to all clients of npid ${npid}`
                            );

                            this.push(npid, false).catch((error: Error) => {
                                logger.error(
                                    `RTC: Error with periodic presence push to npid ${npid}: ${error.toString()}`
                                );
                            });
                        }
                    });
                }

                setTimeout(schedulePush, pushIntervalMs);
            };

            schedulePush();
        } catch (err) {
            logger.error(String(err));
        }
    }

    /**
     * Creates a change stream on the specified collection to listen for specific changes.
     * The change stream will match the following criteria:
     * 1. Any insert operation.
     * 2. Any update operation where `manualPushCount` is updated, even if `lastSeen` is also updated.
     * 3. Any update operation where `lastSeen` is not updated.
     *
     * See liveNetHelpers.js (updateStationInteraction) for more information
     */
    createChangeStream(collection: Collection) {
        const changeStream = collection.watch(
            [
                {
                    $match: {
                        $or: [
                            { operationType: 'insert' },
                            {
                                operationType: 'update',
                                $or: [
                                    { 'updateDescription.updatedFields.manualPushCount': { $exists: true } },
                                    { 'updateDescription.updatedFields.lastSeen': { $exists: false } }
                                ]
                            }
                        ]
                    }
                }
            ],
            { fullDocument: 'updateLookup' }
        );

        changeStream.on('change', this.handleChange.bind(this));
        changeStream.on('error', data => logger.error(data));

        return changeStream;
    }

    private handleChange(change: ChangeStreamDocument) {
        if ('fullDocument' in change) {
            const { fullDocument } = change;
            if ('netProfile' in fullDocument) {
                const { netProfile } = fullDocument;

                const npid = (netProfile as ObjectId).toHexString();

                logger.info(`RTC(${dynoId}): ChangeStream request push to all clients of npid ${npid}`);
                this.push(npid).catch((err: Error) => logger.error(err));
            }
        }
    }

    async push(npid: string, permitCachedResponse = false): Promise<void> {
        if (typeof npid !== 'string') {
            throw new Error('RTC push(): Invalid npid');
        }

        if (!this.middlewareMap.has(npid)) {
            logger.info(`RTC(${dynoId}): This runtime-instance has no clients of net ${npid}, ignoring push() request`);

            logger.info(
                `RTC(${dynoId}): This runtime-instance has only clients of NPIDs: ${JSON.stringify(
                    Array.from(this.middlewareMap.keys())
                )}`
            );

            return;
        }

        const sseItem = this.middlewareMap.get(npid)!;
        const { sse, flexOpts } = sseItem;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        let data;
        if (this.dataGenerator) {
            try {
                data = await this.dataGenerator({
                    npid,
                    flexOpts,
                    permitCachedResponse
                });
            } catch (error) {
                if (error instanceof NetNotFoundError) {
                    logger.info(
                        `RTC(${dynoId}) push(): data generator responded with NetNotFound (${npid}), cleaning up SSE items`
                    );
                    this.close(npid);
                    return;
                } else {
                    logger.error(
                        `RTC(${dynoId}): error in data generator for npid: ${npid}, error: ${(error as Error).toString()}`
                    );
                }
            }
        }

        if (isLiveNetDetailsResponse(data)) {
            logger.debug(`RTC(${dynoId}): Pushing data to all clients of net ${npid}`);
            sse.send(JSON.stringify(data));
            // Update the lastPush timestamp
            sseItem.lastPush = Date.now();
        } else {
            logger.error(
                `RTC(${dynoId}): invalid data format from generator for npid: ${npid}, data: ${JSON.stringify(data)}`
            );
        }
    }

    close(npid: string): void {
        const sseInfo = this.middlewareMap.get(npid);
        if (sseInfo) {
            // Send a close message to the clients
            sseInfo.sse.send(`Net ${npid} is closing`, 'net-close');
            logger.info(`RTC(${dynoId}): Cleaning up SSE items for net ${npid}`);
        }

        this.middlewareMap.delete(npid);
    }
    middleware() {
        return (req: Request, res: Response, next: NextFunction) => {
            const { id: npid } = req.params;

            if (npid) {
                if (!this.middlewareMap.has(npid)) {
                    const flexOpts = res.locals['flexOpts'] as FlexOptions;
                    const sse = new SSE();
                    const mw = sse.init;

                    if (isFlexOptions(flexOpts)) {
                        // This might be dangerous, as flexOpts can be overwritten on a per-user account basis.
                        // The controller limits users to changing only email and chat preferences themselves,
                        // but it could be improved upon in principle. It lends itself to future bugs at the very least.
                        //
                        // Let's harden this by refactoring getFlexOptionsByUser() in serverUtils.js to getFlexOptions().
                        // It should take an optional user object and be called directly rather than using res.locals['flexOpts'].
                        // Also, have getFlexOptions() return a frozen object. Lastly, update the type definition for FlexOptions
                        // to make the properties readonly.
                        this.middlewareMap.set(npid, {
                            mw,
                            sse,
                            flexOpts,
                            lastPush: null
                        });

                        return mw(req, res, next);
                    } else {
                        throw new Error('RTC: flexOpts is not of type FlexOptions');
                    }
                } else {
                    return this.middlewareMap.get(npid)!.mw(req, res, next);
                }
            } else {
                throw new Error(`RTC(${dynoId}): unknown npid ${npid} from param, in middleware`);
            }
        };
    }
}

export const realtimeClients = new RealtimeClients();
