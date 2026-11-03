/**
 * The shape of a site as it crosses into and out of the Site Settings
 * webview. It mirrors the engine's site schema, which needs Node.js and so
 * cannot run in a webview; the engine's schema still validates every save.
 */
import * as z from 'zod';

/** The longest text any field may hold in a message. */
export const MAX_TEXT = 4096;
/** The most entries a list may hold in a message. */
export const MAX_LIST = 10_000;

const text = z.string().max(MAX_TEXT);
const list = z.array(text).max(MAX_LIST);

/** A random UUID, as the engine generates for sites and servers. */
export const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/** The protocols, SFTP first. */
export const PROTOCOL_VALUES = ['sftp', 'ftps', 'ftps-implicit', 'ftp', 'local'] as const;

/** How a site treats symbolic links in its local folder: skip them, follow those inside the site, or follow all. */
export const LINK_POLICY_VALUES = ['skip', 'follow-inside-root', 'follow'] as const;

/** A pinned SSH host key. */
export const hostKeyDataSchema = z.strictObject({ algorithm: text, sha256: text, pinnedAt: text });

/** A TLS certificate trusted by its fingerprint. */
export const trustedCertificateDataSchema = z.strictObject({ sha256: text, validTo: text, pinnedAt: text });

/** A server, as the form edits it. */
export const serverDataSchema = z.strictObject({
  id: uuidSchema,
  name: text,
  protocol: z.enum(PROTOCOL_VALUES),
  host: text.optional(),
  port: z.number().optional(),
  username: text.optional(),
  auth: z
    .strictObject({
      method: z.enum(['password', 'key', 'agent']),
      keyPath: text.optional(),
      savePassword: z.boolean(),
    })
    .optional(),
  remoteRoot: text,
  webUrl: text.optional(),
  options: z.strictObject({
    passive: z.boolean(),
    ipFamily: z.union([z.literal(4), z.literal(6)]).optional(),
    timeoutSeconds: z.number(),
    allowInsecure: z.boolean().optional(),
    allowRootDeletes: z.boolean().optional(),
    legacyAlgorithms: z.boolean().optional(),
    tls: z
      .strictObject({
        caFile: text.optional(),
        servername: text.optional(),
        minVersion: z.enum(['TLSv1.2', 'TLSv1.3']),
        trustedCertificate: trustedCertificateDataSchema.optional(),
      })
      .optional(),
    hostKey: hostKeyDataSchema.optional(),
    uploadOnSave: z.boolean(),
    remoteFileMode: text.optional(),
    remoteDirMode: text.optional(),
  }),
});

/** A site, as the form edits it. */
export const siteDataSchema = z.strictObject({
  id: uuidSchema,
  name: text,
  localRoot: text,
  servers: z.array(serverDataSchema).max(100),
  remoteServerId: uuidSchema.optional(),
  testingServerId: uuidSchema.optional(),
  local: z.strictObject({
    webUrl: text.optional(),
    caseSensitive: z.boolean().optional(),
    cache: z.boolean(),
  }),
  cloaking: z.strictObject({ enabled: z.boolean(), useGlobalPatterns: z.boolean().optional(), patterns: list, paths: list }),
  sync: z.strictObject({
    maintainInfo: z.boolean(),
    compare: z.enum(['metadata', 'checksum']),
    mtimeToleranceSeconds: z.number(),
    symlinks: z.enum(LINK_POLICY_VALUES),
    concurrency: z.number(),
    guard: z.strictObject({ enabled: z.boolean(), patterns: list }),
    massDelete: z.strictObject({ maxCount: z.number(), maxPercent: z.number() }),
    recovery: z.strictObject({ enabled: z.boolean(), keepDays: z.number(), maxMegabytes: z.number() }),
  }),
});

/** A server, as the form edits it. */
export type ServerData = z.infer<typeof serverDataSchema>;
export type HostKeyData = z.infer<typeof hostKeyDataSchema>;
export type TrustedCertificateData = z.infer<typeof trustedCertificateDataSchema>;
/** A site, as the form edits it. */
export type SiteData = z.infer<typeof siteDataSchema>;
/** One of the protocols. */
export type ProtocolValue = (typeof PROTOCOL_VALUES)[number];
