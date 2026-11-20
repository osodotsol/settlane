#!/usr/bin/env bash
# Installs `anvil` and `cast` (Foundry, free, local) for experiments/anvil/run.py.
#
# The release URL and its SHA-256 are PINNED here, so the download is checked against a value that
# lives in this repository, not against a file fetched from the same host. A mismatch aborts and
# installs nothing. Only `anvil` and `cast` are installed; no script from the network is run.
# Install directory: $FOUNDRY_DEST, default ~/tools/foundry/bin (outside the repository).
#
# The checksum was verified on 2026-11-20 against the `.sha256` asset of the release. The release's
# sigstore attestation was NOT verified (it needs the GitHub CLI), so this proves the bytes are the
# ones that were reviewed, not who built them.
set -euo pipefail
VERSION="v1.10.0"
SHA256="90729233bd9a683b872783ae2e3217fb56876fa2a3c37185f13e39dca8525041"
URL="https://github.com/foundry-rs/foundry/releases/download/${VERSION}/foundry_${VERSION}_linux_amd64.tar.gz"
DEST="${FOUNDRY_DEST:-$HOME/tools/foundry/bin}"

if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
  echo "install_foundry: only Linux x86_64 is pinned here; install Foundry ${VERSION#v} for your platform and re-run the suite" >&2
  exit 2
fi
if [ -x "$DEST/anvil" ] && [ -x "$DEST/cast" ] && "$DEST/anvil" --version | grep -q "Version: ${VERSION#v}$" && "$DEST/cast" --version | grep -q "Version: ${VERSION#v}$"; then
  echo "install_foundry: anvil and cast ${VERSION#v} already installed in $DEST"
  exit 0
fi
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
echo "install_foundry: downloading $URL"
curl -fsSL --retry 3 --max-time 600 -o "$tmp/foundry.tar.gz" "$URL"
echo "$SHA256  $tmp/foundry.tar.gz" | sha256sum -c - || { echo "install_foundry: CHECKSUM MISMATCH, nothing installed" >&2; exit 1; }
mkdir "$tmp/x"
tar -xzf "$tmp/foundry.tar.gz" -C "$tmp/x" anvil cast
mkdir -p "$DEST"
install -m 0755 "$tmp/x/anvil" "$tmp/x/cast" "$DEST/"
"$DEST/anvil" --version | head -1
"$DEST/cast" --version | head -1
echo "install_foundry: installed into $DEST"
