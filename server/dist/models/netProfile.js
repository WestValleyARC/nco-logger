/* hamlive-oss — MIT License. See LICENSE. */
const { modelMaker } = require('../lib/modelMaker');
const { Schema } = require('mongoose');

const CONNECTION_TYPES = ['FM', 'HF', 'AllStarLink', 'EchoLink', 'DMR', 'D-STAR', 'YSF', 'P25', 'M17', 'NXDN', 'Zello', 'Other', 'Legacy'];
const HF_MODES = ['SSB', 'USB', 'LSB', 'CW', 'AM', 'Digital', 'Other'];
const optionalConnectionValue = maxlength => ({ type: String, trim: true, maxlength });

const connectionSchema = new Schema(
    {
        type: { type: String, required: true, enum: CONNECTION_TYPES },
        frequency: optionalConnectionValue(50),
        tone: optionalConnectionValue(50),
        operation: { type: String, trim: true, enum: ['Repeater', 'Simplex'] },
        offset: optionalConnectionValue(50),
        mode: { type: String, trim: true, enum: HF_MODES },
        node: optionalConnectionValue(100),
        callsign: optionalConnectionValue(50),
        talkgroup: optionalConnectionValue(100),
        colorCode: optionalConnectionValue(50),
        reflector: optionalConnectionValue(100),
        module: optionalConnectionValue(50),
        room: optionalConnectionValue(100),
        channel: optionalConnectionValue(100),
        label: optionalConnectionValue(100),
        value: optionalConnectionValue(200)
    },
    { _id: true }
);

connectionSchema.pre('validate', function validateConnection(next) {
    const requireField = (field, message) => {
        if (!this[field]) this.invalidate(field, message);
    };
    switch (this.type) {
        case 'FM':
            requireField('frequency', 'FM connections require frequency');
            if (this.operation === 'Simplex') this.offset = undefined;
            break;
        case 'HF':
            requireField('frequency', 'HF connections require frequency');
            break;
        case 'AllStarLink':
            requireField('node', 'AllStarLink connections require node');
            break;
        case 'EchoLink':
            if (!this.callsign && !this.node) this.invalidate('callsign', 'EchoLink connections require callsign or node');
            break;
        case 'DMR':
        case 'P25':
            requireField('talkgroup', `${this.type} connections require talkgroup`);
            break;
        case 'D-STAR':
            requireField('reflector', 'D-STAR connections require reflector');
            break;
        case 'M17':
            requireField('reflector', 'M17 connections require reflector');
            break;
        case 'YSF':
            if (!this.room && !this.reflector) this.invalidate('room', 'YSF connections require room or reflector');
            break;
        case 'NXDN':
            requireField('talkgroup', 'NXDN connections require talkgroup');
            break;
        case 'Zello':
            requireField('channel', 'Zello connections require channel');
            break;
        case 'Other':
            requireField('label', 'Other connections require label');
            requireField('value', 'Other connections require value');
            break;
        case 'Legacy':
            requireField('value', 'Legacy connections require value');
            break;
    }
    next();
});

const netProfileSchema = new Schema(
    {
        title: {
            type: String,
            required: [true, 'Net Title Required'],
            trim: true,
            minlength: 4,
            maxlength: 100,
            validate: {
                validator: function (v) {
                    return /^[\p{L}\p{N} @|_#*&/+\-().,':!]+$/u.test(v);
                },
                message: 'net title format did not pass validation'
            }
        },
        frequency: {
            type: String,
            maxlength: 20,
            validate: {
                validator: function (v) {
                    if (v === '') {
                        return true;
                    }
                    return /^\d+[.]\d+(?:([.]\d+))?$/.test(v);
                },
                message: 'frequency format did not pass validation'
            }
        },
        mode: {
            type: String,
            enum: {
                values: [
                    'LSB',
                    'USB',
                    'AM',
                    'CW',
                    'FM',
                    'RTTY',
                    'FSQ',
                    'PSK-31',
                    'FreeDV',
                    'Reflector',
                    'Olivia',
                    'Hell',
                    'JS8Call',
                    'CUSTOM'
                ],
                message: '{VALUE} not in valid mode list'
            },
            required: [true, 'Mode Required']
        },
        modeDetails: {
            type: String,
            required: false,
            maxlength: 15,
            validate: {
                validator: function (v) {
                    if (v === '') {
                        return true;
                    }
                    return /^\w+(?:[&. ]*\w+)*$/.test(v);
                },
                message: 'mode details contains invalid characters'
            }
        },
        connections: { type: [connectionSchema], default: undefined },
        notes: {
            type: String,
            required: false,
            maxlength: 320,
            default: ''
        },
        owners: [
            {
                type: Schema.Types.ObjectId,
                ref: 'UserProfile',
                required: [true, 'user upid for owners required']
            }
        ],
        followers: [
            {
                type: Schema.Types.ObjectId,
                ref: 'UserProfile'
            }
        ],
        liveNet: {
            type: Schema.Types.ObjectId,
            ref: 'LiveNet'
        },
        autoIn: { type: Boolean, default: false },
        permanent: { type: Boolean, default: false },
        restrictedSigReports: { type: Boolean, default: false },
        invisible: { type: Boolean, default: false }
    },
    { timestamps: true }
);

const getNetProfileConnections = profile => {
    if (Array.isArray(profile?.connections) && profile.connections.length) return profile.connections;
    if (profile?.mode === 'Reflector' && typeof profile.modeDetails === 'string' && profile.modeDetails.trim()) {
        return [{ type: 'Legacy', value: profile.modeDetails }];
    }
    return [];
};

const removeLegacyTitleUniqueIndex = async NetProfile => {
    const indexes = await NetProfile.collection.indexes();
    const legacy = indexes.find(index =>
        index.unique === true && index.key?.title === 1 && Object.keys(index.key).length === 1
    );
    if (!legacy) return false;
    await NetProfile.collection.dropIndex(legacy.name);
    return true;
};

module.exports = {
    getNetProfile: db => modelMaker({ db, m: 'NetProfile', s: netProfileSchema }),
    netProfileSchema,
    connectionSchema,
    CONNECTION_TYPES,
    getNetProfileConnections,
    removeLegacyTitleUniqueIndex
};
