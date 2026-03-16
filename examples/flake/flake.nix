# see flake schema: https://nixos.wiki/wiki/flakes
{
  description = "description";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }@inputs:
    let
      dnsctl = {
        providers = {
          cf = {
            type = "cloudflare";
            tokenFile = "/tmp/cloudflare-token";
          };
        };

        zones = {
          "059867.xyz" = {
            provider = "cf";

            records = [
              {
                name = "@";
                type = "A";
                values = [
                  "1.2.3.4"
                  "1.2.3.5"
                ];
                proxied = true;
              }
              {
                name = "api";
                type = "A";
                values = [ "1.2.3.5" ];
                proxied = true;
              }
              {
                name = "blog";
                type = "CNAME";
                values = [ "pages.dev" ];
              }
              {
                name = "blog12";
                type = "CNAME";
                values = [ "pages.dev" ];
              }
            ];
          };
        };
      };
    in
    (flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages."${system}";
      in
      {
        formatter = pkgs.nixfmt-rfc-style;
        # pkgs.mkShell manual: https://nixos.org/manual/nixpkgs/stable/#sec-pkgs-mkShell
      }
    ))
    // {
      inherit dnsctl;
    };
}
