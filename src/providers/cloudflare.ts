import Cloudflare from 'cloudflare';
import type { ExpandedRecord } from '../types.ts';
import { absName, describeRecord, fail, readToken, relName, verbose } from '../utils.ts';
import { Provider } from './index.ts';

interface CloudflareClient {
  zones: {
    list(params: Record<string, unknown>): Promise<unknown>;
  };
  dns: {
    records: {
      list(params: Record<string, unknown>): Promise<unknown>;
      create(params: Record<string, unknown>): Promise<unknown>;
      update(recordId: string, params: Record<string, unknown>): Promise<unknown>;
      delete(recordId: string, params: Record<string, unknown>): Promise<unknown>;
    };
  };
}

function extractResult(page: unknown): any[] {
  if (Array.isArray(page)) {
    return page;
  }

  if (page && typeof page === 'object') {
    const result = (page as { result?: unknown }).result;
    if (Array.isArray(result)) {
      return result;
    }
  }

  return [];
}

async function collectPages(pagePromise: Promise<unknown>): Promise<any[]> {
  const firstPage = await pagePromise;
  const records = [...extractResult(firstPage)];
  let currentPage: any = firstPage;

  while (typeof currentPage?.hasNextPage === 'function' && currentPage.hasNextPage()) {
    currentPage = await currentPage.getNextPage();
    records.push(...extractResult(currentPage));
  }

  return records;
}

function normalizeError(error: unknown): never {
  if (error instanceof Error) {
    fail(`Cloudflare API error: ${error.message}`);
  }

  fail('Cloudflare API error: unknown error');
}

export class CloudflareProvider extends Provider {
  private readonly client: CloudflareClient;
  private readonly zoneIdCache = new Map<string, string>();

  private constructor(client: CloudflareClient) {
    super();
    this.client = client;
    verbose('Loaded Cloudflare SDK');
  }

  static async create(tokenFile: string): Promise<CloudflareProvider> {
    verbose('Initializing Cloudflare provider', { tokenFile });
    const apiToken = await readToken(tokenFile);
    const client = new Cloudflare({ apiToken }) as unknown as CloudflareClient;
    return new CloudflareProvider(client);
  }

  private async zoneId(zone: string): Promise<string> {
    const cachedZoneId = this.zoneIdCache.get(zone);
    if (cachedZoneId) {
      verbose('Using cached Cloudflare zone id', { zone, zoneId: cachedZoneId });
      return cachedZoneId;
    }

    try {
      verbose('Looking up Cloudflare zone id', { zone });
      const zones = await collectPages(this.client.zones.list({ name: zone }));
      const zoneId = zones[0]?.id;
      if (!zoneId || typeof zoneId !== 'string') {
        fail(`zone not found in Cloudflare: ${zone}`);
      }

      this.zoneIdCache.set(zone, zoneId);
      verbose('Resolved Cloudflare zone id', { zone, zoneId });
      return zoneId;
    } catch (error) {
      normalizeError(error);
    }
  }

  async listRecords(zone: string): Promise<ExpandedRecord[]> {
    const zoneId = await this.zoneId(zone);

    try {
      verbose('Listing Cloudflare records', { zone, zoneId });
      const records = await collectPages(this.client.dns.records.list({ zone_id: zoneId }));
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
    } catch (error) {
      normalizeError(error);
    }
  }

  async createRecord(zone: string, record: ExpandedRecord): Promise<void> {
    const zoneId = await this.zoneId(zone);

    try {
      verbose('Creating Cloudflare record', { zone, record: describeRecord(zone, record) });
      await this.client.dns.records.create({
        zone_id: zoneId,
        ...this.recordBody(zone, record),
      });
    } catch (error) {
      normalizeError(error);
    }
  }

  async updateRecord(zone: string, record: ExpandedRecord): Promise<void> {
    const zoneId = await this.zoneId(zone);
    if (!record.id) {
      fail('record id missing for update');
    }

    try {
      verbose('Updating Cloudflare record', { zone, record: describeRecord(zone, record), recordId: record.id });
      await this.client.dns.records.update(record.id, {
        zone_id: zoneId,
        ...this.recordBody(zone, record),
      });
    } catch (error) {
      normalizeError(error);
    }
  }

  async deleteRecord(zone: string, record: ExpandedRecord): Promise<void> {
    const zoneId = await this.zoneId(zone);
    if (!record.id) {
      fail('record id missing for delete');
    }

    try {
      verbose('Deleting Cloudflare record', { zone, record: describeRecord(zone, record), recordId: record.id });
      await this.client.dns.records.delete(record.id, {
        zone_id: zoneId,
      });
    } catch (error) {
      normalizeError(error);
    }
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
