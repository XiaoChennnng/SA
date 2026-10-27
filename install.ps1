# Install the SA (Science Agent) standalone binary for Windows.
# Usage:
#   irm https://raw.githubusercontent.com/XiaoChennnng/SA/main/install.ps1 | iex
# Optional environment variables:
#   SA_VERSION=v0.1.0   install a specific release instead of the latest
#   SA_INSTALL_DIR=...  installation directory (default: %LOCALAPPDATA%\SA)
$ErrorActionPreference = "Stop"

$Repo = if ($env:SA_REPO) { $env:SA_REPO } else { "XiaoChennnng/SA" }
$Version = if ($env:SA_VERSION) { $env:SA_VERSION } else { "latest" }
$InstallDir = if ($env:SA_INSTALL_DIR) { $env:SA_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "SA" }

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

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("sa-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempDir | Out-Null
try {
	$archive = Join-Path $tempDir $asset
	$sums = Join-Path $tempDir "SHA256SUMS"
	Write-Host "Downloading $asset..."
	Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $archive
	Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sums

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
