---
name: release
description: Prepare, publish, verify, and recover sa releases. Use for release preparation, local release smoke tests, publishing, and failed release CI or announcements.
---

# Releasing sa

Run repository commands from the repo root (two directories above this skill), unless instructed otherwise.

**Lockstep versioning**: all packages share one version; every release updates all together. `patch` = fixes + additions, `minor` = breaking changes. No major releases.

1. **Update CHANGELOGs**: ask the user whether they ran the `/cl` prompt on the latest commit on `main`. If not, they must run `/cl` first to audit and update each package's `[Unreleased]` section before releasing.

2. **Local smoke test**: build an unpublished release and smoke test from outside the repo (so it can't resolve workspace files):
   ```bash
   npm run release:local -- --out /tmp/sa-local-release --force
   cd /tmp

   # Node package install smoke tests
   /tmp/sa-local-release/node/sa --help
   /tmp/sa-local-release/node/sa --version
   /tmp/sa-local-release/node/sa --list-models
   /tmp/sa-local-release/node/sa -p "Say exactly: ok"
   /tmp/sa-local-release/node/sa

   # Bun binary smoke tests
   /tmp/sa-local-release/bun/sa --help
   /tmp/sa-local-release/bun/sa --version
   /tmp/sa-local-release/bun/sa --list-models
   /tmp/sa-local-release/bun/sa -p "Say exactly: ok"
   /tmp/sa-local-release/bun/sa
   ```
   Verify both Node and Bun startup, model/account listing, interactive startup, and at least one real prompt with the intended default provider. The bare commands `/tmp/sa-local-release/node/sa` and `/tmp/sa-local-release/bun/sa` start interactive mode; run each in tmux, submit a prompt, and wait for the model reply before considering the interactive smoke test passed. Failures are release blockers unless the user explicitly accepts the risk.

   Load and follow [interactive-testing.md](interactive-testing.md) for the tmux workflow. Start each release binary from `/tmp`, not the repo root.

3. **Run the release script**:
   ```bash
   SA_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:patch    # fixes + additions
   SA_ALLOW_LOCKFILE_CHANGE=1 npm_config_min_release_age=0 npm run release:minor    # breaking changes
   ```
   If the test suite already passed in `npm run release:local` and only fails from machine load, `SA_RELEASE_SKIP_TESTS=1` skips `./test.sh` in the release script; checks and the packed install check still run. Use it only with the user's approval.

   Use `npm_config_min_release_age=0` only for the release command. The repo's normal npm age gate can otherwise block the release lockfile refresh when the current workspace package version was published recently. Review any lockfile or install lock diffs the release creates before push.

   Nix builds from the model data committed in `packages/ai/src/providers/data/`; there is no model catalog pin to update. The release script bumps all package versions, updates changelogs, regenerates release artifacts, runs `npm run check`, commits `Release vX.Y.Z`, tags `vX.Y.Z`, adds fresh `## [Unreleased]` changelog sections, commits `Add [Unreleased] section for next cycle`, then pushes `main` and the tag. Do not rerun the release script after a tag was pushed.

4. **CI builds binaries and publishes the GitHub Release**: pushing the `vX.Y.Z` tag triggers `.github/workflows/build-binaries.yml`. GitHub Release publishing does not depend on npm. To publish packages to npm as well, run the workflow manually with `publish_npm` enabled after configuring npm trusted publishing and the `npm-publish` environment.

5. **CI builds the Nix release**: the tag push also triggers `.github/workflows/nix.yml`, which builds the tagged flake on Linux and macOS from the committed model data and then fast-forwards the `stable` branch to the release commit. `nix run .#sa` runs the checkout's SA. If the Nix build fails, `stable` stays on the previous release; the tag cannot be fixed, so fix `main` and ship the fix in the next release.

6. **If CI publish fails**: inspect the failed job. GitHub Release publishing is independent of npm; rerun the failed job or workflow after fixing CI or transient issues. Do not rerun `npm run release:patch` or `npm run release:minor` for the same version.
