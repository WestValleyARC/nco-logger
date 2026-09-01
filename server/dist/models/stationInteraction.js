/* hamlive-oss — MIT License. See LICENSE. */
const { model, Schema, SchemaTypes } = require('mongoose');
const { modelMaker } = require('../lib/modelMaker');

const rstReportSchema = new Schema({
    r: {
        type: Number,
        min: [1, 'Readability cannot be less than 1 in (R)S'],
        max: [5, 'Readability cannot be greater than 5 in (R)S'],
        required: [true, 'Readability value required in RS']
    },
    s: {
        type: Number,
        min: [1, 'Strength cannot be less than 1 in R(S)'],
        max: [9, 'Strength cannot be greater than 9 in R(S)'],
        required: [true, 'Signal strength value required in RS']
    },
    t: {
        type: Number,
        min: [1, 'Tone cannot be less than 1 in RS(T)'],
        max: [9, 'Tone cannot be greater than 9 in RS(T)'],
        required: false
    }
});

const sigReportSchema = new Schema({
    calculated: String,
    rst: {
        type: Map,
        of: rstReportSchema
    }
});

const stationInteractionSchema = new Schema(
    {
        checkedState: {
            type: Boolean,
            default: null,
            enum: {
                values: [true, false, null],
                message: '{VALUE} is not supported for checkedState'
            }
        },
        role: {
            type: String,
            default: 'netuser',
            enum: {
                values: ['netlogger', 'netrelay', 'netcontrol', 'netuser'],
                message: '{VALUE} is not supported for netrole'
            }
        },
        callSign: {
            type: String,
            required: [true, 'Callsign required for station interaction doc']
        },
        email: String,
        displayName: String,
        photo: String,
        location: String,
        qrzLookupStatus: {
            type: String,
            enum: [
                'skipped-local-profile', 'immediate-success', 'deferred', 'later-success',
                'timeout', 'quota', 'auth-session-failure', 'not-found', 'disabled',
                'network-failure', 'malformed-response', 'service-error', 'no-data'
            ]
        },
        qrzLookupAt: Date,
        createdBy: {
            type: String,
            enum: {
                values: ['user', 'admin'],
                message: 'StationInteraction model: {VALUE} is not supported created-by type'
            },
            required: [true, 'Created-by required']
        },
        checkedInAt: {
            type: Date,
            default: null
        },
        lastSeen: Date,
        hand: {
            type: Boolean,
            default: false
        },
        manualPushCount: {
            type: Number,
            default: 0
        },
        highlight: {
            type: Boolean,
            default: false
        },
        chatEnabled: {
            type: Boolean,
            default: true
        },
        userProfile: {
            type: Schema.Types.ObjectId,
            ref: 'UserProfile'
        },
        liveNet: {
            type: Schema.Types.ObjectId,
            ref: 'LiveNet'
        },
        netProfile: {
            type: Schema.Types.ObjectId,
            ref: 'NetProfile',
            required: [true, 'netprofile obj required by interactions map']
        },
        sigReports: {
            type: sigReportSchema
        }
    },
    { timestamps: true }
);

module.exports = {
    getStationInteraction: db => modelMaker({ db, m: 'StationInteraction', s: stationInteractionSchema }),
    stationInteractionSchema
};
