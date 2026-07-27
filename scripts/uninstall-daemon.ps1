# Envy daemon uninstaller (Windows) — the analogue of uninstall-daemon.sh.
#
# Runs elevated (via the GUI's UAC prompt). Reverses install-daemon.ps1:
#   1. Stops + removes the EnvyDaemon scheduled task.
#   2. Untrusts Envy's local CA from LocalMachine\Root.
#   3. Strips Envy's managed block from the hosts file. The daemon normally
#      clears it on a clean shutdown, but Stop-ScheduledTask hard-kills the
#      process (no SIGTERM), so we clean it here to avoid stale 127.0.0.1 names.
[CmdletBinding()]
param([string]$Domains)

# Best-effort throughout: a missing task / cert / hosts block must not fail the
# uninstall (the user just wants URLs off).
$ErrorActionPreference = 'SilentlyContinue'
$TaskName = 'EnvyDaemon'

Write-Host "-> Removing Envy daemon ($TaskName)"

Stop-ScheduledTask -TaskName $TaskName
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "  removed scheduled task"

# Untrust the local CA (matches CA_NAME / organizationName in tls.ts).
Get-ChildItem 'Cert:\LocalMachine\Root' |
  Where-Object { $_.Subject -match 'Envy Local CA' } |
  ForEach-Object { Remove-Item -LiteralPath $_.PSPath -Force }
Write-Host "  untrusted Envy Local CA"

# Strip the Envy-managed block from the hosts file (markers must match hosts.ts).
# Index-based removal mirroring hosts.ts: only strip a WELL-FORMED block (BEGIN
# with a matching END). If END is missing/malformed, leave the file untouched
# rather than swallow everything after BEGIN — and never write an empty file.
$hostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
if (Test-Path -LiteralPath $hostsPath) {
  $begin = '# BEGIN ENVY - managed block, do not edit'
  $end = '# END ENVY'
  $lines = @(Get-Content -LiteralPath $hostsPath)
  $bi = -1; $ei = -1
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -eq $begin) { $bi = $i; break } }
  if ($bi -ge 0) {
    for ($i = $bi + 1; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -eq $end) { $ei = $i; break } }
  }
  if ($bi -ge 0 -and $ei -ge 0) {
    $kept = @()
    if ($bi -gt 0) { $kept += $lines[0..($bi - 1)] }
    if ($ei -lt $lines.Count - 1) { $kept += $lines[($ei + 1)..($lines.Count - 1)] }
    # Safety: never blank a file that had content.
    if (($kept -join '').Trim().Length -gt 0 -or ($lines -join '').Trim().Length -eq 0) {
      Set-Content -LiteralPath $hostsPath -Value $kept -Encoding ASCII
      Write-Host "  cleaned hosts file"
    } else {
      Write-Warning "  skipped hosts cleanup (would have emptied the file)"
    }
  } else {
    Write-Host "  no Envy block in hosts file — left untouched"
  }
}

Write-Host "Envy URLs disabled."
