import { statSync } from 'node:fs';
import { siteSchema, type Server, type Site } from '@isocialpractice/cmd-sync-servers';
import { foldersOverlap } from '../flows/add-site.ts';
import type { Problem } from '../shared/messages.ts';
import type { HostKeyData, ServerData, SiteData, TrustedCertificateData } from '../shared/site-data.ts';
import { sameData } from '../webview/state.ts';

/** The outcome of checking a site the form asked to save. */
export type SaveCheck =
  | { readonly kind: 'ok'; readonly site: Site }
  | { readonly kind: 'problems'; readonly problems: readonly Problem[] }
  /** A change the form can never make, such as a new host key: the message is dropped. */
  | { readonly kind: 'refused'; readonly reason: string };

interface Issue {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly origin?: string;
  readonly maximum?: unknown;
  readonly format?: string;
}

/** Problem text a person can act on, for the engine's validation issues. */
export function problemText(issue: Issue): string {
  if (issue.origin === 'string' && issue.code === 'too_small') {
    return 'This field is needed.';
  }
  if (issue.origin === 'string' && issue.code === 'too_big') {
    return `Use at most ${String(issue.maximum)} characters.`;
  }
  if (issue.code === 'invalid_format' && issue.format === 'url') {
    return 'Enter a full address, such as https://www.example.com/.';
  }
  return issue.message;
}

function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
}

function isFolder(folder: string): boolean {
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

/** A host key or certificate a person trusted while the form was open, through Test or Browse... */
export interface Granted {
  readonly hostKey?: HostKeyData | undefined;
  readonly trustedCertificate?: TrustedCertificateData | undefined;
}

/**
 * Why a server the form sent holds a pinned host key or trusted certificate
 * it was not given, or `undefined`. A pin is kept as saved, dropped, or one
 * a person trusted on connection while the form was open; nothing else.
 */
export function pinProblem(server: ServerData, before: Server | undefined, granted: Granted | undefined): string | undefined {
  const key = server.options.hostKey;
  if (key !== undefined && !sameData(key, before?.options.hostKey) && !sameData(key, granted?.hostKey)) {
    return 'The form sent a host key it was not given. Host keys are pinned only by trusting them on connection.';
  }
  const certificate = server.options.tls?.trustedCertificate;
  if (certificate !== undefined && !sameData(certificate, before?.options.tls?.trustedCertificate) && !sameData(certificate, granted?.trustedCertificate)) {
    return 'The form sent a trusted certificate it was not given. Certificates are trusted only by deciding on them on connection.';
  }
  return undefined;
}

/**
 * Checks a site the form sent: it must be the site that was opened, keep
 * every pinned host key and trusted certificate, drop it, or hold one
 * `granted` on connection, and pass the engine's own validation. Its name
 * must be new among the other sites and its local folder must exist.
 */
export function checkSave(
  data: SiteData,
  current: Site,
  others: readonly Site[],
  folderExists: (folder: string) => boolean = isFolder,
  granted: ReadonlyMap<string, Granted> = new Map(),
): SaveCheck {
  if (data.id !== current.id) {
    return { kind: 'refused', reason: 'The form sent another site.' };
  }
  for (const server of data.servers) {
    const before = current.servers.find((candidate) => candidate.id === server.id);
    const problem = pinProblem(server, before, granted.get(server.id));
    if (problem !== undefined) {
      return { kind: 'refused', reason: problem };
    }
  }
  const problems: Problem[] = [];
  const parsed = siteSchema.safeParse(data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push({ path: issue.path.map(String).join('.'), message: problemText(issue) });
    }
  }
  const clash = others.find((site) => site.id !== current.id && sameName(site.name, data.name.trim()));
  if (clash !== undefined) {
    problems.push({ path: 'name', message: `A site named "${clash.name}" already exists.` });
  }
  if (data.localRoot.trim() !== '' && !problems.some((problem) => problem.path === 'localRoot') && !folderExists(data.localRoot)) {
    problems.push({ path: 'localRoot', message: 'This folder does not exist.' });
  }
  data.servers.forEach((server, index) => {
    if (server.protocol === 'local' && server.remoteRoot.trim() !== '' && data.localRoot.trim() !== '' && foldersOverlap(data.localRoot, server.remoteRoot)) {
      problems.push({ path: `servers.${String(index)}.remoteRoot`, message: 'Choose a folder outside the local site folder. A site cannot be published into itself.' });
    }
  });
  if (problems.length > 0 || !parsed.success) {
    return { kind: 'problems', problems };
  }
  return { kind: 'ok', site: parsed.data };
}
