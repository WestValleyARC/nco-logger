---
name: wvarc-git-workflow
description: Enforce the WVARC NCO Logger Git workflow when creating or switching branches, making commits, pushing work, or opening pull requests. Always keep protected main commit-free, use typed branch names, and integrate through GitHub pull requests created with gh.
---

# WVARC Git Workflow

`main` is protected. Never commit, amend, cherry-pick, merge, or push changes directly on `main` (or `master` if encountered). Every repository change reaches `main` through a reviewed pull request.

## Branches

Before the first commit, run [scripts/check-branch.sh](scripts/check-branch.sh). If the current branch is `main`, create an appropriately typed branch first. When starting clean work, fetch the remote and branch from `origin/main`. If the worktree is dirty or the current branch contains unrelated work, inspect it and preserve the contributor's changes; do not automatically stash, reset, rebase, or move commits.

Use lowercase kebab-case after one of these prefixes:

- `feature/` — user-visible capability; commits normally use `feat:`.
- `fix/` or `hotfix/` — defect correction; commits use `fix:`.
- `chore/` — maintenance without product behavior changes.
- `docs/`, `refactor/`, `test/`, `build/`, `ci/`, or `perf/` — matching focused work.
- `release/` — release preparation, normally `release/<version>` with `chore(release):` commits.

Use a specific short scope, optionally beginning with an existing issue number, such as `feature/123-net-reporting`. Do not invent an issue number. Check existing local and remote branches before choosing a name so multiple contributors do not collide.

## Commits

- Verify the branch before every commit; never rely on an earlier check after switching or rebasing.
- Keep commits cohesive and use Conventional Commit subjects matching the change: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`, or `perf:`.
- Run validation appropriate to the changed code and inspect the staged diff for secrets, generated-file drift, and unrelated contributor changes.
- Do not rewrite or force-push shared history unless the user explicitly authorizes it.

## Pull requests

Creating local commits does not by itself authorize a push or external PR. When the user requests publication, integration, a PR, or completion of the GitHub workflow:

1. Push only the typed branch, setting its upstream when needed.
2. Use the GitHub CLI and target this repository explicitly:

   ```bash
   gh pr create --repo WestValleyARC/nco-logger --base main --head <branch> --title "<conventional title>" --body-file <path>
   ```

   For a contributor fork, use the appropriate `<owner>:<branch>` head while keeping `WestValleyARC/nco-logger` and `main` as the target.
3. Include a concise summary and the exact validation performed. Return the PR URL.
4. Use `gh pr checks` to report CI state when requested or when completing a PR workflow.

Do not use direct pushes to `main`, GitHub web-form substitutes, or local merges into `main`. Do not merge or enable auto-merge unless the user explicitly requests it. If `gh` is unavailable, unauthenticated, or lacks repository access, stop before external mutation and report the blocker.
