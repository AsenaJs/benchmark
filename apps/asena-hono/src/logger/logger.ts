import type { ServerLogger } from '@asenajs/asena/logger';

const noop = () => {};

/** Benchmarks measure request handling, not stdout. */
export const logger: ServerLogger = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  profile: noop,
};
