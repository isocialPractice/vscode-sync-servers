/**
 * Every message between the extension and the Site Settings webview, in both
 * directions. Each side parses what it receives with these schemas and drops
 * anything that does not match. No message ever carries a secret: the form
 * only learns whether a password is saved.
 */
import * as z from 'zod';
import { hostKeyDataSchema, MAX_LIST, MAX_TEXT, serverDataSchema, siteDataSchema, trustedCertificateDataSchema, uuidSchema } from './site-data.ts';

const text = z.string().max(MAX_TEXT);
const list = z.array(text).max(MAX_LIST);

/** What a Browse... button picks. `remoteRoot` picks the root directory from what the server shows. */
export const pickTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('localRoot') }),
  z.strictObject({ kind: z.literal('serverFolder'), serverId: uuidSchema }),
  z.strictObject({ kind: z.literal('remoteRoot'), serverId: uuidSchema }),
  z.strictObject({ kind: z.literal('keyFile'), serverId: uuidSchema }),
  z.strictObject({ kind: z.literal('caFile'), serverId: uuidSchema }),
]);

/**
 * What connecting with a server as the form shows it decided: another host
 * the certificate covers, the name to check it as, a key or certificate to
 * trust, and deletes at the top. The form takes them as unsaved changes.
 */
export const decisionsSchema = z.strictObject({
  host: text.optional(),
  servername: text.optional(),
  hostKey: hostKeyDataSchema.optional(),
  trustedCertificate: trustedCertificateDataSchema.optional(),
  allowRootDeletes: z.boolean().optional(),
});

/** A problem with one field, by its path in the site such as `servers.0.host`. */
export const problemSchema = z.strictObject({ path: z.string().max(200), message: text });

const passwordSaved = z.record(uuidSchema, z.boolean());

/** Messages the extension sends to the webview. */
export const toWebviewSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('load'),
    site: siteDataSchema,
    passwordSaved,
    builtInGuard: list,
    /** The cloaking patterns every site uses before its own. */
    globalPatterns: list,
    editServerId: uuidSchema.optional(),
  }),
  z.strictObject({ type: z.literal('saved'), site: siteDataSchema, passwordSaved, message: text }),
  /** The global cloaking patterns changed while the form was open. */
  z.strictObject({ type: z.literal('globalPatterns'), patterns: list }),
  z.strictObject({ type: z.literal('serverState'), site: siteDataSchema, passwordSaved }),
  z.strictObject({ type: z.literal('problems'), problems: z.array(problemSchema).max(1000), message: text }),
  z.strictObject({ type: z.literal('picked'), target: pickTargetSchema, path: text }),
  z.strictObject({ type: z.literal('testResult'), serverId: uuidSchema, ok: z.boolean(), text }),
  z.strictObject({ type: z.literal('decided'), serverId: uuidSchema, decisions: decisionsSchema }),
  z.strictObject({
    type: z.literal('cloakCount'),
    enabled: z.boolean(),
    files: z.number().int().min(0),
    folders: z.number().int().min(0),
    complete: z.boolean(),
  }),
]);

/** Messages the webview sends to the extension. */
export const fromWebviewSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  /** The page failed, or its Content-Security-Policy blocked something; the extension logs it. */
  z.strictObject({ type: z.literal('error'), text }),
  z.strictObject({ type: z.literal('save'), site: siteDataSchema }),
  z.strictObject({ type: z.literal('cancel'), dirty: z.boolean() }),
  /** `server` is the server as the form shows it, for a `remoteRoot` target. */
  z.strictObject({ type: z.literal('browse'), target: pickTargetSchema, server: serverDataSchema.optional() }),
  /** Tests the server as the form shows it, saved or not. */
  z.strictObject({ type: z.literal('test'), serverId: uuidSchema, server: serverDataSchema }),
  z.strictObject({ type: z.literal('setPassword'), serverId: uuidSchema }),
  z.strictObject({ type: z.literal('forgetPassword'), serverId: uuidSchema }),
  z.strictObject({
    type: z.literal('countCloaked'),
    cloaking: z.strictObject({ enabled: z.boolean(), useGlobalPatterns: z.boolean().optional(), patterns: list, paths: list }),
  }),
  /** Opens the global cloaking patterns, which every site uses before its own. */
  z.strictObject({ type: z.literal('editGlobalPatterns') }),
]);

/** A message the extension sends to the webview. */
export type ToWebview = z.infer<typeof toWebviewSchema>;
/** A message the webview sends to the extension. */
export type FromWebview = z.infer<typeof fromWebviewSchema>;
/** What a Browse... button picks. */
export type PickTarget = z.infer<typeof pickTargetSchema>;
/** A problem with one field. */
export type Problem = z.infer<typeof problemSchema>;
/** What connecting with unsaved settings decided. */
export type Decisions = z.infer<typeof decisionsSchema>;
