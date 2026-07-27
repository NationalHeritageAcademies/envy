# Envy daemon installer (Windows) — the analogue of install-daemon.sh on macOS.
#
# Runs ONCE elevated (the GUI invokes it through a UAC prompt via sudo-prompt, so
# the user never opens a terminal). It does everything privileged in that single
# elevation:
#   1. Trusts Envy's local CA in the LocalMachine\Root store (green padlock).
#   2. Registers a Scheduled Task that runs the Envy engine (proxy on 80/443 +
#      hosts-file sync) at logon, with highest privileges, hidden.
#   3. Starts the task now, so URLs work without a logoff/logon.
#
# Why a Scheduled Task and not a Service: the elevated engine must reach the
# Docker named pipe in the user's session and write the user's hosts file, so it
# runs in the interactive user context with an admin token — not as SYSTEM.
#
# Why elevation at all on Windows (unlike the reason on macOS): binding 80/443
# needs NO elevation here — but editing %WINDIR%\System32\drivers\etc\hosts on
# every container change does, and so does trusting the CA. The persistent
# elevated task is what avoids a UAC prompt on every container start/stop.
#
# Args mirror install-daemon.sh (named here for clean quoting from the GUI).
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Runtime,   # absolute path to Envy.exe (run as Node)
  [Parameter(Mandatory)][string]$Daemon,    # absolute path to envyd.cjs
  [Parameter(Mandatory)][string]$DataDir,   # Envy data dir (CA + logs + config.json)
  [Parameter(Mandatory)][string]$Domains,   # comma-separated domains
  [Parameter(Mandatory)][int]$DnsPort,      # DNS port (high, unprivileged)
  [Parameter(Mandatory)][string]$CaCert,    # absolute path to the CA cert to trust
  [Parameter(Mandatory)][int]$HttpPort,     # proxy http port (80)
  [Parameter(Mandatory)][int]$HttpsPort     # proxy https port (443)
)

$ErrorActionPreference = 'Stop'
$TaskName = 'EnvyDaemon'

Write-Host "-> Installing Envy daemon ($TaskName)"

# 1. Trust the local CA in the machine Root store so HTTPS shows a green lock
#    for every *.envy host (the equivalent of the System keychain on macOS).
if (Test-Path -LiteralPath $CaCert) {
  Import-Certificate -FilePath $CaCert -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
  Write-Host "  trusted Envy Local CA (LocalMachine\Root)"
} else {
  Write-Warning "CA not found at $CaCert; skipping trust (HTTPS will warn)"
}

# 2. Windowless launcher (.vbs via wscript): sets the daemon's environment
#    (Envy.exe runs as Node via ELECTRON_RUN_AS_NODE) and launches it with NO
#    console window, WAITING on it so the scheduled task's lifetime tracks the
#    daemon's — stopping the task stops the engine. A cmd/.bat wrapper flashes a
#    visible console in the interactive session (and the daemon logs into it);
#    WScript.Shell.Run with window style 0 has no window at all. The daemon still
#    logs to <DataDir>\daemon.log. Domains are NOT baked in: the daemon reads
#    them from config.json and watches that file.
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
Remove-Item -LiteralPath (Join-Path $DataDir 'envyd-launch.cmd') -Force -ErrorAction SilentlyContinue
$launcher = Join-Path $DataDir 'envyd-launch.vbs'
$vbs = @"
Set sh = CreateObject("WScript.Shell")
Set env = sh.Environment("PROCESS")
env("ELECTRON_RUN_AS_NODE") = "1"
env("ENVY_DATA_DIR") = "$DataDir"
env("ENVY_DNS_PORT") = "$DnsPort"
env("ENVY_HTTP_PORT") = "$HttpPort"
env("ENVY_HTTPS_PORT") = "$HttpsPort"
sh.Run """$Runtime"" ""$Daemon""", 0, True
"@
Set-Content -LiteralPath $launcher -Value $vbs -Encoding ASCII
Write-Host "  wrote $launcher"

# 3. (Re)create the scheduled task: at logon, highest privileges, hidden.
$me = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $me -RunLevel Highest -LogonType Interactive
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Hidden `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "  registered scheduled task for $me"

# 4. Start it now so URLs work immediately (no logoff/logon needed).
Start-ScheduledTask -TaskName $TaskName
Write-Host "  daemon started"

$first = ($Domains -split ',')[0]
Write-Host "Envy is set up. Services will be reachable at https://<name>.$first"
