"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChangeStreamDb = void 0;
const mongodb_1 = require("mongodb");
const configLib_js_1 = require("#@server/lib/configLib.js");
const resolvedDbName = (() => {
    try {
        const fromUri = new URL(configLib_js_1.conf.dburi).pathname.replace(/^\//, '').split('?')[0];
        return fromUri || configLib_js_1.conf.dbname;
    }
    catch {
        return configLib_js_1.conf.dbname;
    }
})();
const changeStreamClient = new mongodb_1.MongoClient(configLib_js_1.conf.dburi, {
    maxPoolSize: configLib_js_1.conf.change_stream_poolsize
});
let databasePromise = null;
const getChangeStreamDb = () => {
    if (!databasePromise) {
        databasePromise = changeStreamClient.connect()
            .then(client => client.db(resolvedDbName))
            .catch((error) => {
            databasePromise = null;
            throw error;
        });
    }
    return databasePromise;
};
exports.getChangeStreamDb = getChangeStreamDb;
