# Changelog

All notable changes to **vscode-sync-servers** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Until the first stable release, versions use the pre-release form
`1.0.0-alpha.x.y.z`, where `x.y.z` counts alpha iterations toward `1.0.0`.

## [1.0.0-alpha.1.2.1] - 2026-11-12

### Fixed

- Get finds the site of a file that is only on the server, from the
  Explorer or Remote Files, when the site's folder is reached through a
  symbolic link or a Windows short name.
- Test in Site Settings finds a local folder server whose path holds a
  Windows short name.
- A change made in VS Code shows at once in the Sites view and the
  Explorer marks: a reload of `sites.json` that ran at the same moment no
  longer puts back the list from before the change.

### Changed

- The integration tests start VS Code with a short user data folder of
  their own, so they run in a deep checkout on macOS, and run the command
  line beside the extension host instead of blocking it.

## [1.0.0-alpha.1.2.0] - 2026-11-03

### Changed

- The engine comes from npm: `@isocialpractice/cmd-sync-servers` `1.0.0`,
  pinned to that version and checked by its integrity hash in
  `package-lock.json`. A fresh clone builds with `npm ci` alone, without a
  copy of the engine beside it.
- CI, the documentation site and releases install the engine with the other
  dependencies; the `ENGINE_REF` repository variable is no longer used.
- Dependabot proposes engine updates like any other dependency.

## [1.0.0-alpha.1.1.0] - 2026-11-03

### Added

- Follow all links in Site Settings' Symbolic links field, beside Skip
  them and Follow links inside the site. A site that follows links puts and
  gets them as the files and folders they point to, with the engine
  `1.0.0-alpha.1.1.0`.

### Changed

- In a site that follows links, a linked file in the Explorer carries the
  mark of the file it points to.

## [1.0.0-alpha.1.0.0] - 2026-11-02

### Changed

- **Breaking:** Add Site connects before it adds anything. It asks for the
  site name, the local folder, Protocol, Host, User and the password, then
  connects, asks about a new host key or certificate, and lets you pick the
  root directory from what the server shows. It no longer asks for a server
  name, since the server is named after its host and can be renamed in Site
  Settings, nor for a typed root directory, except after Save Without
  Testing.
- **Breaking:** the extension needs the engine `1.0.0-alpha.1.0.0`, whose
  `sites.json` holds the host name or IP address alone in `host`. A value
  with a port, a user, a protocol or a folder no longer loads, and the
  message names the field to use instead.
- Host in Add Site and Site Settings takes what the command line takes:
  `host:port`, `user@host`, and whole addresses such as
  `sftp://sftp.example.com/var/www`. In Site Settings, `host:port` fills
  Port.
- A refused sign-in in Add Site asks for the user and password again, up to
  three times. A failed connection then offers Change the Host or Try
  Again, Save Without Testing, and Cancel; Cancel adds nothing.
- The password typed in Add Site is saved only after the server accepts it.
- Site Settings says Protocol, Host and User. Test connects with the values
  the form shows, saved or not, and puts what the connection decided, such
  as another host the certificate covers or a trusted host key, into the
  form for you to save. Web URL moved to the Advanced tab.
- Test Connection repairs what it finds: Choose Folder picks a root
  directory that was not found from what the server shows, then saves it
  and tests again; Sign In Again asks for the user and password; Edit Host
  opens Site Settings at the server.
- Messages about certificates, root directories and saved passwords name
  the extension's own actions instead of command-line commands.

### Added

- FTPS certificates that fail verification are shown in a modal with their
  names, issuer, validity dates and SHA-256 fingerprint, with the choices
  Connect to a host name the certificate covers, Check as that name, Trust
  and Remember, and Trust Once. Expired and not-yet-valid certificates can
  only be cancelled. Each decision is logged with names and fingerprints
  only.
- Browse... beside the root directory in Site Settings, and the remote root
  picker it opens: Use This Folder, `..`, and the folders the server shows;
  a typed path goes there once it exists. Choosing `/` asks once whether
  synchronizing may delete files there.
- A trusted certificate shows on the Advanced tab of an FTPS server, with
  Forget Certificate.
