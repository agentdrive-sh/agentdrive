#!/usr/bin/env bash
# Runs CI for one exact commit in a throwaway worktree and posts each job as a GitHub commit status.
#   scripts/ci.sh                         the local HEAD commit
#   scripts/ci.sh --ref <ref>             any commit
#   scripts/ci.sh --pr <n>                a pull request: tests its head merged locally into the base tip, posts on the head
# --repo <owner/name> picks the GitHub repo (default: the one gh resolves from this checkout's remotes).
# On agentdrive-sh/agentdrive, only --pr runs post statuses, since only they pass the trust and CLA checks.
# --merge (with --pr) squash-merges the PR once every job passes and neither its head nor the base tip has moved.
# --reviewed-untrusted runs a PR whose code you did not write; read the diff first, it runs on this machine.
# --dry-run prints what would run and be posted, without running jobs or posting.
set -euo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_COMMON_DIR GIT_NAMESPACE

PUBLIC_REPO=agentdrive-sh/agentdrive
GITHUB_URL=${CI_GITHUB_URL:-https://github.com}
CLA_SENTENCE="I have read the CLA Document and I hereby sign the CLA"
CLA_FILE=signatures/v1/cla.json
CLA_BRANCH=cla-signatures
CLA_ALLOWLIST=" dependabot[bot] rakesh1002 "

JOB_NAMES=(Typecheck Test Build "Verify claims" "Browser regressions" "Production dependency audit")
# macOS has no apt, which --with-deps uses to install system libraries.
with_deps=" --with-deps"
[ "$(uname -s)" = Darwin ] && with_deps=
JOB_CMDS=(
  "pnpm install --frozen-lockfile && pnpm typecheck"
  "pnpm test; bash scripts/ci.test.sh; [ ! -e scripts/deploy.test.sh ] || bash scripts/deploy.test.sh; if [ ! -e scripts/public-sync.test.sh ]; then :; elif command -v gitleaks >/dev/null; then bash scripts/public-sync.test.sh; else echo 'skipping scripts/public-sync.test.sh: gitleaks is not on PATH'; fi"
  "pnpm build && pnpm --filter @agentdrive/web exec opennextjs-cloudflare build"
  "pnpm verify-claims"
  "pnpm --filter @agentdrive/shared build && pnpm --filter @agentdrive/web exec playwright install$with_deps chromium && pnpm test:e2e"
  "pnpm audit --prod --audit-level high"
)

usage() {
  echo "usage: scripts/ci.sh [--ref <ref> | --pr <n>] [--repo <owner/name>] [--merge] [--reviewed-untrusted] [--dry-run]" >&2
  exit 2
}
ref=HEAD pr='' repo='' merge=false trusted=false dry_run=false
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) [ $# -ge 2 ] || usage; ref=$2; shift ;;
    --pr) [ $# -ge 2 ] && [[ $2 =~ ^[0-9]+$ ]] || usage; pr=$2; shift ;;
    --repo) [ $# -ge 2 ] && [[ $2 =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || usage; repo=${2%.git}; shift ;;
    --merge) merge=true ;;
    --reviewed-untrusted) trusted=true ;;
    --dry-run) dry_run=true ;;
    *) usage ;;
  esac
  shift
done
if $merge && [ -z "$pr" ]; then usage; fi
if [ -n "$pr" ] && [ "$ref" != HEAD ]; then usage; fi

