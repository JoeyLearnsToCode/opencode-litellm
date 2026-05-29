import type { Model as ModelV2, Provider as ProviderV2 } from '@opencode-ai/sdk/v2'
import {
  checkHealth,
  discoverModels,
  normalizeBaseURL,
} from '../utils/litellm-api'
import { requiresResponsesAPI } from '../utils/format-model-name'
import type { LiteLLMModel, Transport, TransportPolicy } from '../types'
import { buildModelV2 } from './build-model'

const DISCOVERY_TIMEOUT_MS = 5000

function pickTransport(
  model: LiteLLMModel,
  policy: TransportPolicy,
  responsesApiModels: ReadonlySet<string>,
  chatApiModels: ReadonlySet<string>,
): Transport {
  if (responsesApiModels.has(model.id)) return 'responses'
  if (chatApiModels.has(model.id)) return 'chat'
  if (policy === 'chat') return 'chat'
  if (policy === 'responses') return 'responses'
  return requiresResponsesAPI(model) ? 'responses' : 'chat'
}

function readCustomHeaders(
  provider: ProviderV2 | undefined,
): Record<string, string> | undefined {
  const options = (provider?.options ?? {}) as Record<string, unknown>
  const raw = options.customHeaders
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
  return undefined
}

async function resolveEndpoint(
  provider: ProviderV2 | undefined,
): Promise<{ baseURL: string; apiKey?: string; customHeaders?: Record<string, string> } | null> {
  const options = (provider?.options ?? {}) as Record<string, unknown>
  const configuredBase = typeof options.baseURL === 'string' ? options.baseURL : undefined
  const apiKey = typeof options.apiKey === 'string' && options.apiKey ? options.apiKey : undefined
  const customHeaders = readCustomHeaders(provider)

  if (!configuredBase) return null
  return { baseURL: normalizeBaseURL(configuredBase), apiKey, customHeaders }
}

function readRoutingOptions(
  provider: ProviderV2 | undefined,
): {
  policy: TransportPolicy
  responsesApiModels: Set<string>
  chatApiModels: Set<string>
} {
  const options = (provider?.options ?? {}) as Record<string, unknown>
  const policy =
    typeof options.transport === 'string' &&
    (options.transport === 'auto' || options.transport === 'chat' || options.transport === 'responses')
      ? (options.transport as TransportPolicy)
      : 'auto'
  const responses = Array.isArray(options.responsesApiModels)
    ? options.responsesApiModels.filter((v): v is string => typeof v === 'string')
    : []
  const chat = Array.isArray(options.chatApiModels)
    ? options.chatApiModels.filter((v): v is string => typeof v === 'string')
    : []
  return {
    policy,
    responsesApiModels: new Set(responses),
    chatApiModels: new Set(chat),
  }
}

/**
 * Discover all models from a provider endpoint and bucket them by the
 * transport (`chat` vs `responses`) they should use. Returns a map of
 * model id → V2 `Model` for the requested bucket only.
 *
 * Pass `bucket: 'all'` to ignore the routing heuristic and return
 * every discovered model.
 *
 * Capped at {@link DISCOVERY_TIMEOUT_MS} so a slow / unreachable
 * endpoint never stalls OpenCode startup.
 */
export async function discoverBucket(
  bucket: Transport | 'all',
  provider: ProviderV2 | undefined,
  api: { id: string; url: string; npm: string },
): Promise<Record<string, ModelV2>> {
  const out: Record<string, ModelV2> = {}

  const work = async () => {
    const endpoint = await resolveEndpoint(provider)
    if (!endpoint) return

    const { baseURL, apiKey, customHeaders } = endpoint
    if (!(await checkHealth(baseURL, apiKey, customHeaders))) {
      console.warn(`[opencode-litellm] Provider appears offline or unauthorized at ${baseURL}`)
      return
    }

    let models: LiteLLMModel[]
    try {
      models = await discoverModels(baseURL, apiKey, customHeaders)
    } catch (error) {
      console.warn(
        '[opencode-litellm] Model discovery failed:',
        error instanceof Error ? error.message : String(error),
      )
      return
    }

    if (models.length === 0) {
      console.warn(
        '[opencode-litellm] Endpoint responded but exposed zero models.',
      )
      return
    }

    const resolvedApi = { ...api, url: `${baseURL}/v1` }

    const routing = readRoutingOptions(provider)
    for (const model of models) {
      if (bucket !== 'all') {
        const transport = pickTransport(
          model,
          routing.policy,
          routing.responsesApiModels,
          routing.chatApiModels,
        )
        if (transport !== bucket) continue
      }
      const perModelApi = { ...resolvedApi, id: model.id }
      out[model.id] = buildModelV2(resolvedApi.id, perModelApi, model)
    }
  }

  await Promise.race([
    work(),
    new Promise<void>((resolve) => setTimeout(resolve, DISCOVERY_TIMEOUT_MS)),
  ])

  return out
}
