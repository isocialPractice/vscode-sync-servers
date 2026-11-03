# Design Language

How Sync Servers looks, reads and responds inside VS Code. The extension is
a guest in the user's editor: it draws with VS Code's own surfaces and the
user's theme, so it looks right in every light, dark and high contrast
theme without carrying a palette of its own.

## Principles

- **Native first.** Tree views, quick inputs, the status bar, Explorer
  decorations, notifications and diff editors are VS Code's own, so they
  inherit keyboard navigation, screen reader support, high contrast and the
  theme. A webview is used only where no native surface can hold the
  content: the Site Settings form.
- **Theme tokens only.** Every colour in the webview is a `--vscode-*`
  variable reached through a semantic `--ss-*` token. No hex value, no
  third-party font, no image that carries colour.
- **One primary action per surface.** Synchronize in the Sync Preview, Save
  in Site Settings. It is the only control drawn with the button
  background; everything else is secondary. A 5-second squint test at 30 %
  opacity must still find it.
- **Few choices per step.** The sync dialog is three short questions of two
  or three answers each. The preview groups rows by action with counts, so
  the eye lands on Resolve first.
- **Progressive disclosure.** Advanced Settings and the Advanced tab stay
  collapsed until asked for. Row actions appear inline on hover and on
  focus, and every one of them is also in the context menu and the Command
  Palette. Nothing is hover-only.
- **Colour is never the only signal.** Warning and error colours appear only
  for those states, always beside an icon and a word.

## Surfaces

| Surface | Kind | Holds |
| --- | --- | --- |
| Activity bar container "Sync Servers" | Native | The three views |
| Sites view | Native tree | Sites, their servers, Remote and Testing badges |
| Remote Files view | Native tree | The active site's Remote server, listed folder by folder |
| Sync Preview view | Native tree with checkboxes | The pending plan, grouped by action |
| Synchronize... | Native quick input, three steps | Scope, direction, delete option |
| Site Settings | Webview panel | The site form: categories on the left, the form on the right |
| Status bar item | Native | The active site and server, sync progress |
| Explorer marks | Native file decorations | Cloaked, changed and conflicting files |
| Compare | Native diff editor | The remote copy, read-only, beside the local file |
| Messages | Native notifications and modal dialogs | Results, confirmations, host keys |
| Log | Native log output channel | The engine's redacted log |

## Webview Tokens

Components use the semantic tokens; only the token sheet names `--vscode-*`
variables. Foreground and background tokens are used only in the pairs below,
so the theme's own contrast carries over.

| Token | VS Code variable | Role |
| --- | --- | --- |
| `--ss-surface` | `--vscode-editor-background` | The form's background: the 60 % |
| `--ss-text` | `--vscode-foreground` | Labels and values on `--ss-surface` |
| `--ss-text-muted` | `--vscode-descriptionForeground` | Help text and counts on `--ss-surface` |
| `--ss-surface-raised` | `--vscode-sideBar-background` | The category list and the footer: the 30 % |
| `--ss-text-raised` | `--vscode-sideBar-foreground` | Text on `--ss-surface-raised` |
| `--ss-input` | `--vscode-input-background` | Text fields, selects and the cloaking text area |
| `--ss-input-text` | `--vscode-input-foreground` | Text on `--ss-input` |
| `--ss-input-border` | `--vscode-input-border` | The edge of every input |
| `--ss-accent` | `--vscode-button-background` | The one primary button: the 10 % |
| `--ss-accent-text` | `--vscode-button-foreground` | Text on `--ss-accent` |
| `--ss-accent-hover` | `--vscode-button-hoverBackground` | The primary button under the pointer |
| `--ss-secondary` | `--vscode-button-secondaryBackground` | Every other button |
| `--ss-secondary-text` | `--vscode-button-secondaryForeground` | Text on `--ss-secondary` |
| `--ss-secondary-hover` | `--vscode-button-secondaryHoverBackground` | A secondary button under the pointer |
| `--ss-button-border` | `--vscode-button-border` | The edge of every button, where the theme draws one |
| `--ss-selected` | `--vscode-list-activeSelectionBackground` | The chosen category |
| `--ss-selected-text` | `--vscode-list-activeSelectionForeground` | Text of the chosen category |
| `--ss-row-selected` | `--vscode-list-inactiveSelectionBackground` | The chosen row of the servers table, beside its checked radio |
| `--ss-hover` | `--vscode-list-hoverBackground` | A category under the pointer |
| `--ss-focus` | `--vscode-focusBorder` | Every focus ring |
| `--ss-border` | `--vscode-widget-border` | Separators, the table's rules |
| `--ss-tab-active` | `--vscode-panelTitle-activeBorder` | The line under the selected tab |
| `--ss-contrast-border` | `--vscode-contrastBorder` | Extra edges, drawn only in high contrast themes |
| `--ss-contrast-active` | `--vscode-contrastActiveBorder` | The edge of the chosen category in high contrast themes |
| `--ss-warning` | `--vscode-editorWarning-foreground` | The warning icon beside a field's warning |
| `--ss-error` | `--vscode-errorForeground` | The error icon, an invalid field's message, the category marker |
| `--ss-error-border` | `--vscode-inputValidation-errorBorder` | An invalid input's edge |

