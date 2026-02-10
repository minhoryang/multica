/**
 * Provider IPC handlers for Electron main process.
 *
 * Manages LLM provider listing, status checking, and switching.
 * Mirrors the CLI `/provider` command functionality.
 */
import { ipcMain } from 'electron'
import { getCurrentHub } from './hub.js'
import {
  getProviderList,
  getAvailableProviders,
  getCurrentProvider,
  getProviderMeta,
  isProviderAvailable,
  getLoginInstructions,
  readClaudeCliCredentials,
  readCodexCliCredentials,
  credentialManager,
  type ProviderInfo,
} from '@multica/core'

/**
 * Provider info returned to renderer (matches ProviderInfo from registry).
 */
export interface ProviderStatus {
  id: string
  name: string
  authMethod: 'api-key' | 'oauth'
  available: boolean
  configured: boolean
  current: boolean
  defaultModel: string
  models: string[]
  loginUrl?: string
  loginCommand?: string
  loginInstructions?: string
}

/**
 * Current provider/model info returned to renderer.
 */
export interface CurrentProviderInfo {
  provider: string
  model: string | undefined
  providerName: string | undefined
  available: boolean
}

/**
 * Get the default agent from Hub.
 */
function getDefaultAgent() {
  const hub = getCurrentHub()
  if (!hub) return null

  const agentIds = hub.listAgents()
  if (agentIds.length === 0) return null

  return hub.getAgent(agentIds[0]) ?? null
}

/**
 * Register all Provider-related IPC handlers.
 */
