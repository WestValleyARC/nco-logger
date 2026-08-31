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
    constructor(operation: () => Promise<void>);
    request(): Promise<void>;
    get active(): boolean;
    private drain;
}
//# sourceMappingURL=requestCoordination.d.ts.map