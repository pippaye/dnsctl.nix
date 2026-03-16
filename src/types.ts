export interface ProviderConfig {
  type: string;
  tokenFile: string;
}

export interface RecordConfig {
  name: string;
  type: string;
  ttl?: number | null;
  values?: string[];
  proxied?: boolean | null;
  priority?: number | null;
  comment?: string | null;
  [key: string]: unknown;
}

export interface ZoneConfig {
  provider: string;
  records?: RecordConfig[];
}

export interface Plan {
  providers: Record<string, ProviderConfig>;
  zones: Record<string, ZoneConfig>;
}

export interface ExpandedRecord {
  id?: string;
  name: string;
  type: string;
  value: string;
  ttl?: number | null;
  proxied?: boolean | null;
  priority?: number | null;
  comment?: string | null;
  [key: string]: unknown;
}

export interface DiffResult {
  create: ExpandedRecord[];
  update: ExpandedRecord[];
  delete: ExpandedRecord[];
  conflictDelete: ExpandedRecord[];
  pruneDelete: ExpandedRecord[];
}
