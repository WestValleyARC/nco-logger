/* hamlive-oss — MIT License. See LICENSE. */

import { Db, MongoClient, ObjectId } from 'mongodb';
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

export const toChangeStreamObjectId = (value: string | { toString(): string }): ObjectId =>
    new ObjectId(value.toString());

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

export const closeChangeStreamClient = async (): Promise<void> => {
    const client = changeStreamClient;
    databasePromise = null;
    changeStreamClient = null;
    if (client) await client.close();
};
