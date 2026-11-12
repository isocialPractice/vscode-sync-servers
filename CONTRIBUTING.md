# Contributing

Thank you for helping. This guide covers setup, the test commands and the
conventions every change follows. Security problems go through
[SECURITY.md](SECURITY.md), never through an issue or a pull request.

## Requirements

- Node.js 22.18 or later. The build and helper scripts run as TypeScript
  through Node's type stripping.
- VS Code 1.101 or later, the oldest release the extension supports: the
  first whose extension host runs Node.js 22.
- Git.

## Setup

```sh
git clone https://github.com/isocialPractice/vscode-sync-servers.git
cd vscode-sync-servers
npm ci --ignore-scripts
npm run build
```

The engine, `@isocialpractice/cmd-sync-servers`, is an npm dependency
pinned to an exact version and checked by its integrity hash in
`package-lock.json`. Dependencies never run install scripts. Builds and
tests are started explicitly with the commands below, never from npm
lifecycle hooks.

To move to a new engine version, set it in `package.json`, run
`npm install --ignore-scripts` so `package-lock.json` records it, then
`npm run notices`. Dependabot proposes engine updates like any other
dependency.

To try engine changes that are not published yet, run `npm pack` in a
clone of `cmd-sync-servers` after building it, then
`npm install --ignore-scripts --no-save <path-to-the-tarball>` here.
`npm ci` puts the pinned version back.

## Commands

| Command | Does |
| --- | --- |
| `npm run build` | Bundles `src/extension.ts` and the engine into `out/extension.js`, and the Site Settings page into `media/dist/site-settings.js`, with esbuild |
| `npm run watch` | Rebuilds on every change; F5 starts it |
| `npm run typecheck` | Type checks `src/`, `test/` and `scripts/` |
| `npm run lint` | ESLint with type-aware rules |
| `npm test` | Unit tests, the documentation tests, then integration tests |
| `npm run test:unit` | Builds, then runs `test/unit/` with `node:test` |
| `npm run test:docs` | Runs `test/docs/`: the pages, their links and contrast, and the leak scan |
| `npm run test:integration` | Builds, then runs `test/integration/` inside VS Code 1.101.0 and the current release with `@vscode/test-cli` |
| `npm run docs:site` | Copies `docs/` into `_site/`, the folder GitHub Pages publishes |
| `npm run release:check -- v<version>` | Fails unless the tag, `package.json`, `package-lock.json` and `CHANGELOG.md` agree on an alpha version |
| `npm run package` | Builds and writes `vscode-sync-servers-<version>.vsix` |
| `npm run pack:check` | Builds, packages, and fails if the `.vsix` holds anything outside its allowlist |
| `npm run notices` | Rewrites `THIRD_PARTY_NOTICES.md` from the packages in the bundle |
| `npm run icon` | Draws `media/sync-servers.svg` and `media/icon.png` from `scripts/draw-icon.mts` |

Run `npm run lint`, `npm run typecheck` and `npm test` before every pull
request. CI runs the integration tests on Linux, macOS and Windows, against
VS Code 1.101 and the current release.

## The Site Settings Page

Site Settings is the extension's one webview, built without a UI framework:

| Folder | Holds |
| --- | --- |
| `src/shared/` | The zod schemas of every message between the page and the extension, used by both sides |
| `src/webview/` | The page's fields, state and view as plain TypeScript with no DOM, so unit tests can read every label and ARIA attribute |
| `src/webview/browser/` | The DOM side: the patcher and the entry point, type checked with their own `tsconfig.json` |
| `src/settings/` | The extension side: the panel, its HTML and Content-Security-Policy, and the check every save goes through |
| `media/site-settings.css` | The stylesheet: theme variables only, through the tokens of [DESIGN_LANGUAGE.md](DESIGN_LANGUAGE.md) |

The rules the page keeps:

- No inline script, style or event handler, no remote content and no eval:
  the Content-Security-Policy allows the stylesheet and one script with a
  nonce. `zod-jitless.ts` is imported first, so zod never tries `new
  Function`; the page reports any policy violation, and the integration
  tests fail on one.
- Text is inserted as text, never as HTML.
- Every message is parsed with its schema on arrival and dropped when it
  does not match. The page never receives a password, only whether one is
  saved.
- The form edits a draft. The engine's own schema checks every save, and the
  problems come back to the field they belong to.

## Running and Debugging

Open the folder in VS Code and press F5. **Run Extension (test settings
folder)** starts a second VS Code window with the extension loaded and the
list of sites kept in `.tmp/home/`, so your own sites are never touched.
**Run Extension (your own sites)** uses your real list.

## Tests

- Tests are written in TypeScript and bundled by esbuild into `out/test/`,
  the same way as the extension, so they run the code that ships.
- Unit tests in `test/unit/` use `node:test` and `node:assert`, and never
  import `vscode`. They check the manifest against the identifiers in
  `src/contributions.ts`, the bundle's contents, and the workflows.
- Integration tests in `test/integration/` use Mocha's `suite` and `test`
  and run inside the VS Code builds that `@vscode/test-cli` downloads into
  `.vscode-test/`: the current release and 1.101.0, the oldest supported.
  `npm run test:integration -- --label stable` or `--label minimum` runs one
  of them. They point `SYNC_SERVERS_HOME` at a fresh temp folder and set
  `SYNC_SERVERS_KEYRING=off`, so no test reads or writes your real list of
  sites. Each run also starts VS Code with its own short user data folder
  in the temp folder, so a VS Code window already open never takes over
  the test window, and the IPC socket path stays within the 103 characters
  macOS allows.
