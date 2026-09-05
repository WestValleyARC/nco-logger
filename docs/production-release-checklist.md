# Production release gate

Do not launch a public instance until every deployment-owned item below has an
organization-approved value. Repository CI cannot supply or approve these.

- [ ] `BASE_URL` is the canonical public HTTPS origin and TLS is active.
- [ ] `TRUST_PROXY` identifies only the deployed TLS proxy; `FORCE_HTTPS=true`.
- [ ] Cookie and magic-login secrets are unique generated values stored outside Git.
- [ ] Mongo root/application passwords and replica key are deployment secrets.
- [ ] The application port is loopback/private only and Mongo has no host port.
- [ ] SMTP and sender identity are configured and monitored.
- [ ] `NCO_BACKUP_S3_BUCKET` (or an equivalent reviewed off-host destination) is configured with encrypted transport/storage and least-privilege credentials.
- [ ] The 15-minute scheduler is monitored and a full database-plus-upload restore drill passes.
- [ ] Backup retention and storage capacity are approved by the organization.
- [ ] Organization-approved privacy, cookie, and terms documents replace the clearly marked templates.
- [ ] Container image vulnerability scanning passes in the deployment registry/release system.
- [ ] Pinned Node and Mongo base-image digests have been reviewed for current security updates; digest updates are made in both Dockerfiles and Compose together, then the full CI and recovery drill are rerun.

Container scanning remains a release control because this repository has no
selected registry, scanner policy, or vulnerability exception authority. CI
builds both images so the chosen deployment scanner can evaluate exactly what
will be released without granting GitHub Actions additional privileges.

The human-readable major-version tags document compatibility while the digest
pins make builds reproducible. Dependabot or the release owner must review base
image updates at least monthly and immediately for relevant security advisories.