Warnings and problems are drawn as an icon and words under the field, in
the text colour (warnings) or the error colour (problems), never as a
filled box.

The 60-30-10 split lands as the editor background for the form, the
sidebar background for the category list and footer, and the button colour
for the one primary action and the focus rings.

## Native Colours

Native surfaces take theme colour ids, never values:

| Use | Theme colour |
| --- | --- |
| Cloaked file in the Explorer | `list.deemphasizedForeground` |
| File that needs a decision | `list.warningForeground` |
| Status bar item when rows wait for a decision or a run failed | `statusBarItem.warningBackground` with `statusBarItem.warningForeground` |
| Remote and Testing badges in the Sites view | The tree's description text: no colour of its own |

## Space, Shape and Type

Spacing sits on a 4 px grid. Every margin, padding and gap is one of these:

| Token | Value | Used for |
| --- | --- | --- |
| `--ss-space-1` | 4 px | Icon to label, label to its help text |
| `--ss-space-2` | 8 px | Between related controls; button padding block |
| `--ss-space-3` | 12 px | Button padding inline; table cell padding |
| `--ss-space-4` | 16 px | Between fields; the form's inner margin |
| `--ss-space-6` | 24 px | Between groups of fields |
| `--ss-space-8` | 32 px | The form's outer margin at wide sizes |

One radius, `--ss-radius: 2px`, the radius of VS Code's own inputs and
buttons. Focus rings are 1 px solid `--ss-focus` with a 2 px offset, outside
the control, so they show against every surface.

Three type sizes, all in `--vscode-font-family`, scaled from
`--vscode-font-size` so the user's zoom and font size carry through:

| Token | Size | Weight | Used for |
| --- | --- | --- | --- |
| `--ss-text-title` | `calc(var(--vscode-font-size) * 1.5)` | 600 | The category heading |
| `--ss-text-body` | `var(--vscode-font-size)` | 400; 600 for group labels | Labels, values, buttons |
| `--ss-text-small` | `calc(var(--vscode-font-size) * 0.9)` | 400 | Help text, counts, validation messages |

Counts and sizes use `font-variant-numeric: tabular-nums`. Host names,
paths and patterns use `--vscode-editor-font-family`, at body size.

## States

Every webview control has these states. Native controls keep VS Code's own.

| State | Primary button | Secondary button | Input | Category | Tab |
| --- | --- | --- | --- | --- | --- |
| Rest | `--ss-accent` | `--ss-secondary` | `--ss-input`, `--ss-input-border` edge | Text on `--ss-surface-raised` | `--ss-text-muted`, no line |
| Hover | `--ss-accent-hover` | `--ss-secondary-hover` | Unchanged | `--ss-hover` | `--ss-text` |
| Active | `--ss-accent-hover`, pressed 1 px down | `--ss-secondary-hover`, pressed 1 px down | Unchanged | `--ss-selected` | `--ss-text`, `--ss-tab-active` line |
| Selected | Not used | Not used | Not used | `--ss-selected`, `--ss-contrast-active` edge | `--ss-text`, `--ss-tab-active` line |
| Focus visible | Focus ring | Focus ring | Focus ring in place of the edge | Focus ring | Focus ring |
| Disabled | 40 % opacity at the resting colour, `cursor: not-allowed`, skipped by Tab | Same | Same, and read-only | Not used | Not used |
| Invalid | Not used | Not used | `--ss-error-border` edge, message below | `!` after the name of a category with a problem | Not used |

