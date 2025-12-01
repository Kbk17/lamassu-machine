# Using a specific NixOS 16.09 revision for glibc 2.24
with import (fetchTarball {
  name = "nixpkgs-16.09";
  url = https://github.com/NixOS/nixpkgs/archive/release-16.09.tar.gz;
  sha256 = "0mmjsrdgvlc1nvxd6c97sk6gl1wld19h47ksbcpkyhln9lv3flps";
}) {};
let
  # Define Node.js 22 from unofficial builds
  nodejs22 = stdenv.mkDerivation {
    name = "nodejs-22.1.0-glibc-217";
    version = "22.1.0";

    src = fetchurl {
      url = "https://unofficial-builds.nodejs.org/download/release/v22.1.0/node-v22.1.0-linux-x64-glibc-217.tar.gz";
      sha256 = "0ipyqvvnqk95hqk3r8h8nyrc6fg415kr56mhqbjqzxvkpa64k0dl";
    };

    buildInputs = [ autoPatchelfHook ];

    buildPhase = ":"; # Skip build phase

    installPhase = ''
      mkdir -p $out
      cp -r ./* $out/
      chmod -R +x $out/bin
    '';

    meta = {
      description = "Node.js 22.1.0 compatible with glibc 2.17+";
      platforms = [ "x86_64-linux" ];
    };
  };

  # If autoPatchelfHook is not available in this old nixpkgs, define it
  autoPatchelfHook = if builtins.hasAttr "autoPatchelfHook" pkgs
    then pkgs.autoPatchelfHook
    else stdenv.mkDerivation {
      name = "auto-patchelf-hook";
      buildInputs = [ makeWrapper ];
      phases = [ "installPhase" ];
      installPhase = ''
        mkdir -p $out/nix-support
        echo "This is a minimal placeholder for autoPatchelfHook"
      '';
    };

in
stdenv.mkDerivation {
    name = "node-environment-glibc-2.24";
    buildInputs = [
      nodejs22  # Use our custom Node.js 22
      openssl
      python3
      (builtins.tryEval entr).value or null  # Handle case if entr isn't available
      yasm
    ];

    shellHook = ''
        # Add node_modules bin to PATH
        export PATH="$PWD/node_modules/.bin/:$PATH"

        # Display glibc version to verify
        echo "Using glibc version: $(ldd --version | head -n 1)"

        # Display Node.js version
        echo "Using Node.js version: $(node --version)"
    '';
}
