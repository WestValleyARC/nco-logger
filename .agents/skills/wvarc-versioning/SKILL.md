---
name: wvarc-versioning
description: Update and verify WVARC NCO Logger release versions across package metadata, UI labels, cache keys, and generated browser artifacts. Use for alpha, beta, or stable application version bumps and version-drift checks; do not use for dependency, API, protocol, schema, QRZ, or imported-plugin versions.
---

# WVARC Versioning

Treat `package.json` as the canonical application version. Keep these derived markers synchronized:

- the root package and root package-lock versions;
- the NCO Logger version shown in the live-net UI;
- the live-net module and stylesheet cache-key plumbing (derived from the deployed asset fingerprint);
- generated files under `client/dist/`.

Use [scripts/set-version.mjs](scripts/set-version.mjs) to set or check the version. Run it from any directory inside the repository:

```bash
node .agents/skills/wvarc-versioning/scripts/set-version.mjs 1.1.0-alpha.2
node .agents/skills/wvarc-versioning/scripts/set-version.mjs --check
```

If Node is only available through the project container, run the same script through the repository's Node Docker image.

## Version policy

- Prereleases use `MAJOR.MINOR.PATCH-alpha.N`, followed by `MAJOR.MINOR.PATCH-beta.N` when the release is feature-complete.
- Start each prerelease channel at `.1` and increment `N` for each build in that channel.
- Promote an unchanged release core from alpha to beta, then remove the suffix for the stable release.
- Stable releases use Semantic Versioning's `MAJOR.MINOR.PATCH` form. Here, `PATCH` is the project's “Fix” number.
- Do not add a Git tag, create a commit, push, or deploy unless the user requests that action.

Do not change unrelated version-like values: dependency versions, API `endpointVersion`, message/layout/schema versions, `qrz_version`, XML/SVG declarations, database migrations, or the temporary `chrome-plugin/` manifest. The plugin's `0.23.14` remains source provenance until that directory is removed.

## Release workflow

1. Inspect the working tree and preserve unrelated changes.
2. Set the requested version with `set-version.mjs`.
3. Run `npm run build` so tracked `client/dist/` artifacts inherit the version. Live-net cache keys
   remain derived from `server.appAssetVersion`; do not replace them with hard-coded release strings.
4. Run `set-version.mjs --check` to detect drift.
5. Run the project tests and inspect the final diff for unrelated version changes.
6. Report the version, validation results, and any intentionally untouched version markers.
