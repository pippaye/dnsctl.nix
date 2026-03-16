# dnsctl.nix

Nix-native DNS IaC: a TypeScript CLI with Cloudflare's official SDK.

## Quick Start (Plan JSON)

1) Generate a plan:

```bash
nix eval --json -f examples/nix/example.nix dnsctl > plan.json
```

2) List local records:

```bash
dnsctl list
```

3) Diff against provider:

```bash
dnsctl diff
dnsctl diff example.com
```

4) Apply:

```bash
dnsctl apply --dry-run
dnsctl apply --prune
dnsctl apply --dry-run example.com
```

Remote listing:

```bash
dnsctl list --remote example.com
dnsctl list --remote   # all zones
```

Import remote records as Nix records:

```bash
dnsctl import example.com
```

Verbose logs:

```bash
dnsctl --verbose diff
dnsctl --verbose apply --dry-run
```

## Schema (Nix DSL)

Top level:

```nix
{
  dnsctl = {
    providers = { ... };
    zones = { ... };
  };
}
```

Providers:

```nix
providers = {
  "<name>" = {
    type = "cloudflare";
    tokenFile = "/run/secrets/cf-token";
  };
};
```

Zones:

```nix
zones = {
  "<zone>" = {
    provider = "<provider>";
    records = [ Record ];
  };
};
```

Record:

```nix
{
  name = "api";
  type = "A";
  ttl = 120; # optional, null uses provider default
  values = [ "1.2.3.4" ];

  # provider-specific extensions
  proxied = true;
  priority = 10;
  comment = "optional";
}
```

## Direct Nix Evaluation

Evaluate a Nix file directly:

```bash
dnsctl --nix examples/nix/example.nix list
dnsctl list --nix examples/nix/example.nix
```

Evaluate a flake output explicitly:

```bash
dnsctl --flake .#dnsctl list
dnsctl --flake ~/repo/dotfiles#dnsctl diff
```

If `--flake` is given without an attribute, `dnsctl` appends `#dnsctl` automatically:

```bash
dnsctl --flake ~/repo/dotfiles diff
```

Default (no flags) uses flake ref `.#dnsctl`:

```bash
dnsctl list
```

## Install

From this repo:

```bash
nix profile install .#default
```

Temporary shell:

```bash
nix shell .#default
```

Local development dependencies:

```bash
pnpm install
```

Build the packaged CLI:

```bash
nix build .#default
./result/bin/dnsctl --help
```

## Provider Setup

Cloudflare:

- Set `tokenFile` to a file containing an API token with DNS edit permissions.
- `tokenFile` supports a leading `~` and expands it to `$HOME` at runtime.

## Architecture

- `src/main.ts` contains CLI parsing and command orchestration.
- `src/providers/index.ts` defines the provider base class and the provider factory.
- `src/providers/index.ts` lazily loads provider implementations by `type`.
- `src/providers/cloudflare.ts` statically imports the Cloudflare SDK and implements Cloudflare behavior only.

## Notes

- Records are expanded to one record per value.
- Updates are matched per `name` + `type`; value or metadata changes overwrite existing records when possible.
- Conflicting `A`/`AAAA`/`CNAME` records with the same name are deleted before replacement, even without `--prune`.
- Type changes are still treated as delete + create.
- Packaged builds use `esbuild` to bundle the CLI into a single executable script and install it as `bin/dnsctl`.
- Legacy shell provider scripts were removed.
