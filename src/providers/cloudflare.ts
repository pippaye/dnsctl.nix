import type { ExpandedRecord } from '../types.ts';
import { absName, describeRecord, fail, readToken, relName, verbose } from '../utils.ts';
import { Provider } from './index.ts';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const PAGE_SIZE = 100;

interface CloudflareApiMessage {
  code?: number;
  message?: string;
}

interface CloudflareResultInfo {
  page?: number;
  total_pages?: number;
}

interface CloudflareEnvelope<T> {
  success?: boolean;
  result: T;
  errors?: CloudflareApiMessage[];
  messages?: CloudflareApiMessage[];
  result_info?: CloudflareResultInfo;
}

interface CloudflareZone {
  id?: string;
  name?: string;
}

interface CloudflareRecord {
  id?: string;
  name?: string;
  type?: string;
  content?: unknown;
  ttl?: number | null;
  proxied?: boolean | null;
  priority?: number | null;
  comment?: string | null;
}

function formatApiMessages(messages?: CloudflareApiMessage[]): string | null {
  if (!messages || messages.length === 0) {
    return null;
  }

  const rendered = messages
    .map((entry) => entry.message?.trim())
    .filter((entry): entry is string => Boolean(entry));

  return rendered.length > 0 ? rendered.join('; ') : null;
}

export class CloudflareProvider extends Provider {
  private readonly apiToken: string;
  private readonly zoneIdCache = new Map<string, string>();

  private constructor(apiToken: string) {
    super();
    this.apiToken = apiToken;
    verbose('Initialized Cloudflare REST API client');
  }

  static async create(tokenFile: string): Promise<CloudflareProvider> {
    verbose('Initializing Cloudflare provider', { tokenFile });
    const apiToken = await readToken(tokenFile);
    return new CloudflareProvider(apiToken);
  }

  private async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      search?: Record<string, string | number | boolean | undefined>;
      body?: Record<string, unknown>;
    } = {},
  ): Promise<CloudflareEnvelope<T>> {
    const url = new URL(`${CLOUDFLARE_API_BASE}${path}`);
    for (const [key, value] of Object.entries(options.search ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });

    const payload = (await response.json().catch(() => null)) as CloudflareEnvelope<T> | null;
    if (!response.ok) {
      const message = formatApiMessages(payload?.errors) ?? `${response.status} ${response.statusText}`;
      fail(`Cloudflare API error: ${message}`);
    }

    if (!payload) {
      fail('Cloudflare API error: invalid JSON response');
    }

    if (payload.success === false) {
      const message = formatApiMessages(payload.errors) ?? 'request failed';
      fail(`Cloudflare API error: ${message}`);
    }

    return payload;
  }

  private async collectPages<T>(path: string, search?: Record<string, string | number | boolean | undefined>): Promise<T[]> {
    const records: T[] = [];
    let page = 1;

    while (true) {
      const payload = await this.request<T[]>(path, {
        search: {
          ...search,
          page,
          per_page: PAGE_SIZE,
        },
      });

      records.push(...payload.result);

      const totalPages = payload.result_info?.total_pages ?? 1;
      if (page >= totalPages) {
        break;
      }

      page += 1;
    }

    return records;
  }

  private async zoneId(zone: string): Promise<string> {
    const cachedZoneId = this.zoneIdCache.get(zone);
    if (cachedZoneId) {
      verbose('Using cached Cloudflare zone id', { zone, zoneId: cachedZoneId });
      return cachedZoneId;
    }

    verbose('Looking up Cloudflare zone id', { zone });
    const zones = await this.collectPages<CloudflareZone>('/zones', { name: zone });
    const zoneId = zones.find((entry) => entry.name === zone)?.id;
    if (!zoneId || typeof zoneId !== 'string') {
      fail(`zone not found in Cloudflare: ${zone}`);
    }

    this.zoneIdCache.set(zone, zoneId);
    verbose('Resolved Cloudflare zone id', { zone, zoneId });
    return zoneId;
  }

  async listRecords(zone: string): Promise<ExpandedRecord[]> {
    const zoneId = await this.zoneId(zone);

    verbose('Listing Cloudflare records', { zone, zoneId });
    const records = await this.collectPages<CloudflareRecord>(`/zones/${zoneId}/dns_records`);
    verbose('Listed Cloudflare records', { zone, count: records.length });
    return records.map((record) => ({
      id: record.id,
      name: relName(String(record.name), zone),
      type: String(record.type),
      value: String(record.content),
      ttl: record.ttl === 1 ? null : (record.ttl ?? null),
      proxied: record.proxied ?? null,
      priority: record.priority ?? null,
      comment: record.comment ?? null,
    } satisfies ExpandedRecord));
  }

  async createRecord(zone: string, record: ExpandedRecord): Promise<void> {
    const zoneId = await this.zoneId(zone);

    verbose('Creating Cloudflare record', { zone, record: describeRecord(zone, record) });
    await this.request(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: this.recordBody(zone, record),
    });
  }

  async updateRecord(zone: string, record: ExpandedRecord): Promise<void> {
    const zoneId = await this.zoneId(zone);
    if (!record.id) {
      fail('record id missing for update');
    }

    verbose('Updating Cloudflare record', { zone, record: describeRecord(zone, record), recordId: record.id });
    await this.request(`/zones/${zoneId}/dns_records/${record.id}`, {
      method: 'PUT',
      body: this.recordBody(zone, record),
    });
  }

  async deleteRecord(zone: string, record: ExpandedRecord): Promise<void> {
    const zoneId = await this.zoneId(zone);
    if (!record.id) {
      fail('record id missing for delete');
    }

    verbose('Deleting Cloudflare record', { zone, record: describeRecord(zone, record), recordId: record.id });
    await this.request(`/zones/${zoneId}/dns_records/${record.id}`, {
      method: 'DELETE',
    });
  }

  private recordBody(zone: string, record: ExpandedRecord): Record<string, unknown> {
    const body: Record<string, unknown> = {
      type: record.type,
      name: absName(record.name, zone),
      content: record.value,
      ttl: record.ttl ?? 1,
    };

    if (record.proxied != null) {
      body.proxied = record.proxied;
    }

    if (record.priority != null) {
      body.priority = record.priority;
    }

    if (record.comment != null) {
      body.comment = record.comment;
    }

    return body;
  }
}