In high contrast themes a category or tab under the pointer gains a 1 px
dashed `--ss-contrast-active` outline, as VS Code's own lists do.

Busy work (Test, Save) shows `$(loading~spin)` and a word in the button,
keeps the button's size, and disables it until the work ends.

## Motion

Only VS Code's own motion, plus a 100 ms colour transition on hover in the
webview, eased with `cubic-bezier(0.4, 0, 0.2, 1)`. Under
`prefers-reduced-motion: reduce` the transition is removed and the busy icon
stops spinning; the word beside it stays.

## Icons

Every icon is a codicon, so it follows the theme and its high contrast
form.

| Meaning | Codicon |
| --- | --- |
| Synchronize | `$(sync)`; `$(sync~spin)` while running |
| Put | `$(cloud-upload)` |
| Get | `$(cloud-download)` |
| Resolve | `$(question)` |
| Delete remote, Delete local, Remove Site | `$(trash)` |
| Guarded | `$(shield)` |
| Error | `$(error)` |
| Warning | `$(warning)` |
| Site | `$(globe)` |
| Server | `$(server)` |
| Testing server | `$(beaker)` |
| Site Settings | `$(gear)` |
| Add Site | `$(add)` |
| Switch Site | `$(arrow-swap)` |
| Open Site Folder | `$(folder-opened)` |
| Compare with Remote | `$(diff)` |
| Cloak, Uncloak | `$(eye-closed)`, `$(eye)` |
| Test Connection | `$(plug)` |
| Set Password | `$(key)` |
| Reset Sync Information | `$(discard)` |
| Show Log | `$(output)` |
| Status bar, idle | `$(cloud)` |

### The Activity Bar Icon

`media/sync-servers.svg`, 24 x 24, monochrome. VS Code draws it as a mask
in the theme's activity bar colour, so it has one colour and no fill
behind it.

- Two stacked servers: rounded rectangles 16.5 x 4.5 with a 1.5 radius, at
  the top and the bottom of the grid, each with a status light (a 2 px dot)
  at the left and a slot (a 6 px line) to its right.
- Between them, a Get arrow pointing down on the left and a Put arrow
  pointing up on the right, each 4 px long with a 2 px head.
- Strokes 1.5 px with round caps and joins, 2 px clear of the top and
  bottom edges and 3 px clear of the sides.

### The Marketplace Icon

`media/icon.png`, 128 x 128: the same drawing scaled to 88 px, in white, on
a rounded square with a 24 px radius filled with a blue gradient from
`#2f6fd8` at the top to `#1d4fa8` at the bottom (white on the lighter end
is 4.8:1). It reads on light and dark Marketplace pages alike. Both icons
are drawn by `scripts/draw-icon.mts` from one set of coordinates; owner
artwork, when supplied, replaces the drawing there.

## Marks

Explorer decorations and preview rows carry a symbol, a word and a tooltip.
The symbols match the command line's.

| Meaning | Explorer badge | Preview row | Tooltip or status |
| --- | --- | --- | --- |
| Cloaked | `⊘`, dimmed name | Not listed | Cloaked: never synchronized. |
| Changed locally since the last sync | `↑` | `$(cloud-upload) Put` | Changed since the last sync. |
| Changed on both sides | `!`, warning colour | `$(question) Resolve` | Changed locally and on the server since the last sync. Choose Put or Get. |
| Will be downloaded | None | `$(cloud-download) Get` | The status text of the engine |
| Will be deleted | None | `$(trash) Delete remote` or `Delete local` | The status text of the engine |
| Guarded | None | `$(shield)`, unchecked | Matches the sensitive pattern ".env". Check to transfer anyway. |

## Copy

- Commands are verbs or nouns in title case, under the category "Sync
  Servers": `Sync Servers: Synchronize...`. A trailing `...` means the
  command asks something before it acts.
- Titles name the thing: `Site Settings: My Site`.
- Messages are full sentences ending with a period. They say what happened
  and, when the user has to act, what to do: `Synchronized 36 files. 1
  failed.` with **Show Details**.
- Buttons in a dialog name the action (**Synchronize**, **Delete 12 Files**),
  never Yes or OK. The safe answer is the default unless the user asked for
  the action directly.
