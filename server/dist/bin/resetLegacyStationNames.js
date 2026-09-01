#!/usr/bin/env node
/* hamlive-oss — MIT License. See LICENSE. */

const mongoose = require('mongoose');
const { conf } = require('../lib/configLib');
const { stripLegacyNameState } = require('../lib/legacyStationNameCleanup');
const { getLiveNet } = require('../models/liveNet');
const { getQrzCache } = require('../models/qrzCache');
const { getStationInteraction } = require('../models/stationInteraction');
const { getStationNameOverride } = require('../models/stationNameOverride');

const apply = process.argv.includes('--apply');

(async () => {
    mongoose.set('strictQuery', true);
    await mongoose.connect(conf.dburi);
    const LiveNet = getLiveNet(mongoose.connection);
    const QrzCache = getQrzCache(mongoose.connection);
    const StationInteraction = getStationInteraction(mongoose.connection);
    const StationNameOverride = getStationNameOverride(mongoose.connection);
    const liveNets = await LiveNet.find({ 'loggerState.details': { $exists: true } });
    const interactionIds = new Set();
    let loggerStates = 0;
    let legacyNameEntries = 0;
    for (const liveNet of liveNets) {
        const result = stripLegacyNameState(liveNet.loggerState);
        if (!result.changed) continue;
        loggerStates++;
        legacyNameEntries += result.affectedCallSigns.length;
        for (const callSign of result.affectedCallSigns) {
            const interactionId = liveNet.lookupTable.get(callSign)?.stationInteraction;
            if (interactionId) interactionIds.add(String(interactionId));
        }
        if (apply) {
            liveNet.markModified('loggerState');
            await liveNet.save();
        }
    }
    const [cacheEntries, persistentOverrides] = await Promise.all([
        QrzCache.countDocuments({}),
        StationNameOverride.countDocuments({})
    ]);
    if (apply) {
        if (interactionIds.size) {
            await StationInteraction.updateMany(
                { _id: { $in: [...interactionIds] } },
                { $unset: { displayName: 1 } }
            );
        }
        await Promise.all([QrzCache.deleteMany({}), StationNameOverride.deleteMany({})]);
    }
    console.log(JSON.stringify({
        mode: apply ? 'applied' : 'dry-run',
        loggerStates,
        legacyNameEntries,
        interactionsReset: interactionIds.size,
        qrzCacheEntriesRemoved: cacheEntries,
        persistentOverridesRemoved: persistentOverrides
    }));
    await mongoose.disconnect();
})().catch(async error => {
    console.error(error.message);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
});
