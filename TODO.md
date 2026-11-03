# TODO - vscode-sync-servers

## Current

The work queued for the next run, moved from the phase sections below. Each
item keeps a nested `From:` line recording the section it came from, so its
origin survives archiving into `## Complete`. Every item's **Goal** links to
the step of the plan that specifies it. The links resolve from this
repository's final place beside `cmd-sync-servers`; until the move in Phase
X0, the plan is at `../.claude/prompts/init-sync-servers.prompt.md`.

- [x] Scaffold the extension: the manifest with its contribution skeleton,
      TypeScript, the esbuild bundle, ESLint, `@vscode/test-cli`, the
      `.vscodeignore` allowlist, the ignore rules and the F5 launch
      configuration
  - **Goal**: Resolve to [Phase X0, step 1](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x0-foundation-and-the-move)
  - From: version.control = null
- [x] Project documents, with `DESIGN_LANGUAGE.md` written with the
      `graphic-designer` skill: tokens, states, icon specification and
      mockups
  - **Goal**: Resolve to [Phase X0, step 2](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x0-foundation-and-the-move)
  - From: version.control = null
- [x] CI with the engine checked out beside the extension, CodeQL,
      dependency review, Scorecard and Dependabot, every action pinned by
      commit SHA
  - **Goal**: Resolve to [Phase X0, step 3](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x0-foundation-and-the-move)
  - From: version.control = null
- [x] An activation test proving the views and commands register
  - **Goal**: Resolve to [Phase X0, step 4](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x0-foundation-and-the-move)
  - From: version.control = null
- [x] Measure the `engines.vscode` floor and record it in the plan's
      departures list
  - **Goal**: Resolve to [Phase X0, step 5](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x0-foundation-and-the-move)
  - From: version.control = null

## Phase X0 - The Move - paused

Moves this folder out of `cmd-sync-servers` to the parent folder, where it
becomes its own repository. Removing `- paused` from this heading is the
approval.

- [ ] Move to `../vscode-sync-servers/`, drop `/vscode-sync-servers/` from the
      engine's `.gitignore`, `git init -b main`, set the engine dependency to
      `file:../cmd-sync-servers`, install, build, test and commit
  - **Goal**: Resolve to [Phase X0, step 6](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x0-foundation-and-the-move)
  - From: version.control = null

## Phase X1 - Engine Integration and the Sites View

Next version: minor. Needs the engine's Phase E3, which is complete, and
this repository's Phase X0.

- [x] The VS Code `HostAdapter` and the registry watcher
  - **Goal**: Resolve to [Phase X1, step 1](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x1-engine-integration-and-the-sites-view)
- [x] The Sites view with its welcome content and context menus
  - **Goal**: Resolve to [Phase X1, step 2](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x1-engine-integration-and-the-sites-view)
- [x] Add Site, Remove Site, Switch Site and Open Site Folder
  - **Goal**: Resolve to [Phase X1, step 3](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x1-engine-integration-and-the-sites-view)
- [x] Test Connection with the host key modal, password commands, Show Log
      and the status bar item
  - **Goal**: Resolve to [Phase X1, step 4](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x1-engine-integration-and-the-sites-view)

## Phase X2 - Site Settings

Next version: minor. Waits for the engine's Phase E3.

- [x] The Site Settings webview: categories, the servers table, and the
      Basic and Advanced server editor
  - **Goal**: Resolve to [Phase X2, step 1](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x2-site-settings)
- [x] The cloaking editor with its live match count
  - **Goal**: Resolve to [Phase X2, step 2](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x2-site-settings)
- [x] CSP, nonce, message schemas in both directions, and malformed-message
      tests
  - **Goal**: Resolve to [Phase X2, step 3](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x2-site-settings)
- [ ] Checks in light, dark and both high contrast themes, at 200 % zoom and
      with keyboard only
  - **Goal**: Resolve to [Phase X2, step 4](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x2-site-settings)

## Phase X3 - Synchronize and Preview

