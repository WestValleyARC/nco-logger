export declare class ExclusiveKeyedOperation {
    private readonly activeKeys;
    begin(key: string): boolean;
    end(key: string): void;
    isActive(key: string): boolean;
}
export declare class CoalescedAsyncRequest {
    private readonly operation;
    private inFlight;
    private trailingRequested;
    private requestCount;
    private executionCount;
    private coalescedCount;
    constructor(operation: () => Promise<void>);
    request(): Promise<void>;
    get active(): boolean;
    get stats(): Readonly<{
        requests: number;
        executions: number;
        coalesced: number;
    }>;
    private drain;
}
//# sourceMappingURL=requestCoordination.d.ts.map