import type { Plugin, PluginInput } from '@opencode-ai/plugin'
import {
  checkHealth,
  discoverModels,
  normalizeBaseURL,
} from '../utils/litellm-api'
import {
  formatModelName,
  categorizeModel,
} from '../utils/format-model-name'
import type { LiteLLMModel } from '../types'

const DISCOVERY_TIMEOUT_MS = 5000

/**
 * Read `customHeaders` from a provider options block.
 */
function readCustomHeaders(
  options: Record<string, unknown>,
): Record<string, string> | undefined {
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

/**
 * Convert a discovered model into an OpenCode config-level
 * model entry (the shape used in `provider.*.models` inside
 * `opencode.json`).
 */
function toConfigModel(model: LiteLLMModel): Record<string, unknown> {
  const type = categorizeModel(model)
  const entry: Record<string, unknown> = {
    name: formatModelName(model),
    reasoning: true,
  }
  if (model.max_input_tokens || model.max_output_tokens) {
    entry.limit = {
      context: model.max_input_tokens ?? 0,
      output: model.max_output_tokens ?? 0,
    }
  }
  if (model.supports_function_calling) {
    entry.tool_call = true
  }
  if (model.supports_vision) {
    entry.attachment = true
  }
  if (type === 'embedding' || type === 'image' || type === 'audio') {
    return entry
  }
  return entry
}

/**
 * OpenCode Provider Plugin.
 *
 * Uses the `config` hook to discover models from any
 * `@ai-sdk/openai-compatible` provider's `/v1/models` endpoint and
 * inject them into the provider's `models` map at startup.
 *
 * Configure providers in your `opencode.json`:
 *
 * ```json
 * {
 *   "plugin": ["opencode-plugin-litellm@latest"],
 *   "provider": {
 *     "my-provider": {
 *       "npm": "@ai-sdk/openai-compatible",
 *       "name": "My Provider",
 *       "options": {
 *         "baseURL": "http://localhost:4000/v1"
 *       }
 *     }
 *   }
 * }
 * ```
 */
type Discovered = {
  models: LiteLLMModel[]
  baseURL: string
}

const discoveredCache = new Map<string, Discovered>()

export const LiteLLMPlugin: Plugin = async (_input: PluginInput) => {
  return {
    config: async (config: any) => {
      if (!config.provider) return

      for (const [providerId, raw] of Object.entries(config.provider)) {
        const entry = raw as Record<string, unknown>
        if (entry.npm !== '@ai-sdk/openai-compatible') continue

        if (!entry.npm) entry.npm = '@ai-sdk/openai-compatible'

        const options = (entry.options ?? {}) as Record<string, unknown>
        const configuredBase =
          typeof options.baseURL === 'string' ? options.baseURL : undefined
        const apiKey =
          typeof options.apiKey === 'string' && options.apiKey
            ? options.apiKey
            : undefined
        const customHeaders = readCustomHeaders(options)

        if (!configuredBase) continue

        const baseURL = normalizeBaseURL(configuredBase)

        if (!entry.options) {
          entry.options = { baseURL: `${baseURL}/v1` }
        }
        if (!entry.models) {
          entry.models = {}
        }
        const models = entry.models as Record<string, unknown>

        const cached = discoveredCache.get(providerId)
        if (cached) {
          for (const model of cached.models) {
            if (models[model.id]) continue
            models[model.id] = toConfigModel(model)
          }
          continue
        }

        const work = async () => {
          if (!(await checkHealth(baseURL, apiKey, customHeaders))) {
            console.warn(
              `[opencode-litellm] Provider "${providerId}" appears offline or unauthorized at ${baseURL}`,
            )
            return
          }

          let discovered: LiteLLMModel[]
          try {
            discovered = await discoverModels(baseURL, apiKey, customHeaders)
          } catch (error) {
            console.warn(
              `[opencode-litellm] Model discovery failed for provider "${providerId}":`,
              error instanceof Error ? error.message : String(error),
            )
            return
          }

          if (discovered.length === 0) {
            console.warn(
              `[opencode-litellm] Provider "${providerId}" responded but exposed zero models.`,
            )
            return
          }

          discoveredCache.set(providerId, { models: discovered, baseURL })

          for (const model of discovered) {
            if (models[model.id]) continue
            models[model.id] = toConfigModel(model)
          }

          if (models['_'] && Object.keys(models).length > 1) {
            delete models['_']
          }

          console.log(
            `[opencode-litellm] Discovered ${discovered.length} models from ${providerId} (${baseURL})`,
          )
        }

        await Promise.race([
          work(),
          new Promise<void>((resolve) =>
            setTimeout(resolve, DISCOVERY_TIMEOUT_MS),
          ),
        ])
      }
    },
  }
}

export const LiteLLMResponsesPlugin: Plugin = async (_input: PluginInput) => {
  return {}
}
