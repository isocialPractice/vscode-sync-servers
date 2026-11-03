import type { LogRecord, LogSink } from '@isocialpractice/cmd-sync-servers';

/** The part of a `LogOutputChannel` the log writes to. */
export interface LogChannel {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

/** One record as a line: the message, then its fields as JSON. */
export function formatRecord(record: LogRecord): string {
  return record.fields === undefined ? record.message : `${record.message} ${JSON.stringify(record.fields)}`;
}

/**
 * Passes the engine's records, already redacted, to the Sync Servers log at
 * their own level; the channel's level decides what is shown.
 */
export function channelSink(channel: LogChannel): LogSink {
  return {
    write: (record) => {
      channel[record.level](formatRecord(record));
    },
  };
}