- Everything the extension asks goes through the `Prompter` interface in
  `src/ui/prompt.ts`, so the flows behind the quick inputs and dialogs run
  without VS Code's UI. Tests answer with `ScriptedPrompter` from
  `test/helpers/prompter.ts`, which fails on a question the script did not
  expect and on an answer the question's own validation refuses.
- When VS Code runs the tests, `activate` returns a `TestApi`: the model of
  the list of sites, the views, the status bar, the Explorer marks, upload
  on save, the credential store, the log records, a way to swap in a
  `ScriptedPrompter`, and `useTrust(false)`, which makes the extension act
  as in Restricted Mode. VS Code's test runner always trusts the workspace,
  so every check of trust goes through that one switch. The `TestApi` is
  returned in no other mode.
- The integration tests run the real `sync-servers` command line from the
  engine as a child process on the extension host's own Node.js, with the
  same temporary `SYNC_SERVERS_HOME`, to prove both front ends see one list.
- Tests never connect to a real server. Protocol coverage lives in the
  engine's suite, whose sandbox servers listen on `127.0.0.1` with
  credentials generated for each run; the extension's tests connect to
  `local` folder servers.
- `test/integration/synchronize.test.ts` runs the synchronization scenarios
  that apply to a `local` folder server through the extension's own
  commands and the Sync Preview: first syncs, edits, conflicts and each way
  of resolving them, deletes, orphans, the mass-delete and empty-root
  guards, cloaking, the sensitive-file guard, stale files, a cancelled run,
  Put, Get and Compare. Names a local folder cannot hold, case twins and
  links outside the site run on Linux only, where such names can be made.
- Passwords in tests are generated for each run and compared with
  `assert.ok`, so a failing assertion never prints one.
- Never commit a private key, certificate or password, even a test one.

## The Documentation Site

The site is static HTML in `docs/` with one stylesheet,
`docs/assets/site.css`, and no script. Every page carries the same header
navigation and a Content-Security-Policy that allows its own stylesheet and
images only. `pages.yml` publishes it to GitHub Pages after `test:docs`
passes on a push to `main` that touches `docs/`.

`test:docs` checks that every page has one `h1`, the shared navigation, a
caption on every table and working links and anchors; that the command and
settings page lists every command title and setting key of the manifest;
that every colour pair in the stylesheet meets WCAG AA contrast; and that
the README stays short and links the site. Its leak scan reads `docs/`,
`src/`, `test/`, `scripts/`, `media/`, `.github/` and the top-level
documents for email addresses, user profile paths, IP addresses, hidden or
bidirectional characters and carriage returns. A file at
`.claude/leak-denylist.txt`, one term per line and never committed, adds
terms of your own.

## Releases

A release starts from a published GitHub pre-release whose tag is
`v<version>`. `release.yml` checks out that tag, installs the pinned engine
from npm, runs `release:check`, lint, type checks, the unit,
documentation and integration tests and `pack:check`, then attaches the
`.vsix`, a CycloneDX SBOM of the bundled packages, `SHA256SUMS` and a build
provenance attestation to the release. The job that attests never runs the
repository's code, and an asset already on the release is never replaced.
Users verify a download with `gh attestation verify`, as the documentation
site's Security and Trust page shows.

## Placeholder Data

Documentation, examples, code comments and test fixtures use generic
placeholders only, never a real person, host, site, folder or file name:

| Kind | Use |
| --- | --- |
| Site names | `My Site`, `Sample App` |
| Organizations | `Acme Corp`, `Contoso` |
| Hosts | `sftp.example.com`, `ftp.example.org` |
| Users and email | `demo-user`, `jane.doe@example.com`; `<user>` in profile paths |
| Windows paths | `C:\Users\<user>\Sites\my-site\` |
| POSIX paths | `~/sites/my-site/` |

Match the placeholder to its context: Windows paths in Windows examples,
POSIX paths in shell examples.

## Writing Style

- State what the code or the extension does. Changelog lines state the
  change.
- Use a hyphen, a colon or a new sentence, never an em or en dash.
- Follow [DESIGN_LANGUAGE.md](DESIGN_LANGUAGE.md) for anything the user
  sees: theme colours only, the four states on every control, and its copy
  rules.

## Commits and the Changelog

- One logical change per commit, with a message that says what changed.
- Stage files by explicit path. Local working folders (`.claude/`,
  `.support/`, `.archive/`, `.tmp/`) and workspace files are git-ignored and
  never committed.
- Add a line to the newest version, the top section of
  [CHANGELOG.md](CHANGELOG.md), for every user-visible change, under Added,
  Changed, Deprecated, Removed, Fixed or Security. There is no
  `## [Unreleased]` section: work in progress is written into the version
  being worked on. Start a breaking change with **Breaking:** and list it
  first under its heading.

## Versions

Until `1.0.0`, versions use the pre-release form `1.0.0-alpha.x.y.z`:

| Change | Example |
| --- | --- |
| A completed update | `1.0.0-alpha.0.1.0` to `1.0.0-alpha.0.2.0` |
| A fix between updates | `1.0.0-alpha.0.2.0` to `1.0.0-alpha.0.2.1` |
| A breaking change once an alpha is published | `1.0.0-alpha.0.6.2` to `1.0.0-alpha.1.0.0` |

A version bump changes `package.json`, `package-lock.json` and
`CHANGELOG.md` in one commit. A unit test fails when they disagree. Alphas
are attached to GitHub pre-releases as `.vsix` files; the Marketplace and
Open VSX follow at `1.0.0`.

## Dependencies

The extension has one runtime dependency, the engine, and bundles it with
its own dependencies. A pull request that adds a runtime dependency names
the package, its licence and why it is needed, and runs `npm run notices`.
Copyleft licences are not accepted. `package-lock.json` is committed, and CI
installs with `npm ci --ignore-scripts`.