Next version: minor. Waits for the engine's Phase E3.

- [x] The three-step sync quick input modelled on the synchronize dialog
  - **Goal**: Resolve to [Phase X3, step 1](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x3-synchronize-and-preview)
- [x] The Sync Preview view: groups with counts, checkboxes, Resolve rows and
      title actions
  - **Goal**: Resolve to [Phase X3, step 2](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x3-synchronize-and-preview)
- [x] Execution with cancellable progress, the typed mass-delete
      confirmation and the summary notification
  - **Goal**: Resolve to [Phase X3, step 3](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x3-synchronize-and-preview)
- [x] Compare with the remote copy, Mark Synchronized, and Put and Get for
      files
  - **Goal**: Resolve to [Phase X3, step 4](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x3-synchronize-and-preview)

## Phase X4 - Explorer Integration and Upload on Save

Next version: minor. Waits for the engine's Phase E3.

- [x] Explorer decorations for cloaked, changed and conflicting files
  - **Goal**: Resolve to [Phase X4, step 1](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x4-explorer-integration-and-upload-on-save)
- [x] Explorer and editor context menus, Cloak and Uncloak
  - **Goal**: Resolve to [Phase X4, step 2](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x4-explorer-integration-and-upload-on-save)
- [x] The Remote Files view
  - **Goal**: Resolve to [Phase X4, step 3](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x4-explorer-integration-and-upload-on-save)
- [x] Upload on save and the Testing server push
  - **Goal**: Resolve to [Phase X4, step 4](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x4-explorer-integration-and-upload-on-save)
- [x] Restricted mode in untrusted workspaces, with tests
  - **Goal**: Resolve to [Phase X4, step 5](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x4-explorer-integration-and-upload-on-save)

## Phase X5 - Documentation, Release and Accessibility

Next version: minor. Needs the engine's Phase E5, which is complete.

- [x] The docs site, `pages.yml` and `test/docs` with the leak scan
  - **Goal**: Resolve to [Phase X5, step 1](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x5-documentation-release-and-accessibility)
- [x] `release.yml` producing the `.vsix`, SBOM, checksums and attestation
  - **Goal**: Resolve to [Phase X5, step 2](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x5-documentation-release-and-accessibility)
- [ ] The accessibility pass: keyboard only, a screen reader, high contrast,
      200 % zoom. The code review is done: every tree item, message row and
      the status bar item has an accessible label, and the tests drive every
      flow by command. Listening with a screen reader and looking by eye are
      in User Use Only
  - **Goal**: Resolve to [Phase X5, step 3](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x5-documentation-release-and-accessibility)
