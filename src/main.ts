import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Command, CommanderError } from 'commander';
import type { DiffResult, ExpandedRecord, Plan } from './types.ts';
import { providerForZone } from './providers/index.ts';
import type { Provider } from './providers/index.ts';
import { computeDiff, expandLocalRecords } from './diff.ts';
import { describeRecord, fail, fqdn, setVerbose, toNixString, verbose } from './utils.ts';

const DEFAULT_FLAKE_ATTR = 'dnsctl';

interface GlobalOptions {
  plan?: string;
  nix?: string;
  flake?: string;
  verbose?: boolean;
}

interface ListOptions {
  remote?: boolean;
}

interface ApplyOptions {
  dryRun?: boolean;
  prune?: boolean;
}

function validatePlan(plan: unknown): asserts plan is Plan {
  if (!plan || typeof plan !== 'object') {
    fail('invalid plan: expected object with keys providers and zones');
  }

  const candidate = plan as Partial<Plan>;
  if (!candidate.providers || typeof candidate.providers !== 'object' || !candidate.zones || typeof candidate.zones !== 'object') {
    fail('invalid plan: expected object with keys providers and zones');
  }
}

function logPlanSummary(plan: Plan): void {
  verbose('Loaded plan', {
    providers: Object.keys(plan.providers).length,
    zones: Object.keys(plan.zones).length,
  });
}

function resolveFlakeRef(flake?: string): string {
  if (!flake) {
    return `.#${DEFAULT_FLAKE_ATTR}`;
  }

  if (flake.includes('#')) {
    return flake;
  }

  return `${flake}#${DEFAULT_FLAKE_ATTR}`;
}

async function loadPlan(options: GlobalOptions): Promise<Plan> {
  if (options.nix && options.flake) {
    fail('use either --nix or --flake, not both');
  }

  if (options.nix) {
    verbose('Evaluating plan from Nix file', { nixFile: options.nix });
    const result = spawnSync('nix', ['eval', '--json', '--file', options.nix], { encoding: 'utf8' });
    if (result.status !== 0) {
      fail(result.stderr.trim() || 'nix eval failed');
    }

    const plan = JSON.parse(result.stdout);
    validatePlan(plan);
    logPlanSummary(plan);
    return plan;
  }

  if (options.flake || (!options.plan && !options.nix)) {
    const flakeRef = resolveFlakeRef(options.flake);
    verbose('Evaluating plan from flake output', { flakeRef });
    const result = spawnSync('nix', ['eval', '--json', flakeRef], { encoding: 'utf8' });
    if (result.status !== 0) {
      fail(result.stderr.trim() || 'nix eval failed');
    }

    const plan = JSON.parse(result.stdout);
    validatePlan(plan);
    logPlanSummary(plan);
    return plan;
  }

  const planPath = options.plan ?? 'plan.json';
  verbose('Reading plan file', { planPath });
  const planContent = await readFile(planPath, 'utf8');
  const plan = JSON.parse(planContent);
  validatePlan(plan);
  logPlanSummary(plan);
  return plan;
}

function planZones(plan: Plan): string[] {
  return Object.keys(plan.zones).sort();
}

function printLocalRecords(plan: Plan, zoneFilter?: string): void {
  const zones = zoneFilter ? [zoneFilter] : planZones(plan);
  verbose('Listing local records', { zones });
  for (const zone of zones) {
    for (const record of expandLocalRecords(plan, zone)) {
      console.log(`${fqdn(zone, record.name)} ${record.type} ${record.value}`);
    }
  }
}

async function printRemoteRecords(plan: Plan, providerCache: Map<string, Provider>, zoneFilter?: string): Promise<void> {
  const zones = zoneFilter ? [zoneFilter] : planZones(plan);
  verbose('Listing remote records', { zones });
  for (const zone of zones) {
    const provider = await providerForZone(plan, zone, providerCache);
    const records = await provider.listRecords(zone);
    for (const record of records) {
      console.log(`${fqdn(zone, record.name)} ${record.type} ${record.value}`);
    }
  }
}

function printDiff(zone: string, diff: DiffResult): void {
  for (const record of diff.create) {
    console.log(`+ create ${fqdn(zone, record.name)} ${record.type} ${record.value}`);
  }

  for (const record of diff.update) {
    console.log(`~ update ${fqdn(zone, record.name)} ${record.type} ${record.value}`);
  }

  for (const record of diff.delete) {
    console.log(`- delete ${fqdn(zone, record.name)} ${record.type} ${record.value}`);
  }
}

function renderImport(records: ExpandedRecord[]): string {
  const grouped = new Map<string, ExpandedRecord[]>();

  for (const record of [...records].sort((left, right) => {
    return left.name.localeCompare(right.name) || left.type.localeCompare(right.type) || left.value.localeCompare(right.value);
  })) {
    const key = `${record.name}|${record.type}`;
    const group = grouped.get(key) ?? [];
    group.push(record);
    grouped.set(key, group);
  }

  const renderedRecords = [...grouped.values()].map((group) => {
    const firstRecord = group[0];
    const lines = [
      '{',
      `  name = ${toNixString(firstRecord.name)};`,
      `  type = ${toNixString(firstRecord.type)};`,
      `  values = [ ${group.map((record) => toNixString(record.value)).join(' ')} ];`,
    ];

    if (firstRecord.ttl != null) {
      lines.push(`  ttl = ${firstRecord.ttl};`);
    }

    if (firstRecord.proxied != null) {
      lines.push(`  proxied = ${firstRecord.proxied ? 'true' : 'false'};`);
    }

    if (firstRecord.priority != null) {
      lines.push(`  priority = ${firstRecord.priority};`);
    }

    if (firstRecord.comment != null) {
      lines.push(`  comment = ${toNixString(firstRecord.comment)};`);
    }

    lines.push('}');
    return `  ${lines.join('\n  ')}`;
  });

  return `\n[\n${renderedRecords.join('\n')}\n]`.trimStart();
}

