/* hamlive-oss — MIT License. See LICENSE. */

const crypto = require('node:crypto');
const { Types } = require('mongoose');
const validator = require('validator');

class RecoveryError extends Error {}
const refuse = message => { throw new RecoveryError(message); };

const validateRequest = input => {
    const callSign = String(input.callSign || '').trim().toUpperCase();
    const newEmail = String(input.newEmail || '').trim().toLowerCase();
    if (!/^(\d?[a-zA-Z]{1,3}|[a-zA-Z]\d[a-zA-Z]?)\d[a-zA-Z]{1,4}$/.test(callSign)
        || callSign.length > 7) refuse('Enter a valid callsign.');
    if (!/^[a-f0-9]{24}$/i.test(input.accountId || '')) refuse('An exact account ObjectId is required.');
    if (!validator.isEmail(newEmail)) refuse('Enter a valid replacement email.');
    if (!input.database) refuse('An explicit database name is required.');
    return { ...input, callSign, newEmail, accountId: input.accountId.toLowerCase() };
};

const recoveryPlan = async (db, input, session) => {
    const request = validateRequest(input);
    if (db.databaseName !== request.database) refuse('Connected database does not match --database.');
    const options = session ? { session } : {};
    const profiles = db.collection('userprofiles');
    const original = await profiles.findOne({ _id: new Types.ObjectId(request.accountId), callSign: request.callSign }, options);
    if (!original) refuse('Account ID and callsign do not identify the same account.');
    if (original.locked || original.superUser || original.flaggedForDeletion) {
        refuse('Locked, privileged or deletion-pending accounts require separate review; recovery refused.');
    }
    if (!validator.isEmail(String(original.email || ''))) refuse('Original account has an invalid email; review it separately.');
    if (original.email.trim().toLowerCase() === request.newEmail) refuse('Replacement email already belongs to this account.');
    if (!Number.isSafeInteger(original.authVersion || 0) || (original.authVersion || 0) < 0
        || (original.authVersion || 0) >= Number.MAX_SAFE_INTEGER) refuse('Invalid authentication version.');
    // Treat legacy email casing/whitespace as a conflict too. Never merge/delete a second account.
    const conflicts = await profiles.countDocuments({
        _id: { $ne: original._id },
        $expr: { $eq: [{ $toLower: { $trim: { input: { $ifNull: ['$email', ''] } } } }, request.newEmail] }
    }, options);
    if (conflicts) refuse('Replacement email belongs to another account. Resolve that account separately; no automatic merge or deletion is allowed.');
    const indexes = await profiles.indexes();
    if (!indexes.some(i => i.unique && i.key.email === 1 && Object.keys(i.key).length === 1 && !i.partialFilterExpression)) {
        refuse('Required unique email index is missing.');
    }
    const confirmation = crypto.createHash('sha256').update(JSON.stringify({
        database: db.databaseName, original, newEmail: request.newEmail
    })).digest('hex');
    return { request, original, confirmation };
};

const executeRecovery = async (connection, input) => {
    const request = validateRequest(input);
    if (request.verifiedOwner !== true || request.verifiedNewEmail !== true || request.maintenanceConfirmed !== true) {
        refuse('Owner verification, replacement-mailbox verification and maintenance confirmation are all required.');
    }
    for (const key of ['operator', 'caseRef', 'verification']) {
        if (typeof request[key] !== 'string' || request[key].trim().length < 3 || request[key].length > 1000) {
            refuse(`Supply a meaningful ${key} (3–1000 characters); do not include identity documents or secrets.`);
        }
    }
    if (!/^[a-f0-9]{64}$/.test(request.confirm || '')) refuse('Supply the confirmation digest from a fresh dry run.');
    const session = await connection.startSession();
    let result;
    try {
        await session.withTransaction(async () => {
            const { original, confirmation } = await recoveryPlan(connection.db, request, session);
            if (confirmation !== request.confirm) refuse('Plan changed since dry run. Review a new dry run before executing.');
            const now = new Date();
            const auditId = new Types.ObjectId();
            const version = (original.authVersion || 0) + 1;
            await connection.db.collection('accountrecoveries').insertOne({
                _id: auditId, occurredAt: now, operator: request.operator.trim(), caseRef: request.caseRef.trim(),
                verification: request.verification.trim(), verifiedOwner: true, verifiedNewEmail: true,
                maintenanceConfirmed: true, confirmation, accountId: original._id,
                callSign: original.callSign, newEmail: request.newEmail, authVersion: version,
                before: original
            }, { session });
            const update = await connection.db.collection('userprofiles').updateOne({
                _id: original._id, email: original.email, callSign: original.callSign
            }, {
                $set: { email: request.newEmail, authVersion: version, updatedAt: now },
                $unset: { googleId: '' }
            }, { session });
            if (update.matchedCount !== 1) refuse('Account changed during recovery. No changes committed.');
            await connection.db.collection('magiclogintokens').deleteMany({
                destination: { $in: [original.email, original.email.trim().toLowerCase(), request.newEmail] }
            }, { session });
            result = { auditId: String(auditId), accountId: String(original._id), callSign: original.callSign, authVersion: version };
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
        return result;
    } finally {
        await session.endSession();
    }
};

module.exports = { RecoveryError, validateRequest, recoveryPlan, executeRecovery };
