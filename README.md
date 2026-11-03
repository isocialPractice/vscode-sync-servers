# Sync Servers for VS Code

Synchronize a site's local folder with its SFTP, FTPS and FTP servers from
VS Code, in the manner of Dreamweaver's Synchronize: sites, servers,
cloaking, and a preview of every file that would change before anything
moves.

Sites are kept in the same list as the
[`sync-servers` command line](https://github.com/isocialPractice/cmd-sync-servers),
so a site added in either one is listed in both. The extension runs the
same engine.

> **Status: early alpha.** Every view and command works, and details may
> still change before 1.0.0. Try it on a copy of a site first.

The documentation is at
<https://isocialpractice.github.io/vscode-sync-servers/>.

## Install

Alphas are published as `.vsix` files on the
[releases page](https://github.com/isocialPractice/vscode-sync-servers/releases),
not on the Marketplace. Download the `.vsix`, then in VS Code open the
Extensions view, choose **...** > **Install from VSIX...**, and pick the
file. From a terminal:

```sh
code --install-extension vscode-sync-servers-1.0.0-alpha.1.2.0.vsix
```

Requires VS Code 1.101 or later. Each release carries `SHA256SUMS`, an
SBOM and a build provenance attestation:
[verify a download](https://isocialpractice.github.io/vscode-sync-servers/security-and-trust.html#verify)
before installing it.

## The Views at a Glance

The **Sync Servers** icon in the activity bar opens three views:

| View | Shows |
| --- | --- |
| **Sites** | Every site, such as `My Site`, with its servers. Starts with an **Add Site** button when there are none |
| **Remote Files** | The files on the active site's Remote server |
| **Sync Preview** | While a synchronization waits for you: each file that would change, grouped by what will happen to it |

## Add a Site

Choose **Add Site** in the Sites view. It asks for the site name, such as
`My Site`, its local folder, then the first server's **Protocol**, **Host**
and **User**, such as SFTP, `sftp.example.com` and `demo-user@example.com`,
and the password. It then connects before anything is added: a new SSH host
key or an FTPS certificate that does not verify is shown for you to decide
on, a refused sign-in asks again, and the root directory is picked from the
folders the server shows, starting where your account opens. The password
is saved in VS Code's secret storage only once the server accepts it, and
Cancel at any step adds nothing.

## A First Sync

1. Choose **Synchronize...** on `My Site` in the Sites view, or run
   **Sync Servers: Synchronize...**.
2. Answer **Put newer files to remote**, and keep the files that are only on
   the server.
3. Read the **Sync Preview**: the files that will move are checked; anything
   that changed on both sides waits under Resolve for **Use Local**,
   **Use Remote**, **Skip** or **Compare**.
4. Choose **Synchronize Checked Files** in the preview's title bar.

**Put** and **Get** move the file open in the editor, or the files chosen
in the Explorer, the same way, and **Compare with Remote** shows the
server's copy beside yours.

## In the Explorer

With a site's folder open, the Explorer marks what changed since the last
sync with ↑, dims cloaked files with ⊘, and flags files that need a
decision with !. Its context menu holds Put, Get, Compare with Remote,
Synchronize..., Cloak and Uncloak.

Turn on **Upload on save** for a server in Site Settings, usually the
Testing server, and every file you save is put there, unless it is cloaked,
matches a sensitive pattern such as `.env`, or changed on the server too.
Nothing uploads on save in Restricted Mode.

## Site Settings

**Site Settings** opens a site's form in the editor area: the site, its
servers with a Basic and an Advanced tab each, and the Local Info,
Cloaking, Synchronization and Security categories. Nothing changes until
Save, and Revert puts the saved settings back. **Test** connects with the
values the form shows before you save them, and **Browse...** beside the
root directory lists the folders on the server.

## The Status Bar and the Commands

The status bar shows the active site and its Remote server, such as
`My Site: sftp.example.com`. The site whose folder is open is active on its own;
**Switch Site** chooses another.

Every command is in the Command Palette under **Sync Servers**: Add Site,
Site Settings, Remove Site, Switch Site, Open Site Folder, Synchronize...,
Put, Get, Compare with Remote, Cloak, Uncloak, Global Cloaking Patterns...,
Test Connection, Set
Password..., Forget Password, Reset Sync Information and Show Log. While a
preview waits, its own actions join them, such as Use Local and Synchronize
Checked Files.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `syncServers.configDir` | empty | The folder holding `sites.json`; empty uses the command line's folder |
| `syncServers.uploadOnSave.enabled` | `true` | A switch over every server's upload on save |
| `syncServers.preview.groupBy` | `action` | Groups the Sync Preview by `action` or by `folder` |
| `syncServers.confirmDeletes` | `true` | Asks before any delete runs, in addition to the preview |
| `syncServers.decorations.enabled` | `true` | Marks cloaked, changed and conflicting files in the Explorer |

Sites and servers are not VS Code settings. They live in the list of sites
shared with the command line, so a cloned repository cannot change them.

## Security

Passwords are kept in VS Code's secret storage, never in a settings file.
In Restricted Mode nothing is uploaded on save. To report a vulnerability,
see [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in
[CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE). The bundled packages' licences are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
