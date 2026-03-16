import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExpandedRecord } from './types.ts';

let verboseEnabled = false;

export function fail(message: string): never {
  throw new Error(message);
}

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function isVerbose(): boolean {
  return verboseEnabled;
}

export function verbose(message: string, details?: unknown): void {
  if (!verboseEnabled) {
    return;
  }

  if (details === undefined) {
    console.error(`[verbose] ${message}`);
    return;
  }

  if (typeof details === 'string') {
    console.error(`[verbose] ${message}: ${details}`);
    return;
  }

  console.error(`[verbose] ${message}: ${JSON.stringify(details)}`);
}

export function expandHome(inputPath: string): string {
  if (inputPath === '~') {
    return process.env.HOME ?? inputPath;
  }

  if (inputPath.startsWith('~/')) {
    return path.join(process.env.HOME ?? '~', inputPath.slice(2));
  }

  return inputPath;
}

export async function readToken(tokenFile: string): Promise<string> {
  if (!tokenFile) {
    fail('tokenFile is required');
  }

  const expandedPath = expandHome(tokenFile);
  const token = (await readFile(expandedPath, 'utf8')).trim();
  if (!token) {
    fail(`tokenFile is empty: ${tokenFile}`);
  }

  return token;
}

export function relName(fullName: string, zone: string): string {
  if (fullName === zone) {
    return '@';
  }

  const suffix = `.${zone}`;
  if (fullName.endsWith(suffix)) {
    return fullName.slice(0, -suffix.length);
  }

  return fullName;
}

export function absName(name: string, zone: string): string {
  if (!name || name === '@') {
    return zone;
  }

  return `${name}.${zone}`;
}

export function fqdn(zone: string, name: string): string {
  return name && name !== '@' ? `${name}.${zone}` : zone;
}

export function describeRecord(zone: string, record: ExpandedRecord): string {
  return `${fqdn(zone, record.name)} ${record.type} ${record.value}`;
}

export function toNixString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function compareNullable<T>(left: T | null | undefined, right: T | null | undefined): number {
  const normalizedLeft = left ?? null;
  const normalizedRight = right ?? null;

  if (normalizedLeft === normalizedRight) {
    return 0;
  }

  if (normalizedLeft === null) {
    return -1;
  }

  if (normalizedRight === null) {
    return 1;
  }

  if (normalizedLeft < normalizedRight) {
    return -1;
  }

  return 1;
}
