/* hamlive-oss — MIT License. See LICENSE. */

import { Db, MongoClient } from 'mongodb';
import { conf } from '#@server/lib/configLib.js';

const resolvedDbName = (() => {
    try {
        const fromUri = new URL(conf.dburi).pathname.replace(/^\//, '').split('?')[0];
        return fromUri || conf.dbname;
    } catch {
        return conf.dbname;
    }
})();

const changeStreamClient = new MongoClient(conf.dburi, {
    maxPoolSize: conf.change_stream_poolsize
});

let databasePromise: Promise<Db> | null = null;

export const getChangeStreamDb = (): Promise<Db> => {
    if (!databasePromise) {
        databasePromise = changeStreamClient.connect()
            .then(client => client.db(resolvedDbName))
            .catch((error: unknown) => {
                databasePromise = null;
                throw error;
            });
    }

    return databasePromise;
};
