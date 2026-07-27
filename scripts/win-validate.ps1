# =============================================================================
# Envy - Windows dev harness / feasibility validator
# =============================================================================
#
# Brings the Envy URL daemon up on Windows the same way the (not-yet-built)
# packaged installer eventually will, so you can develop + test the URL feature
# on a real Windows box. It wires the three platform primitives:
#
#   1. NRPT  - routes *.<domain> to our local DNS server on port 53.
#   2. CA    - `certutil` trusts Envy's local CA (Edge/Chrome/system padlock).
#   3. Engine - runs the portable engine (DNS + reverse proxy on 80/443) in a
#               separate window on those privileged ports.
#
# This is a DEV harness, not the shipped install (no Windows service yet) - once
# this proves out, the packaged service/install gets built from the same recipe.
#
# Prereqs on the Windows machine:
#   - This repo cloned + `npm install` run in it.
#   - Docker running (Docker Desktop / etc.) with at least one container.
#   - Run this from an *elevated* PowerShell (Run as Administrator).
#
# If you hit "running scripts is disabled on this system", either launch it as
#   powershell -ExecutionPolicy Bypass -File .\scripts\win-validate.ps1
# or clear the policy for the current session first:
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#
# USAGE:
#   .\scripts\win-validate.ps1                 # bring it up on the default .envy
#   .\scripts\win-validate.ps1 -Domain envy.test    # try a reserved TLD instead
#   .\scripts\win-validate.ps1 -NoEngine       # only wire DNS+CA; run engine yourself
#   .\scripts\win-validate.ps1 -Down           # tear everything back down
#
# Then start a container and browse:
#   docker run -d --name web -p 8080:80 nginx
#   start https://web.<domain>
#   Resolve-DnsName web.<domain>     # verify DNS (nslookup ignores NRPT)

param(
  [string]$Domain = "envy",
  [string]$CaCert = "$env:APPDATA\Envy\ca\envy-ca.crt",
  [switch]$NoEngine,
  [switch]$Down
)

$ErrorActionPreference = "Stop"
$ns = ".$Domain"
$repo = Split-Path -Parent $PSScriptRoot

function Assert-Admin {
  $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this from an elevated PowerShell (Run as Administrator)."
  }
}

function Remove-Nrpt {
  Get-DnsClientNrptRule | Where-Object { $_.Namespace -eq $ns } | ForEach-Object {
    Remove-DnsClientNrptRule -Name $_.Name -Force
  }
}

# Safety net: the engine clears its own hosts block on Ctrl+C, but closing the
# window with the X skips that. Strip the managed block here too so stale names
# never linger pointing at a dead proxy.
function Remove-HostsBlock {
  $hostsFile = Join-Path $env:windir 'System32\drivers\etc\hosts'
  if (-not (Test-Path $hostsFile)) { return }
  $content = Get-Content $hostsFile -Raw
  $cleaned = [regex]::Replace($content, '(?s)\r?\n?# BEGIN ENVY.*?# END ENVY\r?\n?', '')
  if ($cleaned -ne $content) { Set-Content -Path $hostsFile -Value $cleaned -NoNewline }
}

Assert-Admin

if ($Down) {
  Write-Host "Tearing down Envy ($Domain) ..." -ForegroundColor Cyan
  Remove-Nrpt
  Write-Host "  removed NRPT rule(s) for $ns"
  Remove-HostsBlock
  Write-Host "  removed Envy hosts-file block"
  Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -like "*Envy Local CA*" } | ForEach-Object {
    Remove-Item ("Cert:\LocalMachine\Root\" + $_.Thumbprint) -Force
    Write-Host "  removed CA $($_.Thumbprint)"
  }
  ipconfig /flushdns | Out-Null
  Write-Host "Done. Close the engine window (Ctrl+C) if it's still running." -ForegroundColor Green
  return
}

Write-Host "Bringing Envy up for *.$Domain ..." -ForegroundColor Cyan

# 1. Engine (separate window so its logs stay visible). Inherits this elevated
#    token, so it can bind 53/80/443. Skip with -NoEngine to run it yourself.
if (-not $NoEngine) {
  if (-not (Test-Path (Join-Path $repo 'package.json'))) {
    throw "Can't find the repo at $repo - run this from the cloned Envy repo."
  }
  # The engine runs through tsx (a devDependency). Install deps if they're
  # missing so a fresh clone is genuinely turnkey -- include dev deps explicitly
  # in case npm is configured to omit them.
  if (-not (Test-Path (Join-Path $repo 'node_modules\.bin\tsx.cmd'))) {
    Write-Host "  installing npm dependencies (first run)..." -ForegroundColor DarkGray
    Push-Location $repo
    npm install --include=dev
    Pop-Location
  }
  $cmd = "Set-Location '$repo'; " +
         "`$env:ENVY_DOMAINS='$Domain'; `$env:ENVY_DNS_PORT='53'; " +
         "`$env:ENVY_HTTP_PORT='80'; `$env:ENVY_HTTPS_PORT='443'; " +
         "Write-Host 'Envy engine - leave this window open (Ctrl+C to stop)'; npm run engine"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $cmd | Out-Null
  Write-Host "  started engine in a new window (ENVY_DNS_PORT=53, ENVY_DOMAINS=$Domain)"
} else {
  Write-Host "  -NoEngine: start it yourself with ENVY_DNS_PORT=53 ENVY_DOMAINS=$Domain npm run engine"
}

# 2. CA trust - wait for the engine to generate it on first run (up to ~30s).
if (-not (Test-Path $CaCert)) {
  Write-Host "  waiting for the engine to generate the CA at $CaCert ..."
  for ($i = 0; $i -lt 30 -and -not (Test-Path $CaCert); $i++) { Start-Sleep -Seconds 1 }
}
if (Test-Path $CaCert) {
  certutil -addstore -f Root "$CaCert" | Out-Null
  Write-Host "  trusted CA from $CaCert"
} else {
  Write-Host "  ! CA still not found - rerun once the engine has started." -ForegroundColor Yellow
}

# 3. DNS routing via NRPT (idempotent). NRPT always uses port 53.
Remove-Nrpt
Add-DnsClientNrptRule -Namespace $ns -NameServers "127.0.0.1"
Write-Host "  NRPT: $ns -> 127.0.0.1:53"

ipconfig /flushdns | Out-Null

Write-Host ""
Write-Host "Up. Start a container and open a URL:" -ForegroundColor Green
Write-Host "  docker run -d --name web -p 8080:80 nginx" -ForegroundColor Green
Write-Host "  start https://web.$Domain" -ForegroundColor Green
Write-Host "Verify DNS:  Resolve-DnsName web.$Domain   (nslookup ignores NRPT)" -ForegroundColor DarkGray
Write-Host "Tear down:   .\scripts\win-validate.ps1 -Domain $Domain -Down" -ForegroundColor DarkGray
