/* hamlive-oss — MIT License. See LICENSE. */

export class ExclusiveKeyedOperation {
    private readonly activeKeys = new Set<string>();

    begin(key: string): boolean {
        if (!key || this.activeKeys.has(key)) return false;
        this.activeKeys.add(key);
        return true;
    }

    end(key: string): void {
        this.activeKeys.delete(key);
    }

    isActive(key: string): boolean {
        return this.activeKeys.has(key);
    }
}

export class CoalescedAsyncRequest {
    private inFlight: Promise<void> | null = null;
    private trailingRequested = false;
    private requestCount = 0;
    private executionCount = 0;
    private coalescedCount = 0;

    constructor(private readonly operation: () => Promise<void>) {}

    request(): Promise<void> {
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

    get active(): boolean {
        return this.inFlight !== null;
    }

    get stats(): Readonly<{ requests: number; executions: number; coalesced: number }> {
        return {
            requests: this.requestCount,
            executions: this.executionCount,
            coalesced: this.coalescedCount
        };
    }

    private async drain(): Promise<void> {
        do {
            this.trailingRequested = false;
            this.executionCount += 1;
            await this.operation();
        } while (this.trailingRequested);
    }
}
