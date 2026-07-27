import type { PluginModule, Plugin, PluginInput } from '@opencode-ai/plugin'

// ==================== Types ====================

interface DiscoveredModel {
  id: string
  object: string
  created?: number
  owned_by?: string
  mode?: string
  max_input_tokens?: number
  max_output_tokens?: number
  supports_function_calling?: boolean
  supports_vision?: boolean
}

interface ModelsResponse {
  object: string
  data: DiscoveredModel[]
}

type ModelType = 'chat' | 'embedding' | 'image' | 'audio' | 'unknown'

// ==================== API Utilities ====================

const MODELS_ENDPOINT = '/v1/models'
const REQUEST_TIMEOUT_MS = 3000

function normalizeBaseURL(baseURL: string): string {
  const normalized = baseURL.replace(/\/+$/, '')
  return normalized.endsWith('/v1') ? normalized.slice(0, -3) : normalized
}

function buildAPIURL(baseURL: string, endpoint: string = MODELS_ENDPOINT): string {
  return `${normalizeBaseURL(baseURL)}${endpoint}`
}

function buildHeaders(
  apiKey?: string,
  customHeaders?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  if (customHeaders) Object.assign(headers, customHeaders)
  return headers
}

async function checkHealth(
  baseURL: string,
  apiKey?: string,
  customHeaders?: Record<string, string>,
): Promise<boolean> {
  try {
    const response = await fetch(buildAPIURL(baseURL), {
      method: 'GET',
      headers: buildHeaders(apiKey, customHeaders),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return response.ok
  } catch {
    return false
  }
}

async function discoverModels(
  baseURL: string,
  apiKey?: string,
  customHeaders?: Record<string, string>,
): Promise<DiscoveredModel[]> {
  const url = buildAPIURL(baseURL)
  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(apiKey, customHeaders),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(
      `OpenAI-compatible endpoint responded with HTTP ${response.status} ${response.statusText}`,
    )
  }
  const data = (await response.json()) as ModelsResponse
  return data.data ?? []
}

// ==================== Model Name Formatting ====================

function stripVersionSuffix(part: string): string {
  return part.replace(/@(default|\d{6,8})$/i, '')
}

function looksLikeVersionComponent(token: string): boolean {
  return /^\d{1,2}$/.test(token)
}

function joinTrailingVersionPair(tokens: string[]): string[] {
  for (let i = tokens.length - 1; i >= 1; i--) {
    const a = tokens[i - 1]
    const b = tokens[i]
    if (looksLikeVersionComponent(a) && looksLikeVersionComponent(b)) {
      const next = tokens[i + 1]
      if (next === undefined || !/^\d+$/.test(next)) {
        const merged = [
          ...tokens.slice(0, i - 1),
          `${a}.${b}`,
          ...tokens.slice(i + 1),
        ]
        return merged
      }
    }
  }
  return tokens
}

function categorizeModel(
  model: DiscoveredModel,
): ModelType {
  if (model.mode) {
    const m = model.mode.toLowerCase()
    if (m.includes('embedding')) return 'embedding'
    if (m.includes('image')) return 'image'
    if (m.includes('audio') || m.includes('speech') || m.includes('transcription')) return 'audio'
    if (m.includes('chat') || m.includes('completion')) return 'chat'
  }
  const id = model.id.toLowerCase()
  if (id.includes('embed') || id.includes('embedding')) return 'embedding'
  if (id.includes('whisper') || id.includes('tts')) return 'audio'
  if (id.includes('dall-e') || id.includes('stable-diffusion') || id.includes('flux')) return 'image'
  return 'chat'
}

function formatModelName(model: DiscoveredModel): string {
  const { id } = model

  const slashIdx = id.indexOf('/')
  const afterProvider = slashIdx >= 0 ? id.slice(slashIdx + 1) : id

  const modelPart = stripVersionSuffix(afterProvider)

  const acronyms = new Set([
    'gpt', 'oss', 'api', 'gguf', 'ggml', 'nomic', 'vl', 'it', 'mlx',
    'llm', 'ai', 'sdk', 'aws', 'gcp', 'tts', 'stt', 'mm',
  ])

  const rawTokens = modelPart
    .split(/[-_.]/)
    .filter(Boolean)

  const tokens = joinTrailingVersionPair(rawTokens).map((token) => {
    const lower = token.toLowerCase()
    if (acronyms.has(lower)) return token.toUpperCase()
    if (/^\d+[bkmg]$/i.test(token)) return token.toUpperCase()
    if (/^q\d+$/i.test(token)) return token.toUpperCase()
    if (/^\d+\.\d+/.test(token)) return token
    if (/^[a-z]\d+[a-z]?$/i.test(token)) return token.toUpperCase()
    if (/^\d+[a-z]$/i.test(token)) return token.toLowerCase()
    return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase()
  })

  return tokens.join(' ') || id
}

// ==================== Plugin ====================

const DISCOVERY_TIMEOUT_MS = 5000
const discoveredCache = new Map<
  string,
  { models: DiscoveredModel[]; baseURL: string }
>()

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

function toConfigModel(model: DiscoveredModel): Record<string, unknown> {
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
  return entry
}

function createConfigHook() {
  return async (config: any) => {
    if (!config.provider) return

    for (const [providerId, raw] of Object.entries(config.provider)) {
      const entry = raw as Record<string, unknown>
      if (entry.npm !== '@ai-sdk/openai-compatible') continue

      const options = (entry.options ?? {}) as Record<string, unknown>
      const configuredBase =
        typeof options.baseURL === 'string' ? options.baseURL : undefined
      const apiKey =
        typeof options.apiKey === 'string' && options.apiKey
          ? options.apiKey
          : undefined
      const customHeaders = readCustomHeaders(options)

      if (!configuredBase) continue

      const modelsDiscovery = options.modelsDiscovery !== false
      if (!modelsDiscovery) continue

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
            `[model-discoverer] Provider "${providerId}" appears offline or unauthorized at ${baseURL}`,
          )
          return
        }

        let discovered: DiscoveredModel[]
        try {
          discovered = await discoverModels(baseURL, apiKey, customHeaders)
        } catch (error) {
          console.warn(
            `[model-discoverer] Model discovery failed for provider "${providerId}":`,
            error instanceof Error ? error.message : String(error),
          )
          return
        }

        if (discovered.length === 0) {
          console.warn(
            `[model-discoverer] Provider "${providerId}" responded but exposed zero models.`,
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
          `[model-discoverer] Discovered ${discovered.length} models from ${providerId} (${baseURL})`,
        )
      }

      await Promise.race([
        work(),
        new Promise<void>((resolve) =>
          setTimeout(resolve, DISCOVERY_TIMEOUT_MS),
        ),
      ])
    }
  }
}

// ==================== Exports ====================

export default {
  id: 'model-discoverer',
  server: async () => ({
    config: createConfigHook(),
  }),
} satisfies PluginModule

export const ModelDiscovererPlugin: Plugin = async (_input: PluginInput) => ({
  config: createConfigHook(),
})

export type { DiscoveredModel, ModelsResponse, ModelType }