- Warnings say what is at risk, without exclamation marks or blame.
- Counts are digits. Paths are site-relative, with `/` on every platform.
- Examples use placeholder data only: `My Site`, `sftp.example.com`,
  `demo-user`.

## Mockups

Drawn in text. `>` marks the focused row; `[x]` and `[ ]` are native tree
checkboxes; `(i)` is an inline action that shows on hover and on focus.

### Sites View

```text
 SYNC SERVERS: SITES                               $(add) $(arrow-swap) ...
 v $(globe) Acme Corp  ~/sites/acme                         (i)$(sync) (i)$(gear)
     $(server) Production  SFTP sftp.example.com  Remote
 v $(globe) My Site  ~/sites/my-site, active
 >   $(server) Production  SFTP sftp.example.com:2222  Remote          (i)$(plug)
     $(beaker) Staging  FTPS staging.example.com  Testing
```

The site row's context menu holds Synchronize, Put and Get; Switch Site,
Open Site Folder and Test Connection; Site Settings and Reset Sync
Information; then Remove Site on its own. A server row's holds Test
Connection, Set Password... and Forget Password, and Reset Sync
Information. Every one of them is also in the Command Palette.

A list that cannot be read replaces the rows with one error row, which
opens `sites.json`:

```text
 SYNC SERVERS: SITES
   $(error) The list of sites cannot be read  sites.json is not valid:
```

With no sites the view shows its welcome content:

```text
 SYNC SERVERS: SITES
   No sites yet. A site pairs a local folder with the servers it is
   published to.
   [            Add Site            ]
   Sites are shared with the sync-servers command line, so a site added
   there is listed here too.
```

### Add Site

A quick input of up to six steps, each with Back, in the order of a site
manager entry: name, local folder, Protocol, Host, User, password. The
folders come from the system's folder picker; closing the picker goes back
one step. Then Add Site connects under a cancellable progress notification,
before anything is saved, and the server is named after its host.

```text
 Add Site (1/6)
 [ My Site                                                  ]
 The site name, unique among your sites.

 Add Site (3/6)
 Protocol: how to reach the first server
 > SFTP                      Recommended
   FTPS                      FTP with explicit TLS
   FTPS, implicit TLS        The older form, usually on port 990
   FTP                       Insecure: sends the password and files in clear text
   Local or network folder   A folder, a mounted drive or a network share
   No server yet             Add one later in Site Settings

 Add Site (4/6)
 [ sftp.example.com:2222                                    ]
 The FTP or SFTP host your hosting panel shows. host:port works when the port is not the usual one.

 Add Site (6/6)
 [ ************                                             ]
 The password. It is sent only after the server is verified, and saved in VS Code's secret storage once the server accepts it.
```

A refused sign-in asks for the user and password again, up to three times.
When connecting fails, a quick pick offers the way on:

```text
 Add Site: the connection failed
 > Change the Host
   Save Without Testing      Choose the root directory by hand
   Cancel                    Add nothing
```

After refused sign-ins the first item is Try Again instead.

### Root Directory

A quick pick over the folders on the server, titled with the folder shown
and starting where the account opens. Typing a path that starts with `/`,
or names a folder below the one shown, goes there once it exists. Used by
Add Site, by Browse... beside the root directory in Site Settings, and by
Choose Folder after Test Connection finds no root directory.

```text
 Root Directory: /var/www
 Open a folder, or type a path. It holds 2 files.
 > Use This Folder   /var/www
   ..                Up one folder
   logs/
   my-site/
```

Choosing `/` asks once, in a modal warning, whether synchronizing may
delete files there, with an Allow Deletes button.

### Host Key

A modal warning, the first time an SFTP server is reached. Closing it
refuses the key.

```text
 $(warning) Trust the host key of sftp.example.com?

 This is the first connection to sftp.example.com on port 22. It offered
 this ssh-ed25519 key:

 SHA256:...

 Compare it with the fingerprint your host publishes before trusting it.
 A remembered key is pinned in the server's settings, and a different key
 later stops the connection.

                         [ Trust and Remember ]  [ Trust Once ]  [ Cancel ]
```

### Certificate

A modal warning for an FTPS certificate that does not verify, before the
user name is sent. The buttons come best first: a host name the
certificate covers, checking it as that name, then trusting it. Expired and
not-yet-valid certificates get Cancel only; a changed one shows the
fingerprint trusted before too. Closing it refuses the certificate.

