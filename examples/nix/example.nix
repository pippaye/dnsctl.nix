{
  providers = {
    cf = {
      type = "cloudflare";
      tokenFile = "~/.config/sops-nix/secrets/CF_PIPPAYE_ZONE_EDIT_TOKEN";
    };
  };

  zones = {
    "pippaye.top" = {
      provider = "cf";

      records = [
      ];
    };
  };
}
