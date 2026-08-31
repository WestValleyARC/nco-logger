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
    constructor(operation) {
        this.operation = operation;
    }
    request() {
        if (this.inFlight) {
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
    async drain() {
        do {
            this.trailingRequested = false;
            await this.operation();
        } while (this.trailingRequested);
    }
}
//# sourceMappingURL=requestCoordination.js.map