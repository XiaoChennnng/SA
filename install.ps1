# Install the SA (Science Agent) standalone binary for Windows.
# Usage:
#   irm https://raw.githubusercontent.com/XiaoChennnng/SA/main/install.ps1 | iex
# Optional environment variables:
#   SA_VERSION=v0.1.0       install a specific release instead of the latest
#   SA_INSTALL_DIR=...      installation directory (default: %LOCALAPPDATA%\SA)
#   SA_GITHUB_MIRROR=...    prefix for GitHub URLs, tried before the direct URL
#   SA_NO_MIRROR=1          disable the built-in GitHub mirror fallback
$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 buffers downloads when progress is enabled.
$ProgressPreference = "SilentlyContinue"
try {
	[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
	# Older hosts may not expose Tls12; Invoke-WebRequest then uses the system default.
}

$Repo = if ($env:SA_REPO) { $env:SA_REPO } else { "XiaoChennnng/SA" }
$Version = if ($env:SA_VERSION) { $env:SA_VERSION } else { "latest" }
$InstallDir = if ($env:SA_INSTALL_DIR) { $env:SA_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "SA" }
$DefaultMirrors = @("https://ghfast.top", "https://gh-proxy.com", "https://ghproxy.net", "https://github.moeyy.xyz")

# Windows PowerShell 5.1 can resolve RuntimeInformation to a PSReadLine type whose
# OSArchitecture is null, so read the architecture from the environment instead.
$architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($architecture) {
	"AMD64" { "x64" }
	"ARM64" { "arm64" }
	default { throw "Unsupported architecture: $architecture. Download a release manually from https://github.com/$Repo/releases" }
}

$asset = "sa-windows-$arch.zip"
if ($Version -eq "latest") {
	$base = "https://github.com/$Repo/releases/latest/download"
} else {
	$base = "https://github.com/$Repo/releases/download/v$($Version -replace '^v', '')"
}

# A mirror prefix is prepended to the full GitHub URL. Try it first when set, then direct.
$bases = @()
if ($env:SA_GITHUB_MIRROR) {
	$bases += ($env:SA_GITHUB_MIRROR.TrimEnd("/") + "/" + $base)
	$bases += $base
} elseif (-not $env:SA_NO_MIRROR) {
	$bases += $base
	foreach ($mirror in $DefaultMirrors) {
		$bases += ($mirror + "/" + $base)
	}
} else {
	$bases += $base
}

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("sa-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir | Out-Null
try {
	$archive = Join-Path $tempDir $asset
	$sums = Join-Path $tempDir "SHA256SUMS"
	Write-Host "Downloading $asset..."
	$downloaded = $false
	foreach ($candidate in $bases) {
		try {
			Invoke-WebRequest -UseBasicParsing -Uri "$candidate/SHA256SUMS" -OutFile $sums -TimeoutSec 30
			Invoke-WebRequest -UseBasicParsing -Uri "$candidate/$asset" -OutFile $archive -TimeoutSec 600
			$downloaded = $true
			Write-Host "Downloaded from $candidate"
			break
		} catch {
			Write-Host "Download failed from $candidate" -ForegroundColor Yellow
			Remove-Item -Path $archive, $sums -Force -ErrorAction SilentlyContinue
		}
	}
	if (-not $downloaded) {
		throw "Could not download $asset or SHA256SUMS from GitHub or any mirror. Set SA_GITHUB_MIRROR to another GitHub mirror prefix and retry."
	}

	$line = Get-Content $sums |
		Where-Object { $_ -match "\s\*?$([regex]::Escape($asset))$" } |
		Select-Object -First 1
	if (-not $line) { throw "No checksum found for $asset." }
	$expected = ($line -split "\s+")[0].ToLowerInvariant()
	$actual = (Get-FileHash -Algorithm SHA256 -Path $archive).Hash.ToLowerInvariant()
	if ($expected -ne $actual) { throw "Checksum mismatch for $asset; aborting." }

	New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
	Expand-Archive -Path $archive -DestinationPath $InstallDir -Force

	$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
	$entries = @($userPath -split ";" | Where-Object { $_ })
	if ($entries -notcontains $InstallDir) {
		[Environment]::SetEnvironmentVariable("Path", (@($entries) + $InstallDir) -join ";", "User")
	}
	$env:Path = (@($env:Path -split ";" | Where-Object { $_ }) + $InstallDir) -join ";"

	Write-Host "Installed SA to $InstallDir"
	& (Join-Path $InstallDir "sa.exe") --version
} finally {
	Remove-Item -Recurse -Force $tempDir -ErrorAction SilentlyContinue
}
