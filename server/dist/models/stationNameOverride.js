/* hamlive-oss — MIT License. See LICENSE. */

const { modelMaker } = require('../lib/modelMaker');
const { Schema } = require('mongoose');

const stationNameOverrideSchema = new Schema(
    {
        callSign: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true
        },
        displayName: {
            type: String,
            required: true,
            trim: true,
            maxlength: 80
        },
        updatedBy: {
            type: String,
            required: true,
            trim: true,
            uppercase: true
        }
    },
    { timestamps: true }
);

module.exports = {
    getStationNameOverride: db => modelMaker({ db, m: 'StationNameOverride', s: stationNameOverrideSchema }),
    stationNameOverrideSchema
};
