#!/bin/sh
# Install the SA (Science Agent) standalone binary for macOS or Linux.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/XiaoChennnng/SA/main/install.sh | sh
# Optional environment variables:
#   SA_VERSION=v0.1.0   install a specific release instead of the latest
#   SA_BIN_DIR=...      directory for the `sa` symlink (default: ~/.local/bin)
#   SA_DATA_DIR=...     directory for the binary and its helpers (default: ~/.local/share/sa)
set -eu

REPO="${SA_REPO:-XiaoChennnng/SA}"
VERSION="${SA_VERSION:-latest}"
BIN_DIR="${SA_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
DATA_DIR="${SA_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/sa}"

case "$(uname -s)" in
	Darwin) OS=darwin ;;
	Linux) OS=linux ;;
	*)
		echo "Unsupported operating system: $(uname -s). Download a release manually from https://github.com/$REPO/releases" >&2
		exit 1
		;;
esac

case "$(uname -m)" in
	x86_64|amd64) ARCH=x64 ;;
	arm64|aarch64) ARCH=arm64 ;;
	*)
		echo "Unsupported architecture: $(uname -m). Download a release manually from https://github.com/$REPO/releases" >&2
		exit 1
		;;
esac

PLATFORM="${OS}-${ARCH}"
ASSET="sa-${PLATFORM}.tar.gz"
if [ "$VERSION" = "latest" ]; then
	BASE="https://github.com/${REPO}/releases/latest/download"
else
	BASE="https://github.com/${REPO}/releases/download/v${VERSION#v}"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sa-install.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

echo "Downloading ${ASSET}..."
if command -v curl >/dev/null 2>&1; then
	curl -fsSL "${BASE}/${ASSET}" -o "${TMP_DIR}/${ASSET}"
	curl -fsSL "${BASE}/SHA256SUMS" -o "${TMP_DIR}/SHA256SUMS"
elif command -v wget >/dev/null 2>&1; then
	wget -q "${BASE}/${ASSET}" -O "${TMP_DIR}/${ASSET}"
	wget -q "${BASE}/SHA256SUMS" -O "${TMP_DIR}/SHA256SUMS"
else
	echo "curl or wget is required to install SA." >&2
	exit 1
fi

EXPECTED="$(awk -v name="$ASSET" '$2 == name || $2 == "*" name { print $1; exit }' "${TMP_DIR}/SHA256SUMS")"
if [ -z "$EXPECTED" ]; then
	echo "No checksum found for ${ASSET}." >&2
	exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
	ACTUAL="$(sha256sum "${TMP_DIR}/${ASSET}" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
	ACTUAL="$(shasum -a 256 "${TMP_DIR}/${ASSET}" | awk '{ print $1 }')"
else
	echo "sha256sum or shasum is required to verify the download." >&2
	exit 1
fi
if [ "$EXPECTED" != "$ACTUAL" ]; then
	echo "Checksum mismatch for ${ASSET}; aborting." >&2
	exit 1
fi

tar -xzf "${TMP_DIR}/${ASSET}" -C "${TMP_DIR}"
mkdir -p "$BIN_DIR" "$(dirname "$DATA_DIR")"
rm -rf "$DATA_DIR"
mv "${TMP_DIR}/sa" "$DATA_DIR"
ln -sf "${DATA_DIR}/sa" "${BIN_DIR}/sa"

echo "Installed SA to ${BIN_DIR}/sa"
case ":${PATH}:" in
	*":${BIN_DIR}:"*) ;;
	*) echo "Add ${BIN_DIR} to PATH, then restart your shell: export PATH=\"${BIN_DIR}:\$PATH\"" ;;
esac
"${BIN_DIR}/sa" --version