export function registerProviderIpcHandlers(): void {
  /**
   * List all providers with their status.
   * This is the main listing function, similar to CLI `/provider` command.
   */
  ipcMain.handle('provider:list', async (): Promise<ProviderStatus[]> => {
    const providers = getProviderList()

    return providers.map((p: ProviderInfo) => ({
      id: p.id,
      name: p.name,
      authMethod: p.authMethod,
      available: p.available,
      configured: p.configured,
      current: p.current,
      defaultModel: p.defaultModel,
      models: p.models,
      loginUrl: p.loginUrl,
      loginCommand: p.loginCommand,
      loginInstructions: getLoginInstructions(p.id),
    }))
  })

  /**
   * List only available (configured) providers.
   */
  ipcMain.handle('provider:listAvailable', async (): Promise<ProviderStatus[]> => {
    const providers = getAvailableProviders()

    return providers.map((p: ProviderInfo) => ({
      id: p.id,
      name: p.name,
      authMethod: p.authMethod,
      available: p.available,
      configured: p.configured,
      current: p.current,
      defaultModel: p.defaultModel,
      models: p.models,
      loginUrl: p.loginUrl,
      loginCommand: p.loginCommand,
      loginInstructions: getLoginInstructions(p.id),
    }))
  })

  /**
   * Get current provider and model from the active agent.
   */
  ipcMain.handle('provider:current', async (): Promise<CurrentProviderInfo> => {
    const agent = getDefaultAgent()

    if (agent) {
      // Get from actual agent instance
      const info = agent.getProviderInfo()
      const meta = getProviderMeta(info.provider)

      return {
        provider: info.provider,
        model: info.model,
        providerName: meta?.name,
        available: isProviderAvailable(info.provider),
      }
    }

    // Fallback to credentials default
    const defaultProvider = getCurrentProvider()
    const meta = getProviderMeta(defaultProvider)

    return {
      provider: defaultProvider,
      model: meta?.defaultModel,
      providerName: meta?.name,
      available: isProviderAvailable(defaultProvider),
    }
  })

  /**
   * Switch the agent to a different provider and/or model.
   */
  ipcMain.handle(
    'provider:set',
    async (_event, providerId: string, modelId?: string): Promise<{ ok: boolean; provider?: string; model?: string; error?: string }> => {
      const agent = getDefaultAgent()

      if (!agent) {
        return { ok: false, error: 'No agent available' }
      }

      // Validate provider exists
      const meta = getProviderMeta(providerId)
      if (!meta) {
        return { ok: false, error: `Unknown provider: ${providerId}` }
      }

      // Check if provider is available
      if (!isProviderAvailable(providerId)) {
        const instructions = getLoginInstructions(providerId)
        return {
          ok: false,
          error: `Provider "${providerId}" is not configured.\n${instructions}`,
        }
      }

      // Validate model if specified
      if (modelId && !meta.models.includes(modelId)) {
        return {
          ok: false,
          error: `Model "${modelId}" is not available for provider "${providerId}". Available: ${meta.models.join(', ')}`,
        }
      }

      try {
        const result = agent.setProvider(providerId, modelId)
        console.log(`[IPC] Provider switched to: ${result.provider}, model: ${result.model}`)

        return {
          ok: true,
          provider: result.provider,
          model: result.model,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[IPC] Failed to switch provider: ${message}`)
        return { ok: false, error: message }
      }
    }
  )

  /**
   * Get metadata for a specific provider.
   */
  ipcMain.handle('provider:getMeta', async (_event, providerId: string) => {
    const meta = getProviderMeta(providerId)
    if (!meta) {
      return { error: `Unknown provider: ${providerId}` }
    }

    return {
      id: meta.id,
      name: meta.name,
      authMethod: meta.authMethod,
      defaultModel: meta.defaultModel,
      models: meta.models,
      loginUrl: meta.loginUrl,
      loginCommand: meta.loginCommand,
      available: isProviderAvailable(providerId),
      loginInstructions: getLoginInstructions(providerId),
    }
  })

  /**
   * Check if a specific provider is available (has valid credentials).
   */
  ipcMain.handle('provider:isAvailable', async (_event, providerId: string): Promise<boolean> => {
    return isProviderAvailable(providerId)
  })

  /**
   * Save API key for a provider to credentials.json5.
   * After saving, the provider should become available.
   */
  ipcMain.handle(
    'provider:saveApiKey',
    async (_event, providerId: string, apiKey: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        // Validate provider exists and uses API key auth
        const meta = getProviderMeta(providerId)
        if (!meta) {
          return { ok: false, error: `Unknown provider: ${providerId}` }
        }
        if (meta.authMethod !== 'api-key') {
          return { ok: false, error: `Provider "${providerId}" uses ${meta.authMethod} authentication, not API key` }
        }

        // Save the API key
        credentialManager.setLlmProviderApiKey(providerId, apiKey)
        console.log(`[IPC] API key saved for provider: ${providerId}`)

        return { ok: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[IPC] Failed to save API key: ${message}`)
        return { ok: false, error: message }
      }
    }
  )

  /**
   * Import OAuth credentials from CLI tools (claude-code, codex).
   * Reads from CLI credential storage and saves to credentials.json5.
   */
  ipcMain.handle(
    'provider:importOAuth',
    async (_event, providerId: string): Promise<{ ok: boolean; expiresAt?: number; error?: string }> => {
      try {
        const meta = getProviderMeta(providerId)
        if (!meta) {
          return { ok: false, error: `Unknown provider: ${providerId}` }
        }
        if (meta.authMethod !== 'oauth') {
          return { ok: false, error: `Provider "${providerId}" does not use OAuth authentication` }
        }

        // Read credentials from CLI tool
        if (providerId === 'claude-code') {
          const creds = readClaudeCliCredentials()
          if (!creds) {
            return { ok: false, error: 'No Claude Code credentials found. Run "claude login" first.' }
          }
          if (creds.expires <= Date.now()) {
            return { ok: false, error: 'Claude Code credentials have expired. Run "claude login" again.' }
          }

          // Save to credentials.json5
          const token = creds.type === 'oauth' ? creds.access : creds.token
          const refreshToken = creds.type === 'oauth' ? creds.refresh : undefined
          credentialManager.setLlmProviderOAuthToken(providerId, token, refreshToken, creds.expires)
          console.log(`[IPC] OAuth credentials imported for: ${providerId}`)

          return { ok: true, expiresAt: creds.expires }
        }

        if (providerId === 'openai-codex') {
          const creds = readCodexCliCredentials()
          if (!creds) {
            return { ok: false, error: 'No Codex credentials found. Run "codex login" first.' }
          }
          if (creds.expires <= Date.now()) {
            return { ok: false, error: 'Codex credentials have expired. Run "codex login" again.' }
          }

          // Save to credentials.json5
          credentialManager.setLlmProviderOAuthToken(providerId, creds.access, creds.refresh, creds.expires)
          console.log(`[IPC] OAuth credentials imported for: ${providerId}`)

          return { ok: true, expiresAt: creds.expires }
        }

        return { ok: false, error: `OAuth import not supported for provider: ${providerId}` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[IPC] Failed to import OAuth credentials: ${message}`)
        return { ok: false, error: message }
      }
    }
  )
}
