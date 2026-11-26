/**
 * What Synchronize says when a comparison has nothing to run, and the Sync
 * Preview's heading, without `vscode`, so their words can be tested.
 */
import { DIRECTION_TITLES, rangeTitle, rangeWords, type Direction, type TimeRange } from '@isocialpractice/cmd-sync-servers';

/**
 * Said when a comparison found nothing to run: the site and the server are
 * in sync, or, for a time range, nothing of the range needs putting. The
 * count is of the files compared and found in sync.
 */
export function nothingToRun(siteName: string, serverName: string, compared: number, range?: TimeRange): string {
  const counted = `${String(compared)} ${compared === 1 ? 'file' : 'files'} compared.`;
  return range === undefined
    ? `"${siteName}" and ${serverName} are in sync. ${counted}`
    : `Nothing from the last ${rangeWords(range)} needs putting to ${serverName}. ${counted}`;
}

/** The heading above the Sync Preview's rows: the site, the server, and the direction or the time range. */
export function previewHeading(siteName: string, serverName: string, direction: Direction, range?: TimeRange): string {
  return `${siteName} and ${serverName}: ${range === undefined ? DIRECTION_TITLES[direction] : rangeTitle(range)}`;
}