```text
 $(warning) The certificate of 203.0.113.10 names another host.

 Issued to: *.hosting.example.net, hosting.example.net
 Issued by: Example Trust CA
 Valid: 2026-01-01 to 2027-01-01
 SHA-256: AB:CD:...

 203.0.113.10 is server1.hosting.example.net, which this certificate
 covers. Connecting to it, or checking the certificate as it, keeps full
 verification.

 [ Connect to server1.hosting.example.net ]  [ Check as server1.hosting.example.net ]
 [ Trust and Remember ]  [ Trust Once ]  [ Cancel ]
```

Once a server accepts a password typed when asked, a notification offers
**Save Password**; it never holds up the connection.

### Synchronize

Three quick input steps, worded as Dreamweaver words them. The last answers
for each site are preselected.

```text
 Synchronize My Site (1/3)
 > Entire 'My Site' Site
   Selected Local Files Only            3 files selected in the Explorer

 Synchronize My Site (2/3)
 > Put newer files to remote
   Get newer files from remote
   Get and put newer files

 Synchronize My Site (3/3)
 > Keep remote files that are not on the local drive
   Delete remote files not on local drive
```

Without a selection in the Explorer, the first question is left out and
the dialog has two steps.

### Sync Preview View

```text
 SYNC PREVIEW (2)  Files: 36 will be updated, 169 will be skipped, 2 need a decision
                                          $(sync) $(check-all) $(clear-all) $(close)
 My Site and Production: Put newer files to remote
 v $(question) Resolve (2)
     $(question) css/site.css    Changed locally and on the server...  (i)$(cloud-upload) (i)$(cloud-download) (i)$(circle-slash) (i)$(diff)
     $(question) index.html      Differs from the server copy and has no sync record...
 v $(cloud-upload) Put (35)
 >   [x] $(cloud-upload) img/hero.svg
     [x] $(cloud-upload) scripts/lib/cli.js
 v $(trash) Delete remote (1)
     [ ] $(trash) old/legacy.html  On the server only and never synchronized. Check to delete it.
 v $(shield) Guarded (1)
     [ ] $(shield) .env           Put: Matches the sensitive pattern ".env". Check to transfer anyway.
```

The title bar holds Synchronize Checked Files, Check All, Uncheck All and
Close Preview; the badge counts the files that need a decision. Resolve rows
carry no checkbox until an action is chosen: inline Use Local, Use Remote,
Skip and Compare, or the context menu, which adds Mark Synchronized and the
deletes a row can take. Choosing one moves the row to that group, checked.
A held-back file stays in Guarded whatever is chosen for it. Several rows
can be chosen at once, and every action is also in the Command Palette
while a preview waits, acting on the chosen rows.

Synchronize asks before running deletes, with the files listed, unless
`syncServers.confirmDeletes` is off, and asks for the count to be typed
past the site's delete limit. A clean run closes the preview; a run with
failures keeps it open with the failures first:

```text
 SYNC PREVIEW                                                          $(close)
 My Site: Synchronized 36 files. 1 failed. 169 skipped.
 v $(error) Failed (1)
     $(error) img/banner.png      Permission denied.
 > $(pass) Done (36)
```

### Status Bar

```text
 $(cloud) My Site: sftp.example.com            idle
 $(cloud) Sync Servers                         no site active
 $(sync~spin) My Site: 12 of 37 files          synchronizing
 $(warning) My Site: 2 need a decision         warning background
 $(warning) My Site: 1 failed                  warning background
```

Hidden while there are no sites. Clicking it lists Synchronize..., Put
Current File and Get Current File when a file is open, Switch Site and
Site Settings.

### Site Settings

The category list of Dreamweaver's Site Setup on the left, the form on the
right, and Revert, Cancel and Save in the footer. The form edits a draft:
nothing reaches the list of sites until Save, Revert puts the saved
settings back, and Cancel asks before dropping changes. Below 40rem wide,
as at 200 % zoom, the categories sit above the form.

