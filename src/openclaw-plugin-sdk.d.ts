declare module 'openclaw/plugin-sdk' {
  export interface OpenClawPluginToolContext {
    agentId?: string;
    sessionId?: string;
    requesterSenderId?: string;
  }

  export interface OpenClawPluginApi {
    on(eventName: string, handler: (event: unknown, ctx: any) => unknown): void;
    registerTool(tool: ((ctx: OpenClawPluginToolContext) => {
      name: string;
      description: string;
      parameters: unknown;
      execute: (toolCallId: string, params: any, signal?: AbortSignal) => unknown;
    }) | {
      name: string;
      description: string;
      parameters: unknown;
      execute: (toolCallId: string, params: any, signal?: AbortSignal) => unknown;
    }): void;
  }
}
