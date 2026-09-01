/* hamlive-oss — MIT License. See LICENSE. */

const { modelMaker } = require('../lib/modelMaker');
const { Schema } = require('mongoose');

const fieldRevisionSchema = new Schema({
    value: { type: String, default: '', maxlength: 80 },
    revision: { type: Number, default: 0, min: 0 },
    editorCallSign: { type: String, default: '' },
    editorUserId: { type: String, default: '' },
    serverUpdatedAt: { type: Date, default: null },
    origin: { type: String, enum: ['manual', 'qrz', 'legacy'], default: 'legacy' }
}, { _id: false });

const stationNameOverrideSchema = new Schema(
    {
        callSign: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true
        },
        displayName: { type: String, trim: true, maxlength: 80 },
        updatedBy: { type: String, trim: true, uppercase: true },
        fields: {
            name: { type: fieldRevisionSchema, default: () => ({}) },
            location: { type: fieldRevisionSchema, default: () => ({}) }
        }
    },
    { timestamps: true }
);

module.exports = {
    getStationNameOverride: db => modelMaker({ db, m: 'StationNameOverride', s: stationNameOverrideSchema }),
    stationNameOverrideSchema,
    fieldRevisionSchema
};
