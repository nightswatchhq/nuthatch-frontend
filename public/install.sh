#!/bin/sh
# Nuthatch installer.
#
# Downloads the prebuilt static binary for your platform from the latest GitHub release, verifies
# its SHA-256 checksum, and installs it. No compiler needed - you never build from source, so the
# rustc toolchain on your machine is irrelevant.
#
# It is deliberately short and readable. Piping a script to a shell asks for trust; read it first.
#   Source: https://github.com/nightswatchhq/nuthatch
#   Override install dir with NUTHATCH_INSTALL_DIR (default: $HOME/.local/bin).

set -eu

REPO="nightswatchhq/nuthatch"
BASE="https://github.com/${REPO}/releases/latest/download"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin)
    case "$arch" in
      arm64 | aarch64) target="aarch64-apple-darwin" ;;
      x86_64) echo "nuthatch: no prebuilt binary for Intel Mac yet - build from source: cargo +1.95.0 install --git https://github.com/nightswatchhq/nuthatch nuthatch" >&2; exit 1 ;;
      *) echo "nuthatch: unsupported macOS architecture '$arch'" >&2; exit 1 ;;
    esac ;;
  Linux)
    case "$arch" in
      x86_64 | amd64) target="x86_64-unknown-linux-gnu" ;;
      *) echo "nuthatch: no prebuilt binary for Linux '$arch' yet - build from source: cargo +1.95.0 install --git https://github.com/nightswatchhq/nuthatch nuthatch" >&2; exit 1 ;;
    esac ;;
  *)
    echo "nuthatch: unsupported OS '$os' - build from source: cargo +1.95.0 install --git https://github.com/nightswatchhq/nuthatch nuthatch" >&2; exit 1 ;;
esac

tarball="nuthatch-${target}.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "nuthatch: downloading ${tarball}…"
curl -fsSL "${BASE}/${tarball}" -o "${tmp}/${tarball}"
curl -fsSL "${BASE}/${tarball}.sha256" -o "${tmp}/${tarball}.sha256"

echo "nuthatch: verifying checksum…"
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$tmp" && sha256sum -c "${tarball}.sha256" >/dev/null )
elif command -v shasum >/dev/null 2>&1; then
  ( cd "$tmp" && shasum -a 256 -c "${tarball}.sha256" >/dev/null )
else
  echo "nuthatch: no sha256 tool found; refusing to install unverified" >&2; exit 1
fi

tar xzf "${tmp}/${tarball}" -C "$tmp"

dir="${NUTHATCH_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dir"
install -m 0755 "${tmp}/nuthatch" "${dir}/nuthatch"

echo "nuthatch: installed to ${dir}/nuthatch"
case ":$PATH:" in
  *":$dir:"*) : ;;
  *) echo "nuthatch: add ${dir} to your PATH to run 'nuthatch'" ;;
esac
echo ""
echo "  next:  nuthatch init 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 --chain mainnet"
echo "         nuthatch dev"
