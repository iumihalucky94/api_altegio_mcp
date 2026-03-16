export type QueuedMessage = {
    conversationId: string;
    clientPhone: string;
    ts: Date;
    text: string;
    messageId?: string;
    locale?: string;
};
type ProcessCallback = (batch: QueuedMessage[]) => Promise<void>;
export declare function setDebounceProcessor(fn: ProcessCallback): void;
export declare function enqueue(conversationId: string, msg: Omit<QueuedMessage, 'conversationId'>, logger: any): Promise<void>;
export {};
//# sourceMappingURL=debounce.d.ts.map