cd "$(git rev-parse --show-toplevel)"
lower() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
[ -n "$repo" ] || repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)
[ -n "$repo" ] || [ -z "$pr" ] || { echo "--pr needs --repo, or a GitHub remote gh can resolve." >&2; exit 2; }
# GitHub resolves any case of a name, and an old name, to the same repo, so compare the name it reports.
if [ -n "$repo" ]; then
  # On an error gh prints GitHub's error body to stdout, so only a clean owner/name replaces the given one.
  if canonical=$(gh api "repos/$repo" --jq .full_name 2>/dev/null) && [[ $canonical =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
    repo=$canonical
  fi
fi
is_public=false
[ "$(lower "$repo")" != "$(lower "$PUBLIC_REPO")" ] || is_public=true

post=true
if [ -z "$pr" ] && { [ -z "$repo" ] || $is_public; }; then
  post=false
  echo "note: running without posting statuses (${repo:-no GitHub repo found}; $PUBLIC_REPO takes them only from --pr runs)."
fi
post_status() {
  local sha=$1 context=$2 state=$3 description=$4
  $post || return 0
  if $dry_run; then
    printf 'would post  %-30s %-16s %s\n' "$context" "$state" "$description"
    return
  fi
  # A contributor running this has no write access to statuses; the run itself still tells them the result.
  gh api -X POST "repos/$repo/statuses/$sha" -f state="$state" -f context="$context" -f description="${description:0:140}" >/dev/null ||
    echo "warning: could not post the '$context' status to $repo" >&2
}

if [ -n "$pr" ]; then
  me=$(gh api user --jq .login)
  me=$(lower "$me")
  info=$(gh pr view "$pr" --repo "$repo" --json headRefOid,baseRefName,author,state,isCrossRepository \
    --jq '"\(.headRefOid) \(.baseRefName) \(.author.login) \(.state) \(.isCrossRepository)"')
  read -r head base_name author state cross <<<"$info"
  # gh names an app author app/<name>; its commits and the allowlist use the <name>[bot] login.
  if [[ $author == app/* ]]; then author="${author#app/}[bot]"; fi
  [ "$state" = OPEN ] || { echo "PR #$pr on $repo is $state." >&2; exit 1; }
  if ! $trusted && { $is_public || [ "$(lower "$author")" != "$me" ] || [ "$cross" != false ]; }; then
    echo "Refusing to run PR #$pr on $repo (author: $author) without --reviewed-untrusted." >&2
    echo "CI runs the PR's install scripts, tests and build on this machine, with your gh, npm and Cloudflare credentials in reach." >&2
    echo "Every public-repo PR, every PR from a fork and every PR you did not write is untrusted. Read the whole diff," >&2
    echo "including package.json, lockfile, config and test changes, then rerun with --reviewed-untrusted." >&2
    exit 1
  fi
  url="$GITHUB_URL/$repo.git"
  git fetch -q "$url" "pull/$pr/head"
  sha=$(git rev-parse FETCH_HEAD)
  [ "$sha" = "$head" ] || { echo "PR #$pr head moved while fetching ($head on GitHub, $sha fetched); rerun." >&2; exit 1; }
  # GitHub's baseRefOid and pull/<n>/merge can both lag the base branch by days, so the base tip comes from the
  # branch itself and the merge is made here.
  git fetch -q "$url" "refs/heads/$base_name"
  base=$(git rev-parse FETCH_HEAD)
  if ! tree=$(git merge-tree --write-tree --name-only "$base" "$sha"); then
    echo "Refusing to run PR #$pr: it conflicts with $base_name at ${base:0:12}. Conflicting files:" >&2
    tail -n +2 <<<"$tree" | sed '/^$/,$d; s/^/  /' >&2
    echo "Merge or rebase $base_name into it, push, and rerun." >&2
    exit 1
  fi
  test_sha=$(GIT_AUTHOR_NAME=ci.sh GIT_AUTHOR_EMAIL=ci@localhost GIT_COMMITTER_NAME=ci.sh GIT_COMMITTER_EMAIL=ci@localhost \
    git commit-tree "$(head -1 <<<"$tree")" -p "$base" -p "$sha" -m "Merge PR #$pr into $base_name")
  echo "Testing PR #$pr merged into $base_name at $base: $test_sha"
  target="PR #$pr on $repo"
else
  sha=$(git rev-parse --verify "$ref^{commit}")
  test_sha=$sha
  target="$ref${repo:+ on $repo}"
fi
echo "CI for $target at $sha"

cla_ok=true
if [ -n "$pr" ] && $is_public; then
  if cla_json=$(gh api "repos/$repo/contents/$CLA_FILE?ref=$CLA_BRANCH" 2>/dev/null); then
    cla_sha=$(jq -r .sha <<<"$cla_json")
    signatures=$(jq -r .content <<<"$cla_json" | tr -d '\n' | base64 -d)
  elif jq -e '.status == "404"' <<<"$cla_json" >/dev/null 2>&1; then
    cla_sha='' signatures='{"signedContributors":[]}'
  else
    echo "Could not read $CLA_FILE on $CLA_BRANCH: $cla_json" >&2
    exit 1
  fi
  signed=" $(jq -r '.signedContributors[].name' <<<"$signatures" | tr '[:upper:]' '[:lower:]' | tr '\n' ' ') "
  commits=$(gh api --paginate "repos/$repo/pulls/$pr/commits" | jq -s 'add // []')
  [ "$(jq -r '.[-1].sha' <<<"$commits")" = "$sha" ] ||
    { echo "PR #$pr's commit list does not end at $sha: its head moved, or it has more than 250 commits (the API's cap)." >&2; exit 1; }
  # The PR author signs too, since commits can carry someone else's login. A commit whose email is not linked to a
  # GitHub account has no login that could sign.
  authors=$({ jq -r '.[] | .author.login // "unlinked:\(.commit.author.name)"' <<<"$commits"; echo "$author"; } | sort -fu)
  # An edited comment could have said anything when it was first posted, so only unedited ones sign.
  comments=$(gh api --paginate "repos/$repo/issues/$pr/comments" | jq -c --arg s "$CLA_SENTENCE" \
    '.[] | select(.updated_at == .created_at and (.body | gsub("^\\s+|\\s+$"; "")) == $s) | {name: .user.login, id: .user.id, comment_id: .id, created_at}')
  unsigned=() new_signers=()
  while IFS= read -r login; do
    [ -n "$login" ] || continue
    l=$(lower "$login")
    [[ $CLA_ALLOWLIST == *" $l "* || $signed == *" $l "* ]] && continue
    entry=$(jq -c --arg l "$l" 'select((.name | ascii_downcase) == $l)' <<<"$comments" | head -1)
    if [ -n "$entry" ]; then new_signers+=("$entry"); else unsigned+=("$login"); fi
  done <<<"$authors"
  if [ ${#new_signers[@]} -gt 0 ]; then
    names=$(printf '%s\n' "${new_signers[@]}" | jq -r .name | paste -sd, -)
    if $dry_run; then
      echo "would record CLA signature(s) for $names in $CLA_FILE on $CLA_BRANCH"
    else
      repo_id=$(gh api "repos/$repo" --jq .id)
      # The entry shape contributor-assistant/github-action writes, so every signature stays in one list.
      updated=$(printf '%s\n' "${new_signers[@]}" | jq -s --argjson base "$signatures" --argjson repoId "$repo_id" --argjson pr "$pr" \
        '. as $new | $base | .signedContributors += [$new[] | . + {repoId: $repoId, pullRequestNo: $pr}]')
      args=(-X PUT "repos/$repo/contents/$CLA_FILE" -f branch="$CLA_BRANCH" -f message="Record CLA signature: $names (PR #$pr)"
        -f content="$(printf '%s\n' "$updated" | base64 | tr -d '\n')")
      [ -z "$cla_sha" ] || args+=(-f sha="$cla_sha")
      gh api "${args[@]}" >/dev/null
      echo "Recorded CLA signature(s) for $names."
    fi
  fi
  if [ ${#unsigned[@]} -eq 0 ]; then
    post_status "$sha" cla success "All commit authors have signed the CLA (checked locally)"
  else
    cla_ok=false
    post_status "$sha" cla failure "CLA not signed by: $(IFS=,; echo "${unsigned[*]}")"
  fi
fi

if $dry_run; then
  for i in "${!JOB_NAMES[@]}"; do
    printf 'would run   %-30s %s\n' "${JOB_NAMES[$i]}" "${JOB_CMDS[$i]}"
    post_status "$sha" "${JOB_NAMES[$i]}" "success|failure" "Ran locally: passed|failed in <n>s"
  done
  if $merge && $cla_ok; then
    echo "would run   gh pr merge $pr --repo $repo --squash --match-head-commit $sha  (only if all six jobs pass)"
  elif $merge; then
    echo "would not merge PR #$pr: the cla check fails"
  fi
  exit 0
fi

log_dir=${CI_LOG_DIR:-${TMPDIR:-/tmp}/agentdrive-ci/${sha:0:12}}
mkdir -p "$log_dir"
wt=$(mktemp -d)
trap 'git worktree remove --force "$wt" 2>/dev/null; rm -rf "$wt"' EXIT
git worktree add -q --detach "$wt" "$test_sha"

want_node=$(jq -r '.engines.node // empty' "$wt/packages/cli/package.json" 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)
have_node=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)
[ -z "$want_node" ] || [ "$have_node" = "$want_node" ] ||
  echo "warning: this is Node $have_node; the repo declares Node $want_node (packages/cli engines), which the old GitHub CI ran." >&2

# The jobs used to run on GitHub runners, where CI=true changes how pnpm, turbo and Next behave.
export CI=true
# Turbo keeps a linked worktree's cache in the main checkout, where another checkout's results could replay as a pass.
export TURBO_CACHE_DIR="$wt/.turbo/cache"
results=()
failed=0
for i in "${!JOB_NAMES[@]}"; do
  name=${JOB_NAMES[$i]}
  log="$log_dir/$(lower "${name// /-}").log"
  echo "== $name"
  start=$SECONDS
  if (cd "$wt" && bash -c "set -e; ${JOB_CMDS[$i]}") >"$log" 2>&1; then
    state=success verb=passed
  else
    state=failure verb=failed
    failed=$((failed + 1))
  fi
  took=$((SECONDS - start))
  results+=("$(printf '%-30s %-8s %5ss  %s' "$name" "$state" "$took" "$log")")
  post_status "$sha" "$name" "$state" "Ran locally: $verb in ${took}s"
done

echo
[ "$test_sha" = "$sha" ] || echo "Tested $test_sha (the merge of $sha into $base_name at $base); statuses are on $sha."
printf '%-30s %-8s %6s  %s\n' JOB STATE TIME LOG
printf '%s\n' "${results[@]}"
$cla_ok || echo "cla                            failure"

if [ $failed -gt 0 ] || ! $cla_ok; then
  if $merge; then echo "Not merging PR #$pr: CI did not pass." >&2; fi
  exit 1
fi
if $merge; then
  now_head=$(gh pr view "$pr" --repo "$repo" --json headRefOid --jq .headRefOid)
  now_base=$(git ls-remote "$url" "refs/heads/$base_name" | awk -v r="refs/heads/$base_name" '$2 == r { print $1 }')
  [ "$now_head" = "$sha" ] || { echo "Not merging PR #$pr: its head moved to $now_head after CI ran on $sha." >&2; exit 1; }
  [ "$now_base" = "$base" ] || { echo "Not merging PR #$pr: $base_name moved since CI ran ($base, now ${now_base:-gone}); re-run." >&2; exit 1; }
  gh pr merge "$pr" --repo "$repo" --squash --match-head-commit "$sha"
  echo "Merged PR #$pr."
fi
