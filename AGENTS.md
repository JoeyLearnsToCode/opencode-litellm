# AGENTS.md — opencode-plugin-litellm

Practical notes for agents working in this repo. Only includes facts that are easy to miss.

## Commands

| Task | Command |
|------|---------|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| No separate build | `build` script just runs typecheck; there is no emit step |
| No test suite | Tests are a roadmap item; CI only runs typecheck on Node 20 + 22 |

## Architecture (current: v0.5.0)

- **Single plugin, one hook:** `LiteLLMPlugin` uses the `config` lifecycle hook to mutate `config.provider.<id>.models` at startup. This replaced the broken `provider.models` hook approach from v0.3–0.4.x.
- **`LiteLLMResponsesPlugin` is a no-op** as of v0.5.0. All models are injected through a single `litellm` provider. Ignore any README references to a separate `litellm-responses` provider — they describe the old design.
- **Entry:** `src/index.ts` exports `{ LiteLLMPlugin, LiteLLMResponsesPlugin }` plus types.
- **Discovery flow:** `src/plugin/discover.ts` → `src/utils/litellm-api.ts` (health check + `/v1/models`) → `src/utils/format-model-name.ts` (name formatting, owner extraction) → `src/plugin/build-model.ts` (V2 model object construction).
- **Timeout:** All network calls are wrapped in a 5 s `Promise.race`. A slow/offline proxy never blocks OpenCode startup.

## Key conventions

- **Zero runtime deps** beyond `@opencode-ai/plugin` and `@opencode-ai/sdk`. Adding a dependency requires strong justification.
- **Strict TypeScript** (`tsconfig.json`: `"strict": true`). No `any` in public APIs.
- **Target:** ES2022, module `ESNext`, moduleResolution `bundler`. The package is ESM (`"type": "module"`).
- **No emit:** `declaration` and `declarationMap` are on in `tsconfig.json`, but `build` doesn't actually output — it only typechecks. The package ships source (`"files": ["src"]`).
- **Plugin ID matters:** npm package is `opencode-plugin-litellm` (scoped name was taken). The plugin symbol exported is `LiteLLMPlugin`. In `opencode.json`, load with `"plugin": ["opencode-plugin-litellm@latest"]`.

## Local dev against OpenCode

```bash
npm link                    # in this repo
npm link opencode-plugin-litellm   # in your OpenCode workspace
```

Plugin logs are prefixed `[opencode-litellm]`. Watch with `tail -f` on the OpenCode log path.

## CI / Release

- **CI:** `.github/workflows/ci.yml` — typecheck only, Node 20 + 22.
- **Release:** `.github/workflows/release.yml` — auto-publishes to npm on tag push (needs `NPM_TOKEN` secret).
- **Release steps (manual):** bump `package.json` version → update `CHANGELOG.md` under `## [Unreleased]` → commit `release: vX.Y.Z` → `git tag vX.Y.Z && git push --follow-tags`.
- **Commit messages:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).

## Pitfalls

- **Models only refresh on restart.** After changing LiteLLM `config.yaml`, restart both LiteLLM and OpenCode.
- **`config` hook is read-only in OpenCode for some paths** — the v0.3–0.4.x line shipped a broken design because of this. The v0.5.0 `config`-hook approach works because it mutates the config object directly before OpenCode processes it.
- **No `.env` loading** in the plugin. Auth comes from `LITELLM_API_KEY`/`LITELLM_MASTER_KEY` env vars or `provider.<id>.options.apiKey` in `opencode.json`.
- **`customHeaders`** are sent on discovery requests only (health check + `/v1/models`), not on inference requests (those are handled by `@ai-sdk/openai-compatible`).
