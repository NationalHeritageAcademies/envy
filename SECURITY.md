# Security Policy

## Reporting a vulnerability

If you find a security issue in Envy — especially anything involving the
privileged background daemon (DNS + reverse proxy on ports 53/80/443), the
local certificate authority and trust-store installation, or the IPC surface
between renderer and main process — please **do not open a public issue**.

Instead, either:

- use GitHub's [private vulnerability reporting](https://github.com/MelodicDevelopment/envy/security/advisories/new), or
- email **support@melodic.dev** with the details.

Include steps to reproduce and what an attacker could gain. You'll get an
acknowledgment as soon as possible, and a fix will be released before any
public disclosure. Thanks for reporting responsibly.

## Supported versions

Only the latest release receives security fixes. Envy auto-updates, so
staying current is the default.
