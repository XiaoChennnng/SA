#!/bin/sh
# Install the SA (Science Agent) standalone binary for macOS or Linux.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/XiaoChennnng/SA/main/install.sh | sh
# Optional environment variables:
#   SA_VERSION=v0.1.0       install a specific release instead of the latest
#   SA_BIN_DIR=...          directory for the `sa` symlink (default: ~/.local/bin)
#   SA_DATA_DIR=...         directory for the binary and its helpers (default: ~/.local/share/sa)
#   SA_GITHUB_MIRROR=...    prefix for GitHub URLs, tried before the direct URL
#   SA_NO_MIRROR=1          disable the built-in GitHub mirror fallback
set -eu

REPO="${SA_REPO:-XiaoChennnng/SA}"
VERSION="${SA_VERSION:-latest}"
BIN_DIR="${SA_BIN_DIR:-${XDG_BIN_HOME:-$HOME/.local/bin}}"
DATA_DIR="${SA_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/sa}"
DEFAULT_MIRRORS="https://ghfast.top https://gh-proxy.com https://ghproxy.net https://github.moeyy.xyz"

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

if command -v curl >/dev/null 2>&1; then
	DOWNLOADER=curl
elif command -v wget >/dev/null 2>&1; then
	DOWNLOADER=wget
else
	echo "curl or wget is required to install SA." >&2
	exit 1
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sa-install.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

# A mirror prefix is prepended to the full GitHub URL. Try it first when set, then direct.
BASES="$BASE"
if [ -n "${SA_GITHUB_MIRROR:-}" ]; then
	MIRROR="${SA_GITHUB_MIRROR%/}"
	BASES="${MIRROR}/${BASE}
${BASE}"
elif [ -z "${SA_NO_MIRROR:-}" ]; then
	for MIRROR in $DEFAULT_MIRRORS; do
		BASES="${BASES}
${MIRROR}/${BASE}"
	done
fi

# $3 is the maximum time in seconds for curl.
fetch_file() {
	if [ "$DOWNLOADER" = "curl" ]; then
		curl -fsSL --connect-timeout 15 --max-time "$3" --speed-limit 1024 --speed-time 60 "$1" -o "$2"
	else
		wget -q --timeout=60 --tries=1 "$1" -O "$2"
	fi
}

echo "Downloading ${ASSET}..."
DOWNLOADED_FROM=
while IFS= read -r CANDIDATE; do
	[ -n "$CANDIDATE" ] || continue
	rm -f "${TMP_DIR}/${ASSET}" "${TMP_DIR}/SHA256SUMS"
	if fetch_file "${CANDIDATE}/SHA256SUMS" "${TMP_DIR}/SHA256SUMS" 30 &&
		fetch_file "${CANDIDATE}/${ASSET}" "${TMP_DIR}/${ASSET}" 1800; then
		DOWNLOADED_FROM="$CANDIDATE"
		break
	fi
	echo "  Download failed from ${CANDIDATE}" >&2
done <<EOF
${BASES}
EOF
if [ -z "$DOWNLOADED_FROM" ]; then
	echo "Could not download ${ASSET} or SHA256SUMS from GitHub or any mirror." >&2
	echo "Set SA_GITHUB_MIRROR to another GitHub mirror prefix and retry." >&2
	exit 1
fi
echo "Downloaded from ${DOWNLOADED_FROM}"

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
