import type { Runtime } from '../contract/targets.ts';

export interface RepStat {
  rps: number;
  latencyAvgMs: number;
  latencyP50Ms: number;
  latencyP90Ms: number;
  latencyP99Ms: number;
  latencyMaxMs: number;
  totalRequests: number;
  transferMBps: number;
  non2xx: number;
  socketErrors: number;
}

export interface ScenarioResult {
  id: string;
  scenario: string;
  group: string;
  status: 'ok' | 'failed';
  note?: string;
  reps: RepStat[];
  /** median across reps, field by field */
  median?: RepStat;
  /** rps spread across reps, as a fraction of the median */
  rpsSpread?: number;
  memory?: MemoryProfile;
}

/** RSS = the listening process alone; cgroup = everything in the server's scope incl. page cache. */
export interface MemoryProfile {
  startupMs: number;
  listenerPid: number;
  rssIdleMB: number;
  rssAfterWarmupMB: number;
  /** the server is shared by all scenarios of a target: RSS at the start of this scenario */
  rssBeforeMB: number;
  rssAvgMB: number;
  rssPeakMB: number;
  rssEndMB: number;
  cgroupIdleMB: number;
  cgroupPeakMB: number;
  cgroupAvgMB: number;
  anonAvgMB: number;
  anonPeakMB: number;
  fileEndMB: number;
  /** server CPU seconds per wall second during measurement; 1.0 = the one core is saturated */
  cpuUtilMeasure: number;
  /** whole server core busy fraction incl. softirq (loopback TCP) */
  coreBusyMeasure: number;
  coreSoftirqMeasure: number;
  oomKill: number;
  memoryHighEvents: number;
  samples: number;
}

export interface TargetResult {
  target: string;
  app: string;
  framework: string;
  runtime: Runtime;
  runtimeVersion: string;
  dbLayer: string;
  validator: string;
  meta: Record<string, unknown>;
  profile: { name: string; threads: number; connections: number; duration: number; warmup: number; writeDuration: number };
  reps: number;
  startedAt: string;
  finishedAt: string;
  scenarios: Record<string, ScenarioResult>;
}

export interface SkipRecord {
  target: string;
  reason: string;
}

export function median(values: number[]): number {
  const s = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function medianRep(reps: RepStat[]): RepStat {
  const pick = (k: keyof RepStat) => median(reps.map((r) => r[k] as number));
  return {
    rps: pick('rps'),
    latencyAvgMs: pick('latencyAvgMs'),
    latencyP50Ms: pick('latencyP50Ms'),
    latencyP90Ms: pick('latencyP90Ms'),
    latencyP99Ms: pick('latencyP99Ms'),
    latencyMaxMs: pick('latencyMaxMs'),
    totalRequests: pick('totalRequests'),
    transferMBps: pick('transferMBps'),
    non2xx: pick('non2xx'),
    socketErrors: pick('socketErrors'),
  };
}
