/* hamlive-oss — MIT License. See LICENSE. */

const operationTails = new Map();

async function withKeyedOperation(key, operation) {
    const normalizedKey = String(key || '');
    if (!normalizedKey) return operation();
    const previous = operationTails.get(normalizedKey) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    operationTails.set(normalizedKey, current);
    await previous.catch(() => undefined);
    try {
        return await operation();
    } finally {
        release();
        if (operationTails.get(normalizedKey) === current) operationTails.delete(normalizedKey);
    }
}

async function withKeyedOperations(keys, operation) {
    const uniqueKeys = [...new Set(keys.map(String).filter(Boolean))].sort();
    const run = index => index >= uniqueKeys.length
        ? operation()
        : withKeyedOperation(uniqueKeys[index], () => run(index + 1));
    return run(0);
}

module.exports = { withKeyedOperation, withKeyedOperations };
