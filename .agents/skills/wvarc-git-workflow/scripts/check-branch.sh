#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "Branch check failed: not inside a Git repository." >&2
    exit 1
}

branch="${1:-$(git -C "$repo_root" branch --show-current)}"

if [[ -z "$branch" ]]; then
    echo "Branch check failed: detached HEAD cannot receive project commits." >&2
    exit 1
fi

if [[ "$branch" == "main" || "$branch" == "master" ]]; then
    echo "Branch check failed: $branch is protected. Create a typed working branch before committing." >&2
    exit 1
fi

branch_pattern='^(feature|fix|hotfix|chore|docs|refactor|test|build|ci|perf)/[a-z0-9]+(-[a-z0-9]+)*$'
release_pattern='^release/(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(alpha|beta)\.([1-9][0-9]*))?$'
if [[ ! "$branch" =~ $branch_pattern && ! "$branch" =~ $release_pattern ]]; then
    echo "Branch check failed: '$branch' must use an approved prefix with lowercase kebab-case, or release/<semver>." >&2
    echo "Approved prefixes: feature, fix, hotfix, chore, docs, refactor, test, build, ci, perf, release." >&2
    exit 1
fi

echo "Branch check passed: $branch"
