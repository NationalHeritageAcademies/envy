#!/usr/bin/env bash
#
# Envy daemon installer — runs ONCE as root (the GUI invokes it through the
# native macOS authorization dialog, so the end user never opens a terminal).
#
# It does everything privileged in a single elevation:
#   1. Installs the LaunchDaemon that runs the Envy engine (DNS + proxy on
#      80/443) at boot and keeps it alive.
#   2. Writes /etc/resolver/<domain> for each domain.
#   3. Trusts Envy's local CA in the System keychain.
#   4. Loads the daemon + flushes DNS.
#
# OrbStack-safety: only ever creates Envy's own LaunchDaemon, Envy's domains,
# and a CA named "Envy Local CA". Never touches orb.local or OrbStack.
#
# Args (positional, passed by the GUI):
#   1 RUNTIME    absolute path to the node-compatible runtime (Electron binary)
#   2 DAEMON     absolute path to envyd.cjs
#   3 DATA_DIR   Envy data dir (CA + logs live here)
#   4 DOMAINS    comma-separated domains
#   5 DNS_PORT   DNS port
#   6 CA_CERT    absolute path to the CA cert to trust
#   7 HTTP_PORT  proxy http port (80)
#   8 HTTPS_PORT proxy https port (443)

set -euo pipefail

RUNTIME="$1"
DAEMON="$2"
DATA_DIR="$3"
DOMAINS_CSV="$4"
DNS_PORT="$5"
CA_CERT="$6"
HTTP_PORT="$7"
HTTPS_PORT="$8"

LABEL="com.melodicdev.envy"
PLIST="/Library/LaunchDaemons/${LABEL}.plist"
# Must match electron-builder appId. Lets macOS attribute the background item to
# Envy (name + icon) in Login Items & Extensions instead of falling back to the
# signing certificate's name.
BUNDLE_ID="dev.melodic.envy"
SYSTEM_KEYCHAIN="/Library/Keychains/System.keychain"
CA_NAME="Envy Local CA"

IFS=',' read -r -a DOMAINS <<< "${DOMAINS_CSV}"

echo "→ Installing Envy LaunchDaemon (${LABEL})"

# Tear down any previous instance so this is idempotent.
launchctl bootout "system/${LABEL}" 2>/dev/null || true

cat > "${PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>AssociatedBundleIdentifiers</key>
  <array>
    <string>${BUNDLE_ID}</string>
  </array>
  <key>ProgramArguments</key>
  <array>
    <string>${RUNTIME}</string>
    <string>${DAEMON}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ELECTRON_RUN_AS_NODE</key>
    <string>1</string>
    <key>ENVY_DATA_DIR</key>
    <string>${DATA_DIR}</string>
    <!-- Domains are intentionally NOT baked in here: the daemon reads them from
         config.json and watches that file, so adding/removing a domain or
         reassigning a container propagates live without reinstalling. -->
    <key>ENVY_DNS_PORT</key>
    <string>${DNS_PORT}</string>
    <key>ENVY_HTTP_PORT</key>
    <string>${HTTP_PORT}</string>
    <key>ENVY_HTTPS_PORT</key>
    <string>${HTTPS_PORT}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${DATA_DIR}/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${DATA_DIR}/launchd.err.log</string>
</dict>
</plist>
EOF

chown root:wheel "${PLIST}"
chmod 0644 "${PLIST}"
echo "  wrote ${PLIST}"

# Trust the local CA HERE, during this elevation — not in the daemon. Writing
# System-keychain trust settings calls SecTrustSettingsSetTrustSettings, which
# needs an interactive authorization context. This script runs via the GUI's
# sudo-prompt (the user's Aqua session), so the prompt can be satisfied; a
# launchd daemon has no UI session and would fail with "authorization denied
# since no user interaction was possible". The root CA is stable for the life of
# the install, so this one-time trust covers every domain (existing and future).
if [ -f "${CA_CERT}" ]; then
  echo "→ Trusting Envy's local CA in the System keychain"
  if security add-trusted-cert -d -r trustRoot -k "${SYSTEM_KEYCHAIN}" "${CA_CERT}"; then
    echo "  trusted ${CA_NAME}"
  else
    echo "  ! CA trust failed — HTTPS will warn until '${CA_NAME}' is trusted" >&2
  fi
else
  echo "  ! CA not found at ${CA_CERT}; skipping trust (HTTPS will warn)" >&2
fi

# Boot the daemon now (and at every startup henceforth). The daemon, running as
# a real root process, writes the /etc/resolver/<domain> files itself (and keeps
# them in sync as domains change) — which, together with the CA trust above, is
# why the user only ever sees THIS single prompt.
launchctl bootstrap system "${PLIST}"
launchctl enable "system/${LABEL}"
echo "  daemon loaded"

echo "Envy is set up. Services will be reachable at https://<name>.${DOMAINS[0]}"
