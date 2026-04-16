{
  stdenvNoCC,
  bun,
  bun2nix,
  ...
}:
stdenvNoCC.mkDerivation {
  pname = "dnsctl.nix";
  version = "0.1.0";

  src = ./.;

  nativeBuildInputs = [
    bun2nix.hook
  ];

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.nix;
  };

  buildPhase = ''
    runHook preBuild
    bun run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin
    printf '#!${bun}/bin/bun\n' > $out/bin/dnsctl
    cat dist/main.js >> $out/bin/dnsctl
    chmod +x $out/bin/dnsctl

    runHook postInstall
  '';
}
