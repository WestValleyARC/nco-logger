export class ExclusiveKeyedOperation {
    activeKeys = new Set();
    begin(key) {
        if (!key || this.activeKeys.has(key))
            return false;
        this.activeKeys.add(key);
        return true;
    }
    end(key) {
        this.activeKeys.delete(key);
    }
    isActive(key) {
        return this.activeKeys.has(key);
    }
}
export class CoalescedAsyncRequest {
    operation;
    inFlight = null;
    trailingRequested = false;
    requestCount = 0;
    executionCount = 0;
    coalescedCount = 0;
    constructor(operation) {
        this.operation = operation;
    }
    request() {
        this.requestCount += 1;
        if (this.inFlight) {
            this.coalescedCount += 1;
            this.trailingRequested = true;
            return this.inFlight;
        }
        this.inFlight = Promise.resolve()
            .then(() => this.drain())
            .finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }
    get active() {
        return this.inFlight !== null;
    }
    get stats() {
        return {
            requests: this.requestCount,
            executions: this.executionCount,
            coalesced: this.coalescedCount
        };
    }
    async drain() {
        do {
            this.trailingRequested = false;
            this.executionCount += 1;
            await this.operation();
        } while (this.trailingRequested);
    }
}
//# sourceMappingURL=requestCoordination.js.map