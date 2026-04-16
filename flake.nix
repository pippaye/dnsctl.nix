{
  description = "dnsctl.nix - Nix-native DNS IaC";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs";
    flake-utils.url = "github:numtide/flake-utils";
    bun2nix.url = "github:nix-community/bun2nix?tag=2.0.8";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  nixConfig = {
    extra-substituters = [
      "https://cache.nixos.org"
      "https://nix-community.cachix.org"
    ];
    extra-trusted-public-keys = [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
      "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
    ];
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      bun2nix,
    }:
    (flake-utils.lib.eachSystem flake-utils.lib.defaultSystems (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ bun2nix.overlays.default ];
        };
        package = pkgs.callPackage ./default.nix { };
      in
      {
        packages = {
          default = package;
          "dnsctl.nix" = package;
        };
        devShell = pkgs.mkShell {
          buildInputs = [
            pkgs.bun
            pkgs.bun2nix
          ];
        };
      }
    ))
    // {
      overlays.default = final: prev: {
        dnsctl = self.packages.${final.stdenv.hostPlatform.system}."dnsctl.nix";
      };
    };
}
