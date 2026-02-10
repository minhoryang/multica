/**
 * Channel plugin registry.
 *
 * Simple array + Map registry. Plugins are registered at startup
 * via registerChannel() and looked up by ID.
 */

import type { ChannelPlugin } from "./types.js";

const plugins: ChannelPlugin[] = [];
const pluginMap = new Map<string, ChannelPlugin>();

/** Register a channel plugin. Throws if ID is already registered. */
export function registerChannel(plugin: ChannelPlugin): void {
  if (pluginMap.has(plugin.id)) {
    throw new Error(`Channel plugin "${plugin.id}" is already registered`);
  }
  plugins.push(plugin);
  pluginMap.set(plugin.id, plugin);
  console.log(`[Channels] Registered plugin: ${plugin.id}`);
}

/** Get a registered channel plugin by ID */
export function getChannel(id: string): ChannelPlugin | undefined {
  return pluginMap.get(id);
}

/** List all registered channel plugins */
export function listChannels(): readonly ChannelPlugin[] {
  return plugins;
}