- [x] The `graphic-designer` design review, with every finding fixed: pressed
      states for categories, tabs and buttons, disabled buttons that ignore
      the pointer, the high contrast hover edge on tabs, and the states table
      in `DESIGN_LANGUAGE.md` extended to tabs
  - **Goal**: Resolve to [Phase X5, step 4](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#phase-x5-documentation-release-and-accessibility)

## Simplify Site Setup

Version `1.0.0-alpha.1.0.0`, built against the engine's
`1.0.0-alpha.1.0.0`. The integration tests reach no FTPS or SFTP server,
since the sandbox servers belong to the engine's tests: they cover a
refused connection on 127.0.0.1 and local folder servers, and the unit
tests cover the certificate modal and Add Site against a fake connection.

- [x] Build the engine and type check the extension against it
  - **Goal**: Resolve to [Phase S4, step 1](../cmd-sync-servers/.claude/prompts/simplify-setup.prompt.md#phase-s4-the-vs-code-extension)
- [x] The host adapter: `confirmCertificate`, `secretAccepted` and the
      secret prompt's note
  - **Goal**: Resolve to [Phase S4, step 2](../cmd-sync-servers/.claude/prompts/simplify-setup.prompt.md#phase-s4-the-vs-code-extension)
- [x] Add Site with the probe, the decisions, sign-in retries, the failure
      quick picks, the remote root picker and `parseServerAddress`
  - **Goal**: Resolve to [Phase S4, step 3](../cmd-sync-servers/.claude/prompts/simplify-setup.prompt.md#phase-s4-the-vs-code-extension)
- [x] Site Settings: labels, Host validation, Test with unsaved values,
      Browse... for the root directory, the trusted certificate, and the
      `tidyTls` fix
  - **Goal**: Resolve to [Phase S4, step 4](../cmd-sync-servers/.claude/prompts/simplify-setup.prompt.md#phase-s4-the-vs-code-extension)
- [x] Test Connection's repair actions, `error-text.ts`, and Open sites.json
  - **Goal**: Resolve to [Phase S4, step 5](../cmd-sync-servers/.claude/prompts/simplify-setup.prompt.md#phase-s4-the-vs-code-extension)
- [x] Version `1.0.0-alpha.1.0.0`, the changelog without `## [Unreleased]`,
      `ENGINE_REF`, notices, CONTRIBUTING and the pull request template
  - **Goal**: Resolve to [Phase S4, step 6](../cmd-sync-servers/.claude/prompts/simplify-setup.prompt.md#phase-s4-the-vs-code-extension)
- [x] Unit and integration tests
  - **Goal**: Resolve to [Phase S4, step 7](../cmd-sync-servers/.claude/prompts/simplify-setup.prompt.md#phase-s4-the-vs-code-extension)
- [x] The extension's documents
  - **Goal**: Resolve to [Phase S4, step 8](../cmd-sync-servers/.claude/prompts/simplify-setup.prompt.md#phase-s4-the-vs-code-extension)
- [x] The extension's checks, and the commit or the list of changed files
  - **Goal**: Resolve to [Phase S4, step 9](../cmd-sync-servers/.claude/prompts/simplify-setup.prompt.md#phase-s4-the-vs-code-extension)

## Patches 1.0.0-alpha.1.0.0

Next version: none. Every item adds to `1.0.0-alpha.1.0.0`, built against
the engine's `1.0.0-alpha.1.0.0` with its global cloaking patterns.

- [x] Build the engine and type check the extension against it
  - **Goal**: Resolve to [Phase P5, step 1](../cmd-sync-servers/.claude/prompts/patches-1.0.0-alpha.1.0.0.prompt.md#phase-p5-the-vs-code-extension)
- [x] Global patterns wherever the extension cloaks, following changes to
      the list of sites
  - **Goal**: Resolve to [Phase P5, step 2](../cmd-sync-servers/.claude/prompts/patches-1.0.0-alpha.1.0.0.prompt.md#phase-p5-the-vs-code-extension)
- [x] Site Settings keeps `useGlobalPatterns`, with the Use global patterns
      checkbox, the global patterns, Edit Global Patterns... and the count
  - **Goal**: Resolve to [Phase P5, step 3](../cmd-sync-servers/.claude/prompts/patches-1.0.0-alpha.1.0.0.prompt.md#phase-p5-the-vs-code-extension)
- [x] The Global Cloaking Patterns... command
  - **Goal**: Resolve to [Phase P5, step 4](../cmd-sync-servers/.claude/prompts/patches-1.0.0-alpha.1.0.0.prompt.md#phase-p5-the-vs-code-extension)
- [x] Tests, documents and changelog
  - **Goal**: Resolve to [Phase P5, step 5](../cmd-sync-servers/.claude/prompts/patches-1.0.0-alpha.1.0.0.prompt.md#phase-p5-the-vs-code-extension)
- [x] The extension's checks, and the list of changed files
  - **Goal**: Resolve to [Phase P5, step 6](../cmd-sync-servers/.claude/prompts/patches-1.0.0-alpha.1.0.0.prompt.md#phase-p5-the-vs-code-extension)

## Symbolic Links

Next version: minor. The items make `1.0.0-alpha.1.1.0`, built against the
engine's `1.0.0-alpha.1.1.0`, which follows symbolic links in a site's
local folder.

- [x] Build the engine and type check the extension against it
  - **Goal**: Resolve to [Phase L4, step 1](../cmd-sync-servers/.claude/prompts/symlinks-work.prompt.md#phase-l4-the-vs-code-extension)
- [x] `follow` in the site data, the Symbolic links field of Site Settings
      and the page bundle
  - **Goal**: Resolve to [Phase L4, step 2](../cmd-sync-servers/.claude/prompts/symlinks-work.prompt.md#phase-l4-the-vs-code-extension)
- [x] Explorer marks of linked files in a site that follows links
  - **Goal**: Resolve to [Phase L4, step 3](../cmd-sync-servers/.claude/prompts/symlinks-work.prompt.md#phase-l4-the-vs-code-extension)
- [x] Tests, documents, version and changelog
  - **Goal**: Resolve to [Phase L4, step 4](../cmd-sync-servers/.claude/prompts/symlinks-work.prompt.md#phase-l4-the-vs-code-extension)
- [x] The extension's checks, and the list of changed files
  - **Goal**: Resolve to [Phase L4, step 5](../cmd-sync-servers/.claude/prompts/symlinks-work.prompt.md#phase-l4-the-vs-code-extension)

## Later Roadmap - paused

Waits until both alphas are public; each item then becomes its own section.

- [ ] Edit remote files in place through a `FileSystemProvider`
  - **Goal**: Resolve to [Later roadmap, item 9](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#17-later-roadmap)
- [ ] A first-run walkthrough
  - **Goal**: Resolve to [Later roadmap, item 9](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#17-later-roadmap)
- [ ] Localization
  - **Goal**: Resolve to [Later roadmap, item 9](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#17-later-roadmap)
- [ ] One site per folder in multi-root workspaces
  - **Goal**: Resolve to [Later roadmap, item 9](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#17-later-roadmap)
- [ ] `1.0.0`: Marketplace and Open VSX publishing, the alpha suffix dropped
  - **Goal**: Resolve to [Later roadmap, item 10](../cmd-sync-servers/.claude/prompts/init-sync-servers.prompt.md#17-later-roadmap)

## User Use Only

Steps only the owner takes, because each changes state outside this machine.

- [ ] Review `.tmp/vscode/launch.json`, `tasks.json` and `extensions.json`
      and move them into `.vscode/`, and add `.npmrc` with the line
      `ignore-scripts=true` (`.tmp/vscode/npmrc`); automated runs cannot
      write these files
- [ ] Delete `test/integration/zz-secret-probe.test.ts`, an empty file left
      by a probe that automated runs cannot delete
- [ ] Look at Site Settings by eye in a light, a dark and both high
      contrast themes, at 200 % zoom, and with the keyboard only. The tests
      open it in each and check it draws without a problem, but cannot see
      it
- [ ] Listen to the Sites, Remote Files and Sync Preview views, the status
      bar item and Site Settings with NVDA on Windows and VoiceOver on
      macOS, and run Add Site and Synchronize... with the keyboard only
- [ ] Enable GitHub Pages with GitHub Actions as its source once the
      repository exists, then run `pages.yml`
- [ ] Set the `ENGINE_REF` repository variable to `v1.0.0-alpha.1.0.0` or
      later once that engine tag exists: the extension needs its connection
      probe, certificate decisions and address parsing
- [ ] Approve the move by removing `- paused` from "Phase X0 - The Move"
- [ ] Create the public repository `isocialPractice/vscode-sync-servers`,
      push `main`, apply the settings of plan section 11.7, and set the
      `ENGINE_REF` repository variable to the engine's latest tag
- [ ] Unpause X1 to X4 when the engine's Phase E3 is complete, and X5 when
      its Phase E5 is complete
- [ ] Approve and create the first public pre-release, then install its
      `.vsix` on Windows, macOS and Linux and synchronize a copy of a site
      against `npm run sandbox` from the engine
