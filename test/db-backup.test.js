const assert = require('node:assert/strict');
const test = require('node:test');

const backup = require('../server/dist/bin/dbBackup.js');

test('backup defaults to primaryPreferred and omits oplog for a database URI', () => {
    const args = backup.buildBackupArgs(
        'mongodb://mongo:27017/hamlive?replicaSet=rs0&directConnection=true',
        '/backups/test.archive.gz'
    );
    assert.ok(args[0].includes('readPreference=primaryPreferred'));
    assert.ok(!args.includes('--oplog'));
});

test('backup permits an explicit secondary read preference', () => {
    const args = backup.buildBackupArgs('mongodb://mongo:27017/hamlive', '/backups/test.archive.gz', {
        'read-preference': 'secondary'
    });
    assert.ok(args[0].includes('readPreference=secondary'));
});

test('verification defaults source reads to primaryPreferred', () => {
    const uri = backup.verificationSourceUri('mongodb://mongo:27017/hamlive?replicaSet=rs0');
    assert.ok(uri.includes('readPreference=primaryPreferred'));
});

test('verification uses secondary only when explicitly requested', () => {
    const uri = backup.verificationSourceUri('mongodb://mongo:27017/hamlive?replicaSet=rs0', 'secondary');
    assert.ok(uri.includes('readPreference=secondary'));
});

test('ordinary restore does not replay an oplog and drop remains opt-in', () => {
    const args = backup.buildRestoreArgs('mongodb://mongo:27017/hamlive', '/backups/test.archive.gz');
    assert.ok(!args.includes('--oplogReplay'));
    assert.ok(!args.includes('--drop'));
});

test('oplog replay is explicit and disabled during namespace remapping', () => {
    const direct = backup.buildRestoreArgs('mongodb://mongo:27017/hamlive', '/backups/test.archive.gz', [], {
        'oplog-replay': true
    });
    assert.ok(direct.includes('--oplogReplay'));

    const remapped = backup.buildRestoreArgs(
        'mongodb://mongo:27017/restore-target?replicaSet=rs0',
        '/backups/test.archive.gz',
        ['--nsFrom=hamlive.*', '--nsTo=restore-target.*'],
        { 'oplog-replay': true, drop: true }
    );
    assert.ok(!remapped.includes('--oplogReplay'));
    assert.ok(remapped.includes('--drop'));
    assert.ok(remapped[0].startsWith('--uri=mongodb://mongo:27017/?'));
});

test('migrate does not capture or replay oplog by default', () => {
    const { dumpArgs, restoreArgs, useOplog } = backup.buildMigrateArgs(
        'mongodb://source:27017/?replicaSet=rs0',
        'mongodb://target:27017/?replicaSet=rs0'
    );
    assert.equal(useOplog, false);
    assert.ok(!dumpArgs.includes('--oplog'));
    assert.ok(!restoreArgs.includes('--oplogReplay'));
});

test('migrate uses oplog only when explicitly requested and compatible', () => {
    const { dumpArgs, restoreArgs, useOplog } = backup.buildMigrateArgs(
        'mongodb://source:27017/?replicaSet=rs0',
        'mongodb://target:27017/?replicaSet=rs0',
        undefined,
        [],
        { oplog: true, 'oplog-replay': true }
    );
    assert.equal(useOplog, true);
    assert.ok(dumpArgs.includes('--oplog'));
    assert.ok(restoreArgs.includes('--oplogReplay'));
});

test('namespace remapping prevents migrate oplog capture and replay', () => {
    const remap = ['--nsFrom=source.*', '--nsTo=target.*'];
    const { dumpArgs, restoreArgs, useOplog } = backup.buildMigrateArgs(
        'mongodb://source:27017/?replicaSet=rs0',
        'mongodb://target:27017/?replicaSet=rs0',
        '/backups/migrate.archive.gz',
        remap,
        { oplog: true, 'oplog-replay': true }
    );
    assert.equal(useOplog, false);
    assert.ok(!dumpArgs.includes('--oplog'));
    assert.ok(!restoreArgs.includes('--oplogReplay'));
    assert.ok(restoreArgs.includes('--nsFrom=source.*'));
});

test('development never falls back to the production URI', () => {
    const previousProduction = process.env.MONGODB_PRODUCTION_URI;
    const previousDevelopment = process.env.MONGODB_DEVELOPMENT_URI;
    process.env.MONGODB_PRODUCTION_URI = 'mongodb://mongo:27017/hamlive';
    delete process.env.MONGODB_DEVELOPMENT_URI;
    try {
        assert.throws(() => backup.resolveUri({ env: 'development' }, 'uri'), /No MONGODB_DEVELOPMENT_URI/);
    } finally {
        if (previousProduction === undefined) delete process.env.MONGODB_PRODUCTION_URI;
        else process.env.MONGODB_PRODUCTION_URI = previousProduction;
        if (previousDevelopment === undefined) delete process.env.MONGODB_DEVELOPMENT_URI;
        else process.env.MONGODB_DEVELOPMENT_URI = previousDevelopment;
    }
});

test('database identity comes from the URI and missing names fail closed', () => {
    const target = backup.resolveUri({
        uri: 'mongodb://mongo:27017/actual-db?replicaSet=rs0',
        environment: 'production'
    }, 'uri');
    assert.equal(target.dbname, 'actual-db');
    assert.equal(target.environment, 'production');
    assert.throws(
        () => backup.resolveUri({ uri: 'mongodb://mongo:27017/?replicaSet=rs0' }, 'uri'),
        /must include a database name/
    );
    assert.throws(
        () => backup.assertDatabaseIdentity('configured-db', 'actual-db', 'test profile'),
        /Database identity conflict/
    );
});

test('production and unclassified writes require exact target confirmation', async () => {
    const production = { dbname: 'hamlive', environment: 'production' };
    await assert.rejects(() => backup.confirmTargetWrite(production, {}), /Refusing production write/);
    await backup.confirmTargetWrite(production, { 'confirm-production': 'hamlive' });

    const unknown = { dbname: 'restore-target', environment: 'unclassified' };
    await assert.rejects(() => backup.confirmTargetWrite(unknown, {}), /unclassified/);
    await backup.confirmTargetWrite(unknown, { 'confirm-target': 'restore-target' });
});
