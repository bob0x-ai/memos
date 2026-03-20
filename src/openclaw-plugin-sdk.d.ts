declare module 'openclaw/plugin-sdk' {
  import type { IncomingMessage, ServerResponse } from 'node:http';

  export interface OpenClawPluginToolContext {
    agentId?: string;
    sessionId?: string;
    requesterSenderId?: string;
  }

  export type OpenClawPluginHttpRouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;
  export type OpenClawPluginHttpRouteAuth = 'gateway' | 'plugin';
  export type OpenClawPluginHttpRouteMatch = 'exact' | 'prefix';

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
    registerHttpRoute(params: {
      path: string;
      auth: OpenClawPluginHttpRouteAuth;
      match?: OpenClawPluginHttpRouteMatch;
      replaceExisting?: boolean;
      handler: OpenClawPluginHttpRouteHandler;
    }): void;
  }
}
