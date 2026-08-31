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

    constructor(private readonly operation: () => Promise<void>) {}

    request(): Promise<void> {
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

    get active(): boolean {
        return this.inFlight !== null;
    }

    private async drain(): Promise<void> {
        do {
            this.trailingRequested = false;
            await this.operation();
        } while (this.trailingRequested);
    }
}
