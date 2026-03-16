{ lib, ... }:
let
  inherit (lib) mkOption types;

  providerType = types.submodule {
    options = {
      type = mkOption {
        type = types.str;
        description = "Provider type (e.g. cloudflare).";
      };
      tokenFile = mkOption {
        type = types.path;
        description = "Path to provider API token file.";
      };
    };
  };

  recordType = types.submodule {
    freeformType = types.attrsOf types.anything;
    options = {
      name = mkOption {
        type = types.str;
        description = "Record name relative to zone (use @ for apex).";
      };
      type = mkOption {
        type = types.str;
        description = "Record type (A, AAAA, CNAME, TXT, ...).";
      };
      ttl = mkOption {
        type = types.nullOr types.int;
        default = null;
        description = "TTL in seconds (null lets provider default).";
      };
      values = mkOption {
        type = types.listOf types.str;
        default = [];
        description = "Record values (expanded to one record per value).";
      };
    };
  };

  zoneType = types.submodule {
    options = {
      provider = mkOption {
        type = types.str;
        description = "Provider name from dnsctl.providers.";
      };
      records = mkOption {
        type = types.listOf recordType;
        default = [];
        description = "Records for this zone.";
      };
    };
  };
in
{
  options.dnsctl = {
    providers = mkOption {
      type = types.attrsOf providerType;
      default = {};
      description = "DNS providers.";
    };
    zones = mkOption {
      type = types.attrsOf zoneType;
      default = {};
      description = "DNS zones.";
    };
  };

  # Plan JSON can be produced with: builtins.toJSON config.dnsctl
}
