import { isSyncError, type CertificateInfo } from '@isocialpractice/cmd-sync-servers';

const HOST_NOT_FOUND = new Set(['ENOTFOUND', 'EAI_NONAME', 'EAI_NODATA']);

function causeCode(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  return typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : undefined;
}

/**
 * What a failed connection says about the Host field: the host does not
 * exist, or it refused the connection on that port. Both are repaired in
 * Site Settings.
 */
export function hostProblem(error: unknown): 'not-found' | 'refused' | undefined {
  if (!isSyncError(error, 'E_CONNECTION')) {
    return undefined;
  }
  const code = causeCode(error);
  return code !== undefined && HOST_NOT_FOUND.has(code) ? 'not-found' : code === 'ECONNREFUSED' ? 'refused' : undefined;
}

/** The certificate an `E_TLS_CERT` error is about, when the engine read it. */
export function certificateOf(error: unknown): CertificateInfo | undefined {
  return isSyncError(error, 'E_TLS_CERT') ? error.details?.certificate : undefined;
}

/** The engine's certificate message without its command-line fixes, then the fixes in the extension. */
function certificateText(text: string, info: CertificateInfo): string {
  const kept = text.split('\n').filter((line) => !line.includes('sync-servers ') && !line.includes('--trust-certificate'));
  if (info.problem === 'expired' || info.problem === 'not-yet-valid') {
    return kept.join('\n');
  }
  const covered = info.coveredNames[0];
  const fix =
    covered === undefined
      ? 'Run Test Connection to decide, after checking the fingerprint with the host.'
      : `Change the Host to ${covered}, which the certificate covers, or run Test Connection to decide.`;
  return [...kept, fix].join('\n');
}

/** The text of an error for a message, with advice that fits the extension instead of the command line's. */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (isSyncError(error, 'E_AUTH')) {
    return text.replace(/ Save (?:one|it again) with "sync-servers password set".*$/, ' Save it with Set Password..., or enter it when asked.');
  }
  if (isSyncError(error, 'E_TLS_CERT')) {
    const info = error.details?.certificate;
    return info === undefined ? text : certificateText(text, info);
  }
  if (isSyncError(error, 'E_REMOTE_ROOT')) {
    return text.replace(/ Choose the root with "sync-servers server edit.*$/, ' Choose the root with Choose Folder, or with Browse... in Site Settings.');
  }
  if (isSyncError(error, 'E_CONFIG_INVALID')) {
    return text.replace(/Fix it with "sync-servers config edit"\.$/, 'Fix it with Open sites.json; the list reloads when the file is saved.');
  }
  return text;
}
