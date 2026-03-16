{
  description = "dnsctl.nix - Nix-native DNS IaC";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    (flake-utils.lib.eachSystem flake-utils.lib.defaultSystems (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        package = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
          pname = "dnsctl.nix";
          version = "0.1.0";
          src = ./.;

          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (finalAttrs) pname version src;
            fetcherVersion = 3;
            hash = "sha256-fc6LlCfHFD2E99RVEedM9+B3Q/qUGCI5fx92aRkt+fc=";
          };

          nativeBuildInputs = [
            pkgs.nodejs
            pkgs.esbuild
            pkgs.pnpm
            pkgs.pnpmConfigHook
          ];

          buildPhase = ''
            runHook preBuild
            pnpm run build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            mkdir -p $out/bin
            printf '#!${pkgs.nodejs}/bin/node\n' > $out/bin/dnsctl
            cat dist/main.cjs >> $out/bin/dnsctl
            chmod +x $out/bin/dnsctl

            runHook postInstall
          '';
        });
      in
      {
        packages = {
          default = package;
          "dnsctl.nix" = package;
        };
        devShell = pkgs.mkShell {
          buildInputs = [
            pkgs.esbuild
            pkgs.nodejs
            pkgs.pnpm
          ];
        };
      }
    ))
    // {
      overlays.default = final: prev: {
        dnsctl = self.packages.${final.system}."dnsctl.nix";
      };
    };
}