- Once a server accepts a password you typed when asked, a notification
  offers Save Password, which keeps it in VS Code's secret storage for the
  server as it is.
- When a saved password is not sent because the server's protocol, host,
  port or user changed, the password box says so.
- Open sites.json beside a message that `sites.json` is not valid.
- Global cloaking patterns, which every site uses before its own and the
  command line shares: Sync Servers: Global Cloaking Patterns... adds and
  removes them, and the Explorer marks, the Remote Files view, upload on
  save and the count in Site Settings follow them. Site Settings shows
  them in the Cloaking category, with Use global patterns to turn them
  off for one site and Edit Global Patterns... to change them.

## [1.0.0-alpha.0.5.0] - 2026-10-30

### Added

- The documentation site: getting started, Site Settings, Synchronize,
  files and cloaking, upload on save, every command and setting, security
  and trust, and troubleshooting. It is published to GitHub Pages from
  `docs/` and checked for broken links, contrast and leaked data first.
- Releases: a published GitHub pre-release gets its `.vsix`, a CycloneDX
  SBOM, `SHA256SUMS` and a build provenance attestation, built and tested
  from its tag.

### Changed

- Site Settings: categories, tabs and buttons show a pressed state, a
  disabled button keeps its colour under the pointer, and a tab under the
  pointer gains a dashed edge in high contrast themes.

### Fixed

- A screen reader reads the kind of a message row in the Remote Files view,
  "Error" or "Warning", before its text.

## [1.0.0-alpha.0.4.0] - 2026-10-30

### Added

- Explorer marks for the active site: cloaked files and folders dimmed with
  ⊘, files changed or added since the last sync with ↑, and files that need
  a decision with ! in the warning colour, each with a tooltip. They are
  worked out from the last sync's records, after every sync and on save,
  never from the server. `syncServers.decorations.enabled` turns them off.
- Put, Get, Compare with Remote, Synchronize..., Cloak and Uncloak in the
  Explorer's context menu, and Put, Get and Compare with Remote in the
  editor's, for the files of the active site.
- Cloak and Uncloak: single files and folders cloaked from the Explorer;
  Uncloak says when a file is cloaked by a pattern or a cloaked folder
  instead.
- The Remote Files view: the active site's Remote server, listed one folder
  at a time, with ↓ on files changed or added there since the last sync.
  Open Read-Only, Get, Compare with Remote, Cloak and Delete on Server,
  which asks first.
- Upload on save: a saved file is put to each server whose Upload on save
  option is on, the Testing server among them, once per burst of saves.
  `syncServers.uploadOnSave.enabled` stops it everywhere.

### Changed

- Needs cmd-sync-servers 1.0.0-alpha.0.6.1, which counts a local file saved
  again within the time tolerance of its last sync as changed.

### Security

- Upload on save never puts a cloaked file or one that matches a sensitive
  pattern, and never runs in Restricted Mode, where every other write to a
  server asks first.
- A file changed on the server too is never overwritten on save; it waits
  for Synchronize.

## [1.0.0-alpha.0.3.0] - 2026-10-30

### Added

- Synchronize...: Dreamweaver's three questions as a quick input (what to
  synchronize when files are chosen in the Explorer, which way, and the
  delete option worded for the direction), with each site's last answers
  chosen, then a cancellable comparison of both sides.
- The Sync Preview view: every file with a difference, grouped as Resolve,
  Put, Get, Delete remote, Delete local, Guarded, Skip and Errors with
  their counts, or by folder with `syncServers.preview.groupBy`. Rows have
  checkboxes; files that need a decision get Use Local, Use Remote, Skip and
  Compare inline, and Mark Synchronized and the deletes in the context menu.
  Check All, Uncheck All and Close Preview are in its title bar.
- Synchronize Checked Files runs the checked rows with cancellable progress,
  then reports `Synchronized 36 files. 1 failed.`; a run with failures keeps
  them in the view with their reasons.
- Compare with Remote shows the server's copy, read-only, beside the local
  file; a binary file shows both copies' sizes, times and SHA-256 hashes.
