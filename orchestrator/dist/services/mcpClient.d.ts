export declare function callMcp(tool: string, payload: Record<string, unknown>, companyId: number, requestId: string): Promise<{
    decision: string;
    result?: unknown;
    error?: {
        code: string;
        message: string;
    };
    next_steps?: unknown[];
}>;
export declare function createHandoffViaMcp(conversationId: string, clientPhone: string, summary: string, questionToAdmin: string, lastMessages: Array<{
    ts: string;
    from: string;
    text: string;
}>, companyId: number, requestId: string): Promise<{
    decision: string;
    result?: unknown;
    error?: {
        code: string;
        message: string;
    };
    next_steps?: unknown[];
}>;
export declare function approveViaMcp(approvalId: string, adminKey: string, gatewayUrl: string): Promise<boolean>;
export declare function rejectApproval(_approvalId: string, _adminKey: string, _gatewayUrl: string): Promise<boolean>;
//# sourceMappingURL=mcpClient.d.ts.map