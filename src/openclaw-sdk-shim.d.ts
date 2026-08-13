declare module "openclaw/plugin-sdk/plugin-entry" {
  export interface PluginEntryOptions {
    id: string;
    name: string;
    description?: string;
    configSchema?: unknown;
    register(api: unknown): void | Promise<void>;
  }

  export function definePluginEntry(options: PluginEntryOptions): PluginEntryOptions;
}