```text
+--------------------+-----------------------------------------------------------+
| Site               |  Servers                                                  |
| Servers          > |                                                           |
| Advanced Settings  |  Name         Host                 Protocol   Remote Test |
|   Local Info       |  Production   sftp.example.com     SFTP        (*)    ( ) |
|   Cloaking         |  Staging      staging.example.com  FTPS        ( )    (*) |
|   Synchronization  |                                                           |
|   Security         |  [ Add ]  [ Edit ]  [ Duplicate ]  [ Remove ]  [ Test ]   |
+--------------------+-----------------------------------------------------------+
| You have unsaved changes.                  [ Revert ]  [ Cancel ]  [ Save ]    |
+--------------------------------------------------------------------------------+
```

The servers table selects a row with the radio in its first column; Edit,
Duplicate, Remove and Test act on it. The Remote and Testing columns are
radio groups of their own, and a last row, No Testing server, clears the
Testing role. A server with a problem says Needs attention in its row.

The server editor opens in place, with Basic and Advanced tabs. The password
is never typed into the form: **Set Password...** asks for it in VS Code's
own password box, and the form shows only whether one is saved.

```text
+--------------------------------------------------------------------------------+
|  Server: Production                                   [ Back to Servers ]      |
|  [ Basic ]  Advanced                                                           |
|                                                                                |
|  Server name     [ Production                    ]                             |
|  Protocol        [ SFTP                        v ]                             |
|  Host            [ sftp.example.com              ]                             |
|  Port            [                               ]   (22 when empty)           |
|  User            [ demo-user                     ]                             |
|  Sign in with    [ Password                    v ]                             |
|  [x] Save password                                                             |
|  Password: Saved   [ Set Password... ]  [ Forget Password ]                    |
|  Root directory  [ /var/www/my-site              ]  [ Browse... ]            |
|                                                                                |
|  [ Test ]  $(pass) Connected to sftp.example.com. The root directory ...       |
+--------------------------------------------------------------------------------+
```

Test connects with the values the form shows, saved or not; what the
connection decides, such as a trusted host key, is written into the form
for Save to keep. Web URL, the host key and the trusted certificate, each
with its Forget button, are on the Advanced tab.

An invalid field shows its message on the line below, tied to the field and
announced. A port typed in Host moves into Port on Test, Browse... and
Save, unless the two disagree:

```text
|  Host            [ sftp.example.com:2222         ]                             |
|                  $(error) Host gives port 2222, but Port says 22. Keep one of them. |
```

### Explorer

```text
 v MY-SITE
   > css
     img
       hero.svg                   ↑
     drafts                       ⊘   (dimmed)
     index.html                   !   (warning colour, also on its folders)
```

A badge's tooltip says what it means and what to do: "Changed since the
last sync. Put uploads it." Marks show only for the active site, and only
after the site has been synchronized once, so a new site is not covered in
arrows. The Explorer's context menu adds Put, Get, Compare with Remote,
Synchronize..., Cloak and Uncloak for the active site's files; the
editor's adds Put, Get and Compare with Remote.

### Remote Files View

```text
 SYNC SERVERS: REMOTE FILES                                       $(refresh)
 v $(folder) css
     $(file) site.css            2.1 KB
   $(file) extra.html            318 B, ↓ new on the server
   $(file) index.html            4.0 KB                         (i)$(cloud-download)
```

Folders open one at a time, so a large server is never listed whole.
Clicking a file opens it read-only. The context menu holds Open Read-Only,
Compare with Remote, Get, Cloak or Uncloak, and Delete on Server, which
asks first and keeps the local copy.

### Notifications

```text
 $(info) Synchronized 36 files. 1 failed.                       [Show Details]
 $(warning) Delete 12 files on Production? Type 12 to confirm.  [input box]
```

## Accessibility

- Everything works from the keyboard. Menus only add shortcuts to commands
  that are already in the Command Palette.
- Tree items set `accessibilityInformation`, read as the action, the path,
  whether the row is checked and its status: "Put, img/hero.svg, checked".
  A message row starts with its kind: "Error: Could not list css: ...".
- The webview uses native form controls only, with a visible label for
  every field, help and problems tied to it with `aria-describedby`, and an
  `aria-live` region announcing validation and test results. No placeholder
  is used as a label.
- Hit targets in the webview are at least 24 x 24 px.
- Checked before a phase closes: a light, a dark and both high contrast
  themes, 200 % zoom, keyboard only, and a screen reader (NVDA on Windows,
  VoiceOver on macOS).
