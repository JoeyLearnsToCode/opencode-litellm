# Contributing to opencode-litellm

Thanks for your interest! This project is small, scoped, and aims to stay that way — so please read this short guide before opening a PR.

## Project philosophy

- **Tiny surface area.** The plugin does one thing: discover LiteLLM models and feed them to OpenCode. Features that drift from that focus belong in a sibling plugin, not in this one.
- **Single-file design.** All plugin logic lives in `src/model-discoverer.ts` using the `PluginModule` pattern (`satisfies PluginModule`).
- **Zero runtime deps** beyond `@opencode-ai/plugin`. Adding a dependency requires a strong justification.
- **Strict TypeScript.** No `any` in public APIs. Internal `any` is acceptable only when the OpenCode `config` type is genuinely opaque to us.
- **Non-blocking by default.** Anything that talks to the network must be wrapped in a timeout and must never throw out of the plugin lifecycle.

## Development setup

Requires Node.js ≥ 20 (or Bun ≥ 1.0).

```bash
git clone https://github.com/yuseferi/opencode-litellm.git
cd opencode-litellm
npm install
npm run typecheck
```

## Testing locally against your OpenCode

```bash
# In the plugin repo
npm link

# In your OpenCode workspace
npm link opencode-plugin-litellm
# add it to opencode.json plugins, then:
opencode
```

Plugin logs are prefixed with `[opencode-litellm]` — `tail -f ~/.opencode/logs/...` to watch them.

## Pull request checklist

- [ ] `npm run typecheck` passes locally
- [ ] No new runtime dependencies (or strong justification in the PR description)
- [ ] Public API changes are reflected in the README
- [ ] User-visible changes are added to `CHANGELOG.md` under `## [Unreleased]`
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, etc.)

## Reporting bugs

Please use the bug-report issue template and include:

- LiteLLM version (`litellm --version`)
- OpenCode version
- Node.js / Bun version & OS
- Relevant `[opencode-litellm]` log lines
- A minimal `opencode.json` / `litellm config.yaml` that reproduces the issue

## Releasing (maintainers)

1. Bump version in `package.json` (semver).
2. Update `CHANGELOG.md` — move `Unreleased` items under a new dated heading.
3. Commit: `git commit -am "release: vX.Y.Z"`
4. Tag & push: `git tag vX.Y.Z && git push --follow-tags`
5. Create the GitHub release with notes copied from the changelog.
6. The `release.yml` workflow auto-publishes to npm (requires `NPM_TOKEN` repo secret).

## Code of conduct

Be kind. Assume good intent. We follow the [Contributor Covenant](https://www.contributor-covenant.org/).