async function diffForZone(plan: Plan, zone: string, providerCache: Map<string, Provider>): Promise<DiffResult> {
  const provider = await providerForZone(plan, zone, providerCache);
  const localRecords = expandLocalRecords(plan, zone);
  const remoteRecords = await provider.listRecords(zone);
  const diff = computeDiff(localRecords, remoteRecords);
  verbose('Computed diff', {
    zone,
    local: localRecords.length,
    remote: remoteRecords.length,
    create: diff.create.length,
    update: diff.update.length,
    delete: diff.delete.length,
    conflictDelete: diff.conflictDelete.length,
    pruneDelete: diff.pruneDelete.length,
  });
  return diff;
}

async function applyZone(plan: Plan, zone: string, providerCache: Map<string, Provider>, dryRun: boolean, prune: boolean): Promise<void> {
  const provider = await providerForZone(plan, zone, providerCache);
  const diff = await diffForZone(plan, zone, providerCache);

  verbose('Applying zone', {
    zone,
    dryRun,
    prune,
    create: diff.create.length,
    update: diff.update.length,
    conflictDelete: diff.conflictDelete.length,
    pruneDelete: diff.pruneDelete.length,
  });

  if (dryRun) {
    for (const record of diff.create) {
      console.log(`+ create ${fqdn(zone, record.name)} ${record.type} ${record.value}`);
    }

    for (const record of diff.update) {
      console.log(`~ update ${fqdn(zone, record.name)} ${record.type} ${record.value}`);
    }

    for (const record of diff.conflictDelete) {
      console.log(`- delete ${fqdn(zone, record.name)} ${record.type} ${record.value}`);
    }

    if (prune) {
      for (const record of diff.pruneDelete) {
        console.log(`- delete ${fqdn(zone, record.name)} ${record.type} ${record.value}`);
      }
    }

    return;
  }

  for (const record of diff.conflictDelete) {
    verbose('Applying conflict delete', { zone, record: describeRecord(zone, record) });
    await provider.deleteRecord(zone, record);
  }

  for (const record of diff.update) {
    verbose('Applying update', { zone, record: describeRecord(zone, record) });
    await provider.updateRecord(zone, record);
  }

  for (const record of diff.create) {
    verbose('Applying create', { zone, record: describeRecord(zone, record) });
    await provider.createRecord(zone, record);
  }

  if (prune) {
    for (const record of diff.pruneDelete) {
      verbose('Applying prune delete', { zone, record: describeRecord(zone, record) });
      await provider.deleteRecord(zone, record);
    }
  }
}

function createProgram(): Command {
  const program = new Command();
  program
    .name('dnsctl')
    .description('Nix-native DNS IaC')
    .option('--plan <path>', 'Path to plan.json (default: ./plan.json)')
    .option('--nix <file>', 'Evaluate Nix file as the plan expression')
    .option('--flake <ref>', 'Evaluate flake ref (e.g. .#dnsctl) and use result')
    .option('--verbose', 'Print detailed logs')
    .showHelpAfterError()
    .showSuggestionAfterError();

  program.hook('preAction', (_thisCommand, actionCommand) => {
    const options = actionCommand.optsWithGlobals<GlobalOptions>();
    setVerbose(Boolean(options.verbose));
    verbose('Running command', { command: actionCommand.name() });
  });

  program
    .command('list')
    .argument('[zone]')
    .option('--remote', 'List remote records instead of local plan records')
    .action(async (zone: string | undefined, _options: ListOptions, command: Command) => {
      const plan = await loadPlan(command.optsWithGlobals<GlobalOptions>());
      const providerCache = new Map<string, Provider>();
      const options = command.opts<ListOptions>();

      if (options.remote) {
        await printRemoteRecords(plan, providerCache, zone);
        return;
      }

      printLocalRecords(plan, zone);
    });

  program
    .command('diff')
    .argument('[zone]')
    .action(async (zone: string | undefined, _options: Record<string, never>, command: Command) => {
      const plan = await loadPlan(command.optsWithGlobals<GlobalOptions>());
      const providerCache = new Map<string, Provider>();
      const zones = zone ? [zone] : planZones(plan);

      for (const currentZone of zones) {
        printDiff(currentZone, await diffForZone(plan, currentZone, providerCache));
      }
    });

  program
    .command('apply')
    .argument('[zone]')
    .option('--dry-run', 'Print planned changes without applying them')
    .option('--prune', 'Delete remote records missing from the local plan')
    .action(async (zone: string | undefined, _options: ApplyOptions, command: Command) => {
      const plan = await loadPlan(command.optsWithGlobals<GlobalOptions>());
      const providerCache = new Map<string, Provider>();
      const options = command.opts<ApplyOptions>();
      const zones = zone ? [zone] : planZones(plan);

      for (const currentZone of zones) {
        await applyZone(plan, currentZone, providerCache, Boolean(options.dryRun), Boolean(options.prune));
      }
    });

  program
    .command('import')
    .argument('<zone>')
    .action(async (zone: string, _options: Record<string, never>, command: Command) => {
      const plan = await loadPlan(command.optsWithGlobals<GlobalOptions>());
      const providerCache = new Map<string, Provider>();
      const provider = await providerForZone(plan, zone, providerCache);
      const records = await provider.listRecords(zone);
      console.log(renderImport(records));
    });

  program.action(() => {
    program.help();
  });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      throw new Error(error.message);
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(`dnsctl: ${error.message}`);
  } else {
    console.error('dnsctl: unknown error');
  }
  process.exit(1);
});
