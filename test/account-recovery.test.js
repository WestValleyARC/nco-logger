const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createTestDatabase } = require('./helpers/testDatabase');
const { recoveryPlan, executeRecovery } = require('../server/dist/lib/accountRecovery');
const { sessionIdentity, userForSession } = require('../server/dist/lib/sessionIdentity');

test('account recovery is explicit, atomic and preserves identity while revoking access', async t => {
    const database = await createTestDatabase({ databaseName: 'account_recovery_test', replicaSet: true });
    const connection = await mongoose.createConnection(database.uri, { autoIndex: false, autoCreate: false }).asPromise();
    t.after(async () => { await connection.close(); await database.cleanup(); });
    const db = connection.db;
    const profiles = db.collection('userprofiles');
    await profiles.createIndex({ email: 1 }, { unique: true });
    await profiles.createIndex({ callSign: 1 }, { unique: true, sparse: true });
    const id = new mongoose.Types.ObjectId();
    const original = { _id: id, callSign: 'AB1CDE', email: 'old@example.test', googleId: 'old-provider-id',
        displayName: 'Operator', myNets: [new mongoose.Types.ObjectId()], following: [new mongoose.Types.ObjectId()],
        initialReg: new mongoose.Types.ObjectId(), policyConsent: true, lastAuthVia: 'email',
        updatedAt: new Date('2026-01-01'), createdAt: new Date('2025-01-01') };
    await profiles.insertOne(original);
    const request = { database: db.databaseName, accountId: String(id), callSign: 'ab1cde', newEmail: 'NEW@example.test' };
    const evidence = { operator: 'operator-test', caseRef: 'case-123', verification: 'Known member verified independently; replacement mailbox challenge completed.',
        verifiedOwner: true, verifiedNewEmail: true, maintenanceConfirmed: true };
    const snapshot = await profiles.findOne({ _id: id });
    const plan = await recoveryPlan(db, request);
    const cli = path.join(__dirname, '../server/dist/bin/recoverAccount.js');
    const cliArgs = [cli, '--database', db.databaseName, '--account-id', String(id),
        '--call-sign', original.callSign, '--new-email', 'new@example.test'];
    const cliEnv = { ...process.env, MONGODB_URI: database.uri };
    assert.match(execFileSync(process.execPath, cliArgs, { env: cliEnv, encoding: 'utf8' }), /"dryRun": true/);
    assert.throws(() => execFileSync(process.execPath, [...cliArgs, '--execute', '--confirm', plan.confirmation],
        { env: cliEnv, stdio: 'pipe' }), /Command failed/);
    assert.equal(plan.request.newEmail, 'new@example.test');
    assert.deepEqual(await profiles.findOne({ _id: id }), snapshot, 'dry run is read only');
    assert.equal(await db.collection('accountrecoveries').countDocuments(), 0);

    for (const override of [{ database: 'wrong_db' }, { callSign: 'W1OTHER' }, { accountId: 'bad' }, { newEmail: original.email }]) {
        await assert.rejects(recoveryPlan(db, { ...request, ...override }));
    }
    for (const flag of ['verifiedOwner', 'verifiedNewEmail', 'maintenanceConfirmed']) {
        await assert.rejects(executeRecovery(connection, { ...request, ...evidence, confirm: plan.confirmation, [flag]: false }));
    }
    await assert.rejects(executeRecovery(connection, { ...request, ...evidence, confirm: '0'.repeat(64) }), /Plan changed/);
    for (const flag of ['locked', 'superUser', 'flaggedForDeletion']) {
        await profiles.updateOne({ _id: id }, { $set: { [flag]: true } });
        await assert.rejects(recoveryPlan(db, request), /separate review/);
        await profiles.updateOne({ _id: id }, { $unset: { [flag]: '' } });
    }
    const other = { _id: new mongoose.Types.ObjectId(), email: ' NEW@example.test ', callSign: 'W1OTHER' };
    await profiles.insertOne(other);
    await assert.rejects(recoveryPlan(db, request), /another account/);
    await profiles.deleteOne({ _id: other._id });

    const fresh = await recoveryPlan(db, request);
    // Cause failure *after* the audit insert and profile update to prove rollback.
    const nativeCollection = db.collection.bind(db);
    db.collection = name => name === 'magiclogintokens'
        ? { deleteMany: async () => { throw new Error('simulated token-store failure'); } }
        : nativeCollection(name);
    try {
        await assert.rejects(executeRecovery(connection, { ...request, ...evidence, confirm: fresh.confirmation }), /token-store/);
    } finally { db.collection = nativeCollection; }
    assert.deepEqual(await profiles.findOne({ _id: id }), snapshot);
    assert.equal(await db.collection('accountrecoveries').countDocuments(), 0);

    await db.collection('magiclogintokens').insertMany([
        { destination: original.email }, { destination: 'new@example.test' }, { destination: 'unrelated@example.test' }
    ]);
    const result = await executeRecovery(connection, { ...request, ...evidence, confirm: fresh.confirmation });
    const recovered = await profiles.findOne({ _id: id });
    assert.equal(recovered.email, 'new@example.test');
    assert.equal(recovered.authVersion, 1);
    assert.equal(recovered.googleId, undefined);
    for (const key of ['_id', 'callSign', 'myNets', 'following', 'initialReg', 'createdAt', 'policyConsent']) {
        assert.deepEqual(recovered[key], snapshot[key], key);
    }
    const audit = await db.collection('accountrecoveries').findOne({ _id: new mongoose.Types.ObjectId(result.auditId) });
    assert.deepEqual(audit.before, snapshot);
    assert.equal(audit.caseRef, evidence.caseRef);
    assert.deepEqual((await db.collection('magiclogintokens').find().toArray()).map(x => x.destination), ['unrelated@example.test']);
    const Model = { findById: async key => profiles.findOne({ _id: new mongoose.Types.ObjectId(key) }) };
    assert.equal(await userForSession(String(id), Model), false, 'legacy session revoked');
    assert.equal(await userForSession(sessionIdentity(snapshot), Model), false, 'versioned session revoked');
    assert.equal(String((await userForSession(sessionIdentity(recovered), Model))._id), String(id));
    await assert.rejects(executeRecovery(connection, { ...request, ...evidence, confirm: fresh.confirmation }), /already belongs/);
});

test('session version preserves unrecovered accounts and rejects malformed or locked sessions', async () => {
    const user = { _id: new mongoose.Types.ObjectId(), locked: false };
    const Model = { findById: async () => user };
    assert.equal(await userForSession(String(user._id), Model), user);
    assert.equal(await userForSession(sessionIdentity(user), Model), user);
    for (const identity of [null, {}, { id: String(user._id), version: '0' }, 'bad-id']) {
        assert.equal(await userForSession(identity, Model), false);
    }
    user.locked = true;
    assert.equal(await userForSession(sessionIdentity(user), Model), false);
    assert.equal(await userForSession(sessionIdentity(user), { findById: async () => null }), false);
});
