#!/usr/bin/env bash
#
# Envy macOS setup — wires the OS up to resolve *.envy.local through Envy's
# local DNS server, and trusts Envy's local CA so HTTPS shows a green lock.
#
# OrbStack-safety: this script ONLY ever creates /etc/resolver/<tld> for Envy's
# own TLD and adds a CA named "Envy Local CA". It never reads, writes, or
# removes anything belonging to OrbStack (orb.local, its resolver, its certs).
#
# Usage:
#   sudo ./scripts/setup-macos.sh            # install
#   sudo ./scripts/setup-macos.sh --uninstall
#
# Honors: ENVY_DOMAINS (comma list, default envy.local), ENVY_DNS_PORT (15353),
#         ENVY_CA (default ~/Library/Application Support/Envy/ca/envy-ca.crt)
#
# If ENVY_DOMAINS is unset, the domains are read from the engine's config.json
# so this stays in sync with `envy domains add ...`.

set -euo pipefail

DNS_PORT="${ENVY_DNS_PORT:-15353}"

# Resolve the invoking user's home even under sudo, so we find the CA the
# engine generated in the *user's* data dir (not root's).
REAL_USER="${SUDO_USER:-$(whoami)}"
REAL_HOME="$(dscl . -read "/Users/${REAL_USER}" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
REAL_HOME="${REAL_HOME:-$HOME}"
CA_CERT="${ENVY_CA:-${REAL_HOME}/Library/Application Support/Envy/ca/envy-ca.crt}"
CONFIG_JSON="${REAL_HOME}/Library/Application Support/Envy/config.json"

SYSTEM_KEYCHAIN="/Library/Keychains/System.keychain"
CA_NAME="Envy Local CA"

# Build the domain list: ENVY_DOMAINS (comma) wins; otherwise read the engine's
# config.json; otherwise fall back to the default. Keeps the resolver files in
# sync with `envy domains add ...`.
resolve_domains() {
  if [[ -n "${ENVY_DOMAINS:-}" ]]; then
    echo "${ENVY_DOMAINS//,/ }"
  elif [[ -f "${CONFIG_JSON}" ]] && command -v node >/dev/null 2>&1; then
    node -e 'try{const c=require(process.argv[1]);process.stdout.write((c.domains||["envy.local"]).join(" "))}catch{process.stdout.write("envy.local")}' "${CONFIG_JSON}"
  else
    echo "envy.local"
  fi
}
read -r -a DOMAINS <<< "$(resolve_domains)"

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "This script needs root to edit /etc/resolver and the System keychain." >&2
    echo "Re-run:  sudo $0 $*" >&2
    exit 1
  fi
}

install() {
  require_root "$@"

  echo "→ Pointing ${DOMAINS[*]/#/*.} at Envy's DNS (127.0.0.1:${DNS_PORT})"
  mkdir -p /etc/resolver
  for domain in "${DOMAINS[@]}"; do
    # One resolver file per domain, each scoped to that domain alone — does not
    # affect .local mDNS or any other domain. The `port` line keeps DNS on an
    # unprivileged port.
    cat > "/etc/resolver/${domain}" <<EOF
# Managed by Envy. Routes *.${domain} to Envy's local DNS server.
nameserver 127.0.0.1
port ${DNS_PORT}
EOF
    echo "  wrote /etc/resolver/${domain}"
  done

  if [[ -f "${CA_CERT}" ]]; then
    echo "→ Trusting Envy's local CA in the System keychain"
    security add-trusted-cert -d -r trustRoot -k "${SYSTEM_KEYCHAIN}" "${CA_CERT}"
    echo "  trusted ${CA_CERT}"
  else
    echo "! CA not found at ${CA_CERT}" >&2
    echo "  Start the engine once (it generates the CA), then re-run this script." >&2
  fi

  echo
  echo "Done. Try a running container at https://<name>.${DOMAINS[0]}"
}

uninstall() {
  require_root "$@"

  for domain in "${DOMAINS[@]}"; do
    if [[ -f "/etc/resolver/${domain}" ]]; then
      rm -f "/etc/resolver/${domain}"
      echo "  removed /etc/resolver/${domain}"
    fi
  done

  # Remove only our CA, matched by its exact common name.
  if security find-certificate -c "${CA_NAME}" "${SYSTEM_KEYCHAIN}" >/dev/null 2>&1; then
    security delete-certificate -c "${CA_NAME}" "${SYSTEM_KEYCHAIN}" || true
    echo "  removed '${CA_NAME}' from System keychain"
  fi

  echo "Envy DNS/CA configuration removed. OrbStack and everything else untouched."
}

case "${1:-}" in
  --uninstall|-u) uninstall "$@" ;;
  *) install "$@" ;;
esac
