#!/usr/bin/env bash
#
# Envy daemon uninstaller — runs as root via the GUI's native auth dialog.
# Fully reverses install-daemon.sh and touches nothing else on the system.
#
# Args (positional):
#   1 DOMAINS  comma-separated domains whose resolver files to remove

set -euo pipefail

DOMAINS_CSV="${1:-envy.local}"
LABEL="com.nhaschools.envy"
# Melodic-era label. Uninstall has to clear it too, or "remove Envy" would
# leave a root daemon behind on any machine that upgraded from those builds.
LEGACY_LABEL="com.melodicdev.envy"
SYSTEM_KEYCHAIN="/Library/Keychains/System.keychain"
CA_NAME="Envy Local CA"

IFS=',' read -r -a DOMAINS <<< "${DOMAINS_CSV}"

echo "→ Removing Envy daemon"
for label in "${LABEL}" "${LEGACY_LABEL}"; do
  plist="/Library/LaunchDaemons/${label}.plist"
  launchctl bootout "system/${label}" 2>/dev/null || true
  if [[ -f "${plist}" ]]; then
    rm -f "${plist}"
    echo "  removed ${plist}"
  fi
done

for domain in "${DOMAINS[@]}"; do
  if [[ -f "/etc/resolver/${domain}" ]]; then
    rm -f "/etc/resolver/${domain}"
    echo "  removed /etc/resolver/${domain}"
  fi
done

if security find-certificate -c "${CA_NAME}" "${SYSTEM_KEYCHAIN}" >/dev/null 2>&1; then
  security delete-certificate -c "${CA_NAME}" "${SYSTEM_KEYCHAIN}" || true
  echo "  removed '${CA_NAME}' from System keychain"
fi

dscacheutil -flushcache || true
killall -HUP mDNSResponder || true
echo "Envy fully removed. OrbStack and everything else untouched."
