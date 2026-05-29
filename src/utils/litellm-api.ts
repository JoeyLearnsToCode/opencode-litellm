import type { LiteLLMModel, LiteLLMModelsResponse } from '../types'

const MODELS_ENDPOINT = '/v1/models'
const REQUEST_TIMEOUT_MS = 3000

/**
 * Normalise a base URL so the rest of the plugin can rely on a
 * predictable shape (no trailing slash, no `/v1` suffix).
 */
export function normalizeBaseURL(baseURL: string): string {
  let normalized = baseURL.replace(/\/+$/, '')
  if (normalized.endsWith('/v1')) {
    normalized = normalized.slice(0, -3)
  }
  return normalized
}

/** Build a full URL for a given API endpoint. */
export function buildAPIURL(baseURL: string, endpoint: string = MODELS_ENDPOINT): string {
  return `${normalizeBaseURL(baseURL)}${endpoint}`
}

function buildHeaders(apiKey?: string, customHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  if (customHeaders) {
    Object.assign(headers, customHeaders)
  }
  return headers
}

/** Lightweight ping to see whether a server is reachable. */
export async function checkHealth(
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

/** Discover all models exposed by an OpenAI-compatible /v1/models endpoint. */
export async function discoverModels(
  baseURL: string,
  apiKey?: string,
  customHeaders?: Record<string, string>,
): Promise<LiteLLMModel[]> {
  const url = buildAPIURL(baseURL)
  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(apiKey, customHeaders),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`OpenAI-compatible endpoint responded with HTTP ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as LiteLLMModelsResponse
  return data.data ?? []
}
