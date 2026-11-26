# Security

Please report vulnerabilities privately via GitHub Security Advisories
("Report a vulnerability" on the Security tab), not in public issues.

Design notes:
- The local settings page listens on 127.0.0.1 only and needs a random
  per-launch token (cookie + header), with a Host-header check.
- Modem passwords are stored only in the user's settings file (mode 600 on
  macOS/Linux) and are only sent to the modem itself.
- The community server stores hashed device ids, coarse areas, and (only for
  recovery watch during an outage) an AES-GCM-encrypted LOC ID that is deleted
  when the outage ends. Raw IPs are never stored.
- Driver PRs are always reviewed by a maintainer before release.
