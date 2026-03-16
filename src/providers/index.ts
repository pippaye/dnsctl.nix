import type { ExpandedRecord, Plan } from '../types.ts';
import { expandHome, fail, verbose } from '../utils.ts';

export abstract class Provider {
  abstract listRecords(zone: string): Promise<ExpandedRecord[]>;
  abstract createRecord(zone: string, record: ExpandedRecord): Promise<void>;
  abstract updateRecord(zone: string, record: ExpandedRecord): Promise<void>;
  abstract deleteRecord(zone: string, record: ExpandedRecord): Promise<void>;
}

export async function providerForZone(plan: Plan, zone: string, cache: Map<string, Provider>): Promise<Provider> {
  const zoneConfig = plan.zones[zone];
  if (!zoneConfig?.provider) {
    fail(`zone not found or missing provider: ${zone}`);
  }

  const providerName = zoneConfig.provider;
  const providerConfig = plan.providers[providerName];
  if (!providerConfig?.type) {
    fail(`provider type not found for: ${providerName}`);
  }

  if (!providerConfig.tokenFile) {
    fail(`tokenFile not found for provider: ${providerName}`);
  }

  const cachedProvider = cache.get(providerName);
  if (cachedProvider) {
    verbose('Using cached provider', { zone, provider: providerName, type: providerConfig.type });
    return cachedProvider;
  }

  verbose('Creating provider for zone', { zone, provider: providerName, type: providerConfig.type });

  let provider: Provider;
  switch (providerConfig.type) {
    case 'cloudflare': {
      const module = await import('./cloudflare.ts');
      provider = await module.CloudflareProvider.create(expandHome(providerConfig.tokenFile));
      break;
    }
    default:
      fail(`unsupported provider type: ${providerConfig.type}`);
  }

  cache.set(providerName, provider);
  return provider;
}
