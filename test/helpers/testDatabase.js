'use strict';

const assert = require('node:assert/strict');
const { MongoMemoryReplSet, MongoMemoryServer } = require('mongodb-memory-server');

const getDatabaseName = uri => {
    const pathname = new URL(uri).pathname;
    return decodeURIComponent(pathname.replace(/^\//, ''));
};

const createTestDatabase = async ({ databaseName, replicaSet = false }) => {
    assert.match(databaseName, /^[A-Za-z0-9_-]+$/, 'test database name must be explicit and safe');

    const externalUri = process.env.TEST_MONGODB_URI;
    if (externalUri) {
        assert.equal(
            getDatabaseName(externalUri),
            databaseName,
            `TEST_MONGODB_URI must target the ${databaseName} database`
        );
        return { uri: externalUri, cleanup: async () => {} };
    }

    const server = replicaSet
        ? await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        : await MongoMemoryServer.create();

    return {
        uri: server.getUri(databaseName),
        cleanup: () => server.stop()
    };
};

module.exports = { createTestDatabase };
