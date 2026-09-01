/* hamlive-oss — MIT License. See LICENSE. */
const { Schema } = require('mongoose');
const { modelMaker } = require('../lib/modelMaker');
const uniqueValidator = require('mongoose-unique-validator');

const lookupTableSchema = new Schema({
    stationInteraction: {
        type: Schema.Types.ObjectId,
        ref: 'StationInteraction'
    }
});

const liveNetSchema = new Schema(
    {
        lookupTable: {
            type: Map,
            of: lookupTableSchema
        },
        netProfile: {
            type: Schema.Types.ObjectId,
            ref: 'NetProfile',
            required: [true, 'netprofile obj required by livenet']
        },
        occurrence: {
            type: Schema.Types.ObjectId,
            ref: 'ScheduledOccurrence',
            default: undefined
        },
        netControl: {
            type: Schema.Types.ObjectId,
            ref: 'UserProfile',
            required: [true, 'ncs userprofile obj required by livenet']
        },
        countdownTimer: {
            type: Number,
            min: 0,
            max: 120,
            default: 1
        },
        started: {
            type: Boolean,
            default: false
        },
        startedAt: {
            type: Date,
            default: null
        },
        closing: {
            type: Boolean,
            default: false
        },
        loggerState: {
            type: Schema.Types.Mixed,
            default: null
        },
        url: {
            type: String,
            required: [true, 'controller should provide url'],
            unique: true
        }
    },
    { timestamps: true }
);

liveNetSchema.plugin(uniqueValidator, {
    message: 'Attempted to start multiple nets at same URL'
});

liveNetSchema.index({ occurrence: 1 }, { unique: true, sparse: true });

module.exports = {
    getLiveNet: db => modelMaker({ db, m: 'LiveNet', s: liveNetSchema }),
    liveNetSchema
};
