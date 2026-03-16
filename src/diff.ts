import type { DiffResult, ExpandedRecord, Plan, RecordConfig } from './types.ts';
import { compareNullable } from './utils.ts';

function cloneWithoutId(record: ExpandedRecord): Record<string, unknown> {
  const cloned = { ...record };
  delete cloned.id;
  return cloned;
}

function compareScalars(left: unknown, right: unknown): number {
  const leftValue = left ?? null;
  const rightValue = right ?? null;

  if (leftValue === rightValue) {
    return 0;
  }

  if (leftValue === null) {
    return -1;
  }

  if (rightValue === null) {
    return 1;
  }

  if (leftValue < rightValue) {
    return -1;
  }

  return 1;
}

function compareRecords(left: ExpandedRecord, right: ExpandedRecord): number {
  return (
    compareScalars(left.name, right.name) ||
    compareScalars(left.type, right.type) ||
    compareScalars(left.value, right.value) ||
    compareNullable(left.ttl, right.ttl) ||
    compareNullable(left.proxied, right.proxied) ||
    compareNullable(left.priority, right.priority) ||
    compareNullable(left.comment, right.comment)
  );
}

function recordsEqual(left: ExpandedRecord, right: ExpandedRecord): boolean {
  return JSON.stringify(cloneWithoutId(left)) === JSON.stringify(cloneWithoutId(right));
}

function bucketize(records: ExpandedRecord[]): Map<string, ExpandedRecord[]> {
  const buckets = new Map<string, ExpandedRecord[]>();

  for (const record of [...records].sort(compareRecords)) {
    const key = `${record.name}|${record.type}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }

  return buckets;
}

function isAddressLike(type: string): boolean {
  return type === 'A' || type === 'AAAA';
}

function isConflictingCreate(createRecord: ExpandedRecord, deleteRecord: ExpandedRecord): boolean {
  if (createRecord.name !== deleteRecord.name) {
    return false;
  }

  if (createRecord.type === 'CNAME') {
    return isAddressLike(deleteRecord.type) || deleteRecord.type === 'CNAME';
  }

  if (isAddressLike(createRecord.type)) {
    return deleteRecord.type === 'CNAME';
  }

  return false;
}

function conflictingDeletes(create: ExpandedRecord[], deletions: ExpandedRecord[]): ExpandedRecord[] {
  return deletions.filter((deleteRecord) => create.some((createRecord) => isConflictingCreate(createRecord, deleteRecord)));
}

export function expandLocalRecords(plan: Plan, zone: string): ExpandedRecord[] {
  const records = plan.zones[zone]?.records ?? [];

  return records.flatMap((recordConfig: RecordConfig) => {
    const values = recordConfig.values ?? [];
    const { values: _values, ...baseRecord } = recordConfig;

    return values.map((value) => ({
      ...baseRecord,
      name: recordConfig.name,
      type: recordConfig.type,
      value,
    }));
  });
}

export function computeDiff(localRecords: ExpandedRecord[], remoteRecords: ExpandedRecord[]): DiffResult {
  const localBuckets = bucketize(localRecords);
  const remoteBuckets = bucketize(remoteRecords);
  const keys = [...new Set([...localBuckets.keys(), ...remoteBuckets.keys()])].sort();

  const create: ExpandedRecord[] = [];
  const update: ExpandedRecord[] = [];
  const deletion: ExpandedRecord[] = [];

  for (const key of keys) {
    const localGroup = localBuckets.get(key) ?? [];
    const remoteGroup = remoteBuckets.get(key) ?? [];
    const sharedLength = Math.min(localGroup.length, remoteGroup.length);

    for (let index = 0; index < sharedLength; index += 1) {
      const localRecord = localGroup[index];
      const remoteRecord = remoteGroup[index];
      if (!recordsEqual(localRecord, remoteRecord)) {
        update.push({
          ...localRecord,
          id: remoteRecord.id,
        });
      }
    }

    create.push(...localGroup.slice(sharedLength));
    deletion.push(...remoteGroup.slice(sharedLength));
  }

  const conflictDelete = conflictingDeletes(create, deletion);
  const conflictDeleteIds = new Set(conflictDelete.map((record) => record.id).filter(Boolean));
  const pruneDelete = deletion.filter((record) => !record.id || !conflictDeleteIds.has(record.id));

  return {
    create,
    update,
    delete: deletion,
    conflictDelete,
    pruneDelete,
  };
}
