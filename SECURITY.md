# Security Policy

Sync Servers moves files between your machine and your servers with your
credentials, so security reports are welcome and taken seriously.

## Supported Versions

Until `1.0.0`, only the latest alpha release receives security fixes. Update
to it before reporting, and say so if the problem is still there.

| Version | Supported |
| --- | --- |
| Latest `1.0.0-alpha.x.y.z` | Yes |
| Earlier alphas | No |

## Reporting a Vulnerability

Report privately through GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Fill in the form.

The direct link is
<https://github.com/isocialPractice/vscode-sync-servers/security/advisories/new>.

**Never open a public issue, discussion or pull request for a
vulnerability.** A public report puts every user at risk before a fix exists.

## What to Include

- The extension version, the VS Code version (Help > About) and the
  operating system
- The protocol involved (SFTP, FTPS, FTP or local folder), if any
- Whether the workspace was trusted or in Restricted Mode
- The steps that reproduce the problem, and what happened compared with
  what should have happened
- The impact as you understand it: what an attacker could read, change or
  delete, and from where, such as a cloned repository, a server's reply or
  a webview message
- A proof of concept, if you have one

Do not include real passwords, private keys, host names or other people's
data. Use placeholders such as `sftp.example.com` and `demo-user`, and
generate throwaway keys for any proof of concept.

## What to Expect

- An acknowledgement within 7 days.
- An assessment, with a severity and a plan, within 14 days.
- Progress updates in the private advisory until the issue is resolved.
- A fix released as a new alpha, then a published GitHub security advisory
  that credits you, unless you ask not to be named.

Please give the fix a chance to ship before disclosing details publicly.
Coordinated disclosure dates can be agreed in the advisory.

## Scope

In scope:

- The `vscode-sync-servers` extension: its views, commands, webviews,
  settings and the way it stores secrets and treats untrusted workspaces
- The GitHub Actions workflows and release artifacts of this repository

Out of scope:

- The synchronization engine and the `sync-servers` command line, which
  have their own repository and security policy at
  <https://github.com/isocialPractice/cmd-sync-servers/security>. A problem
  that also happens from the command line belongs there.
- Vulnerabilities in VS Code, Node.js, the operating system, or the servers
  you connect to
- Attacks that already require control of your user account
