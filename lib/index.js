import { resolveImageAttachmentAccess, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { createAuthFileStore, processAuthContext, resolveAuthPath } from './auth-file.js'

export const name = 'llm-pi-auth'
export const inject = ['llm']

const DEFAULT_PROVIDERS = ['openai-codex', 'anthropic']

const ROUTE_DEFAULTS = {
  streamIdleTimeoutMs: 300000,
  maxRequestImageBytes: 20971520,
  requestImagePixelBudget: 4194304,
  requestImageMaxBytes: 1048576,
}

function readConfig(config) {
  if (config === null || typeof config !== 'object') throw new Error('llm-pi-auth: config must be an object')
  const providers = config.providers ?? DEFAULT_PROVIDERS
  if (!Array.isArray(providers) || providers.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new Error('llm-pi-auth: providers must be a list of pi-ai provider ids')
  }
  if (config.displaySuffix !== undefined && typeof config.displaySuffix !== 'string') {
    throw new Error('llm-pi-auth: displaySuffix must be a string')
  }
  if (config.authPath !== undefined && typeof config.authPath !== 'string') {
    throw new Error('llm-pi-auth: authPath must be a string')
  }
  if (config.lockTimeoutMs !== undefined && !(Number.isFinite(config.lockTimeoutMs) && config.lockTimeoutMs > 0)) {
    throw new Error('llm-pi-auth: lockTimeoutMs must be a positive number')
  }
  return {
    providers,
    displaySuffix: config.displaySuffix ?? ' (pi auth)',
    authPath: resolveAuthPath(config.authPath),
    lockTimeoutMs: config.lockTimeoutMs,
  }
}

export async function apply(ctx, config = {}) {
  const options = readConfig(config)
  const catalog = new Map(builtinProviders().map((provider) => [provider.id, provider]))
  const unknown = options.providers.filter((id) => !catalog.has(id))
  if (unknown.length > 0) {
    throw new Error(`llm-pi-auth: no pi-ai catalog provider for ${unknown.join(', ')}; known ids include ${[...catalog.keys()].slice(0, 12).join(', ')}`)
  }

  const store = createAuthFileStore({ path: options.authPath, lockTimeoutMs: options.lockTimeoutMs })
  const retryPolicy = resolveRetryPolicy(undefined, 'llm-pi-auth retryPolicy')

  const providers = options.providers.map((id) => catalog.get(id))
  const profiles = new Map(providers.map((provider) => [provider.id, {
    ...ROUTE_DEFAULTS,
    provider: provider.id,
    displayName: `${provider.name}${options.displaySuffix}`,
    piProvider: provider,
    retryPolicy,
    configuredMaxTokens: new Map(),
    modelErrors: new Map(),
  }]))

  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => undefined,
    auth: { credentials: store, authContext: processAuthContext() },
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      (hostPath) => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(`llm-pi-auth: unusable replay state on assistant history for route "${provider}/${model}"; sending that message as provider-neutral content (${reason})`)
    },
  })

  ctx.llm.registerAdapter(options.providers, adapter)

  const stored = new Set(await store.list().then((entries) => entries.map((entry) => entry.providerId)))
  const missing = options.providers.filter((id) => !stored.has(id))
  const advertised = providers.map((provider) => `${provider.id} (${provider.getModels().length} models)`).join(', ')
  ctx.logger.info(`llm-pi-auth: serving ${advertised} from ${options.authPath}`)
  if (missing.length > 0) {
    ctx.logger.info(`llm-pi-auth: ${options.authPath} holds no credential for ${missing.join(', ')}; those routes answer requests only after pi signs in`)
  }
}
