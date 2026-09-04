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

let changeStreamClient: MongoClient | null = null;
let databasePromise: Promise<Db> | null = null;

const getChangeStreamClient = (): MongoClient => {
    changeStreamClient ??= new MongoClient(conf.dburi, {
        maxPoolSize: conf.change_stream_poolsize
    });
    return changeStreamClient;
};

export const getChangeStreamDb = (): Promise<Db> => {
    if (!databasePromise) {
        databasePromise = getChangeStreamClient().connect()
            .then(client => client.db(resolvedDbName))
            .catch((error: unknown) => {
                databasePromise = null;
                throw error;
            });
    }

    return databasePromise;
};
