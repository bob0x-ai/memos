declare module 'openclaw/plugin-sdk' {
  export interface OpenClawPluginApi {
    on(eventName: string, handler: (event: unknown, ctx: any) => unknown): void;
    registerTool(tool: {
      name: string;
      description: string;
      parameters: unknown;
      handler: (params: any, ctx: any) => unknown;
    }): void;
  }
}
