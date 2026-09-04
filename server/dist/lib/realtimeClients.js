"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.realtimeClients = exports.RealtimeClients = void 0;
const express_sse_ts_1 = __importDefault(require("express-sse-ts"));
const logger_js_1 = require("#@server/lib/logger.js");
const changeStreamClient_js_1 = require("#@server/lib/changeStreamClient.js");
const commonTypesupport_js_1 = require("#@server/types/commonTypesupport.js");
const dynoId = process.env['INSTANCE_ID'] || process.env['DYNO'] || 'node';
class RealtimeClients {
    middlewareMap = new Map();
    pushStates = new Map();
    dataGenerator = null;
    async init(dataGenerator) {
        this.dataGenerator = dataGenerator;
        try {
            const collection = (await (0, changeStreamClient_js_1.getChangeStreamDb)()).collection('stationinteractions');
            let changeStream = this.createChangeStream(collection);
            let retryDelay = 1000;
            changeStream.on('error', error => {
                logger_js_1.logger.error('RTC: Error in MongoDB change stream: ' + error.toString());
                setTimeout(() => {
                    changeStream = this.createChangeStream(collection);
                    retryDelay *= 2;
                }, retryDelay);
            });
            const PUSH_INTERVAL_FLOOR_MS = 10000;
            const LOOP_EXEC_TIME_MS = 500;
            const SSE_IDLE_TIMEOUT_MS = Number(process.env['SSE_IDLE_TIMEOUT_MS']) || 55000;
            const AWAY_BUFFER_PCT = 20;
            let pushIntervalMs = PUSH_INTERVAL_FLOOR_MS;
            const schedulePush = () => {
                const npidsArr = Array.from(this.middlewareMap.keys());
                if (npidsArr.length) {
                    logger_js_1.logger.debug(`RTC(${dynoId}): Check if presence push is needed for npids: ${JSON.stringify(npidsArr)}`);
                    this.middlewareMap.forEach((sseItem, npid) => {
                        const { flexOpts: { awayInMs }, lastPush } = sseItem;
                        pushIntervalMs = Math.max(awayInMs * (1 - AWAY_BUFFER_PCT / 100), PUSH_INTERVAL_FLOOR_MS);
                        pushIntervalMs > SSE_IDLE_TIMEOUT_MS &&
                            logger_js_1.logger.error(`pushIntervalMs (${pushIntervalMs}) exceeds the SSE idle timeout (${SSE_IDLE_TIMEOUT_MS}ms), risking proxy/load-balancer disconnects.`);
                        if (lastPush === null || Date.now() - lastPush + LOOP_EXEC_TIME_MS > pushIntervalMs) {
                            logger_js_1.logger.info(`RTC(${dynoId}): Starting presence push (every ${pushIntervalMs / 1000}s) to all clients of npid ${npid}`);
                            this.push(npid, false).catch((error) => {
                                logger_js_1.logger.error(`RTC: Error with periodic presence push to npid ${npid}: ${error.toString()}`);
                            });
                        }
                    });
                }
                setTimeout(schedulePush, pushIntervalMs);
            };
            schedulePush();
        }
        catch (err) {
            logger_js_1.logger.error(String(err));
        }
    }
    createChangeStream(collection) {
        const changeStream = collection.watch([
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
        ], { fullDocument: 'updateLookup' });
        changeStream.on('change', this.handleChange.bind(this));
        changeStream.on('error', data => logger_js_1.logger.error(data));
        return changeStream;
    }
    handleChange(change) {
        if ('fullDocument' in change) {
            const { fullDocument } = change;
            if ('netProfile' in fullDocument) {
                const { netProfile } = fullDocument;
                const npid = netProfile.toHexString();
                logger_js_1.logger.info(`RTC(${dynoId}): ChangeStream request push to all clients of npid ${npid}`);
                this.push(npid).catch((err) => logger_js_1.logger.error(err));
            }
        }
    }
    push(npid, permitCachedResponse = false) {
        if (typeof npid !== 'string') {
            return Promise.reject(new Error('RTC push(): Invalid npid'));
        }
        const existingState = this.pushStates.get(npid);
        if (existingState) {
            existingState.rerunRequested = true;
            existingState.nextPermitCachedResponse &&= permitCachedResponse;
            return existingState.promise;
        }
        const state = {
            promise: Promise.resolve(),
            rerunRequested: false,
            nextPermitCachedResponse: permitCachedResponse
        };
        state.promise = Promise.resolve().then(async () => {
            try {
                do {
                    const nextPermitCachedResponse = state.nextPermitCachedResponse;
                    state.rerunRequested = false;
                    state.nextPermitCachedResponse = true;
                    await this.pushOnce(npid, nextPermitCachedResponse);
                } while (state.rerunRequested);
            }
            finally {
                this.pushStates.delete(npid);
            }
        });
        this.pushStates.set(npid, state);
        return state.promise;
    }
    async pushOnce(npid, permitCachedResponse) {
        if (!this.middlewareMap.has(npid)) {
            logger_js_1.logger.info(`RTC(${dynoId}): This runtime-instance has no clients of net ${npid}, ignoring push() request`);
            logger_js_1.logger.info(`RTC(${dynoId}): This runtime-instance has only clients of NPIDs: ${JSON.stringify(Array.from(this.middlewareMap.keys()))}`);
            return;
        }
        const sseItem = this.middlewareMap.get(npid);
        const { sse, flexOpts } = sseItem;
        let data;
        if (this.dataGenerator) {
            try {
                data = await this.dataGenerator({
                    npid,
                    flexOpts,
                    permitCachedResponse
                });
            }
            catch (error) {
                if (error instanceof commonTypesupport_js_1.NetNotFoundError) {
                    logger_js_1.logger.info(`RTC(${dynoId}) push(): data generator responded with NetNotFound (${npid}), cleaning up SSE items`);
                    this.close(npid);
                    return;
                }
                else {
                    logger_js_1.logger.error(`RTC(${dynoId}): error in data generator for npid: ${npid}, error: ${error.toString()}`);
                }
            }
        }
        if ((0, commonTypesupport_js_1.isLiveNetDetailsResponse)(data)) {
            logger_js_1.logger.debug(`RTC(${dynoId}): Pushing data to all clients of net ${npid}`);
            sse.send(JSON.stringify(data));
            sseItem.lastPush = Date.now();
        }
        else {
            logger_js_1.logger.error(`RTC(${dynoId}): invalid data format from generator for npid: ${npid}, data: ${JSON.stringify(data)}`);
        }
    }
    close(npid) {
        const sseInfo = this.middlewareMap.get(npid);
        if (sseInfo) {
            sseInfo.sse.send(`Net ${npid} is closing`, 'net-close');
            logger_js_1.logger.info(`RTC(${dynoId}): Cleaning up SSE items for net ${npid}`);
        }
        this.middlewareMap.delete(npid);
    }
    middleware() {
        return (req, res, next) => {
            const { id: npid } = req.params;
            if (npid) {
                if (!this.middlewareMap.has(npid)) {
                    const flexOpts = res.locals['flexOpts'];
                    const sse = new express_sse_ts_1.default();
                    const mw = sse.init;
                    if ((0, commonTypesupport_js_1.isFlexOptions)(flexOpts)) {
                        this.middlewareMap.set(npid, {
                            mw,
                            sse,
                            flexOpts,
                            lastPush: null
                        });
                        return mw(req, res, next);
                    }
                    else {
                        throw new Error('RTC: flexOpts is not of type FlexOptions');
                    }
                }
                else {
                    return this.middlewareMap.get(npid).mw(req, res, next);
                }
            }
            else {
                throw new Error(`RTC(${dynoId}): unknown npid ${npid} from param, in middleware`);
            }
        };
    }
}
exports.RealtimeClients = RealtimeClients;
exports.realtimeClients = new RealtimeClients();