- Put and Get for the active file, files chosen in the Explorer, or a whole
  site, through the same plan and guards: a file that needs a decision, a
  held-back file or a delete opens the preview instead of moving.
- The status bar counts files during a run, and warns while files need a
  decision or after a run with failures.

### Security

- Deletes ask first, listing the files, while `syncServers.confirmDeletes` is
  on; deleting more than the site's limit needs the count typed back. A
  mirror from an empty folder is refused.
- From a workspace in Restricted Mode, anything that writes to a server asks
  first.

## [1.0.0-alpha.0.2.0] - 2026-10-30

### Added

- Site Settings: the site form of Dreamweaver's Site Setup, in the editor
  area. Its categories are Site, Servers, and under Advanced Settings Local
  Info, Cloaking, Synchronization and Security. Every setting of a site and
  its servers can be changed there, checked, saved, and put back with
  Revert.
- The servers table, with the Remote and Testing roles, and a server editor
  with Basic and Advanced tabs: Add, Edit, Duplicate, Remove and Test, and
  Set Password... and Forget Password for a saved server.
- The cloaking patterns show, as they are typed, how many files and folders
  of the local folder they cloak.
- Problems are shown under the field they belong to, and the category or
  server holding one is marked.
- Site Settings opens from the Sites view, the status bar menu and the
  Command Palette.

### Security

- Passwords never enter the Site Settings page: they are typed into VS
  Code's own password box, and the page only learns whether one is saved.
- The page runs under a Content-Security-Policy that allows its own
  stylesheet and one script only. Every message between the page and the
  extension is checked against a schema in both directions and dropped when
  it does not match, and a pinned host key can be kept or forgotten from the
  form but never set.
- A save never overwrites a change the command line made while the form was
  open without asking first.
- Removing a server forgets its saved password.

## [1.0.0-alpha.0.1.0] - 2026-10-29

### Added

- The Sites view lists every site of the list shared with the
  `sync-servers` command line, with its servers and their Remote and Testing
  roles, and follows changes the command line makes without a reload. A list
  that cannot be read is shown with its problem and opens the file.
- Add Site: a short multi-step input for the name, the local folder and the
  first server's protocol, address, user name, root directory and password,
  with Back on every step. Plain FTP needs a second yes.
- Remove Site, Switch Site and Open Site Folder. The site whose folder is
  open is active on its own; Switch Site chooses another for the window and
  records it for the command line.
- Test Connection, with a cancellable progress notification. A host key
  seen for the first time is shown with its fingerprint in a modal warning,
  to trust and remember, trust once, or refuse.
- Set Password... and Forget Password, keeping passwords in VS Code's secret
  storage.
- Reset Sync Information, after a confirmation.
- A status bar item with the active site and its Remote server, which opens
  the site's actions.
- The Sync Servers log carries the engine's records.

### Security

- A saved password is tied to the protocol, address, port and user it was
  saved for, and is never sent after any of them changes.
- Passwords typed into VS Code are removed from every log record.
- Removing a site forgets its saved passwords.

## [1.0.0-alpha.0.0.0] - 2026-10-29

### Added

- Project scaffold: the extension manifest with the Sync Servers view
  container, the Sites, Remote Files and Sync Preview views with their
  welcome content, every command and setting, and Show Log. The extension
  and the cmd-sync-servers engine are bundled into one file.
- Restricted Mode support: a workspace cannot change the folder that holds
  the list of sites, and an untrusted workspace's own values for upload on
  save and delete confirmations are ignored.
- Continuous integration on Linux, macOS and Windows against VS Code 1.101
  and the current release, CodeQL analysis, dependency review, OpenSSF
  Scorecard and Dependabot updates, with every action pinned to a commit.
- A package-content check that fails when the `.vsix` would carry anything
  outside its allowlist, and third-party notices for every bundled package.
- Security policy, contribution guide and design language.

[1.0.0-alpha.1.2.1]: https://github.com/isocialPractice/vscode-sync-servers/releases/tag/v1.0.0-alpha.1.2.1
[1.0.0-alpha.1.2.0]: https://github.com/isocialPractice/vscode-sync-servers/releases/tag/v1.0.0-alpha.1.2.0
