/* hamlive-oss — MIT License. See LICENSE. */

const { Schema } = require('mongoose');
const { modelMaker } = require('../lib/modelMaker');

const magicLoginTokenSchema = new Schema({
    identityHash: { type: String, required: true, unique: true },
    tokenDigest: { type: String, required: true, unique: true },
    destination: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true });

module.exports = {
    getMagicLoginToken: db => modelMaker({ db, m: 'MagicLoginToken', s: magicLoginTokenSchema }),
    magicLoginTokenSchema
};
