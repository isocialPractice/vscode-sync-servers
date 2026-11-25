// Builds the `_notes/dwsync.xml` files Dreamweaver keeps in the folders of a
// site, so tests have its synchronization records without running it.
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { serializeDwsync, type DwsyncEntry } from '@isocialpractice/cmd-sync-servers';

/** 100 nanosecond steps from 1601-01-01 to 1970-01-01, both UTC. */
const FILETIME_EPOCH = 116_444_736_000_000_000n;

/** A time in nanoseconds since 1970-01-01 UTC as a Windows FILETIME. */
export function filetime(unixNanoseconds: bigint): bigint {
  return unixNanoseconds / 100n + FILETIME_EPOCH;
}

/** One file of a folder, as Dreamweaver records it for one server. */
export interface FixtureEntry {
  readonly name: string;
  /** The server as Dreamweaver names it, such as `D:/Sites/my-site-testing/`. */
  readonly server: string;
  /** The local file's time in 100 nanosecond steps since 1601-01-01 UTC. */
  readonly local: bigint;
  /** The server copy's time as Dreamweaver read it, in the same unit. */
  readonly remote: bigint;
  /** The daylight state when the entry was written: `0` for a zone without daylight time. */
  readonly dst: number;
}

/**
 * The entry Dreamweaver holds for a file in sync with a local or network
 * folder server: the local file's time to the last 100 nanoseconds and the
 * server copy's time to the second, written in a zone without daylight
 * time, so the entry reads the same on every computer.
 */
export function folderEntry(localFile: string, serverFile: string, server: string): FixtureEntry {
  const serverNs = lstatSync(serverFile, { bigint: true }).mtimeNs;
  return {
    name: path.basename(localFile),
    server,
    local: filetime(lstatSync(localFile, { bigint: true }).mtimeNs),
    remote: filetime((serverNs / 1_000_000_000n) * 1_000_000_000n),
    dst: 0,
  };
}

function dwsyncEntry(entry: FixtureEntry): DwsyncEntry {
  return {
    attributes: [
      ['name', entry.name],
      ['server', entry.server],
      ['local', String(entry.local)],
      ['remote', String(entry.remote)],
      ['Dst', String(entry.dst)],
    ],
    name: entry.name,
    server: entry.server,
    local: entry.local,
    remote: entry.remote,
  };
}

/** Writes `<folder>/_notes/dwsync.xml` with the line ends Dreamweaver writes on Windows, and returns its path. */
export function writeDwsync(folder: string, entries: readonly FixtureEntry[]): string {
  const notes = path.join(folder, '_notes');
  mkdirSync(notes, { recursive: true });
  const file = path.join(notes, 'dwsync.xml');
  writeFileSync(file, serializeDwsync({ entries: entries.map(dwsyncEntry), newline: '\r\n' }));
  return file;
}
