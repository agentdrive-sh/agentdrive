#!/usr/bin/env bash
# Runs scripts/ci.sh against a throwaway repo with gh and pnpm stubbed, so nothing reaches GitHub or runs a real build.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/ci.sh"
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
export GIT_AUTHOR_NAME=Owner GIT_AUTHOR_EMAIL=owner@example.invalid GIT_COMMITTER_NAME=Owner GIT_COMMITTER_EMAIL=owner@example.invalid
export FX="$t/fx" CI_GITHUB_URL="$t/github" CI_LOG_DIR="$t/logs"
PRIV=example/internal PUB=agentdrive-sh/agentdrive
mkdir -p "$t/bin" "$FX"
unset CI TURBO_CACHE_DIR

# gh: answers from fixture files in $FX and appends every call to $FX/gh.log.
# A second 'pr view' of PR n reads pr-n.later.json when it exists, to move the head after CI ran.
# 'api repos/<name>' reports the public repo's canonical name for any case of it or its old name. While $FX/offline
# exists it prints that file and exits 1, as gh prints an error body; while $FX/nameless exists it reports no name.
cat >"$t/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FX/gh.log"
filter='.' args=()
while [ $# -gt 0 ]; do
  case "$1" in --jq) filter=$2; shift 2 ;; --paginate) shift ;; *) args+=("$1"); shift ;; esac
done
set -- "${args[@]}"
out() { jq -r "$filter" "$1"; }
case "$1 $2" in
  "api user") echo '{"login":"Rakesh1002"}' >"$FX/user.json"; out "$FX/user.json" ;;
  "repo view") echo '{"nameWithOwner":"example/internal"}' >"$FX/repo-view.json"; out "$FX/repo-view.json" ;;
  "pr view")
    echo x >>"$FX/views-$3"
    if [ "$(wc -l <"$FX/views-$3")" -gt 1 ] && [ -f "$FX/pr-$3.later.json" ]; then out "$FX/pr-$3.later.json"; else out "$FX/pr-$3.json"; fi ;;
  "pr merge") ;;
  "api -X")
    if [ "$3" = PUT ]; then
      for a in "$@"; do case "$a" in content=*) printf '%s' "${a#content=}" | base64 -d >"$FX/cla-written.json" ;; esac; done
    fi ;;
  *)
    case "$2" in
      */contents/*)
        [ -f "$FX/cla.json" ] || { echo '{"message":"Not Found","status":"404"}'; exit 1; }
        jq -n --arg c "$(base64 <"$FX/cla.json")" '{sha: "blobsha", content: $c}' >"$FX/contents.json"
        out "$FX/contents.json" ;;
      */pulls/*/commits) out "$FX/commits.json" ;;
      */issues/*/comments) out "$FX/comments.json" ;;
      repos/*)
        if [ -e "$FX/offline" ]; then cat "$FX/offline"; exit 1; fi
        if [ -e "$FX/nameless" ]; then jq -r "$filter" <<<'{"id":42}'; exit 0; fi
        name=${2#repos/}
        case "$(tr '[:upper:]' '[:lower:]' <<<"$name")" in agentdrive-sh/agentdrive | agentdrive-sh/old-name) name=agentdrive-sh/agentdrive ;; esac
        jq -n --arg n "$name" '{id: 42, full_name: $n}' >"$FX/repo.json"
        out "$FX/repo.json" ;;
      *) echo "gh stub: unexpected call: $*" >&2; exit 1 ;;
    esac ;;
esac
EOF
# pnpm: records the commit it ran in, CI, whether turbo's cache is inside the worktree, and its arguments;
# runs $PNPM_ON_TEST on 'pnpm test', and fails when its arguments equal $PNPM_FAIL.
cat >"$t/bin/pnpm" <<'EOF'
#!/usr/bin/env bash
cache=cache-elsewhere
[ "${TURBO_CACHE_DIR:-}" != "$PWD/.turbo/cache" ] || cache=cache-in-worktree
echo "$(git rev-parse HEAD) CI=${CI:-} $cache $*" >>"$FX/pnpm.log"
if [ "$*" = test ] && [ -n "${PNPM_ON_TEST:-}" ]; then eval "$PNPM_ON_TEST"; fi
[ "$*" != "${PNPM_FAIL:-}" ]
EOF
printf '#!/bin/sh\n' >"$t/bin/gitleaks"
chmod +x "$t/bin/gh" "$t/bin/pnpm" "$t/bin/gitleaks"
# Only the stubs and the tools the scripts need, so a real gitleaks elsewhere on PATH cannot hide its absence.
for tool in bash git jq; do ln -s "$(command -v "$tool")" "$t/bin/$tool"; done
export PATH="$t/bin:/usr/bin:/bin"

git init -q -b main "$t/repo"
cd "$t/repo"
mkdir scripts && cp "$script" scripts/ci.sh
# Stand-ins for the shell suites the Test job runs, so this suite never runs itself inside the CI it tests.
for suite in ci deploy public-sync; do printf 'echo %s.test >>"$FX/suites.log"\n' "$suite" >"scripts/$suite.test.sh"; done
git add -A && git commit -qm base
base=$(git rev-parse HEAD)
git switch -q -c feature && echo feature >feature.txt && git add -A && git commit -qm feature
sha=$(git rev-parse HEAD)
git switch -q main && echo other >other.txt && git add -A && git commit -qm "main moved"
main=$(git rev-parse HEAD)
echo again >>other.txt && git commit -qam "main moved again"
main_later=$(git rev-parse HEAD)
git switch -q -c conflicting "$base" && echo different >other.txt && git add -A && git commit -qm "conflicts with main"
conflicting=$(git rev-parse HEAD)
git switch -q -c public-only "$base" && git rm -q scripts/deploy.test.sh scripts/public-sync.test.sh && git commit -qm "public export"
public_only=$(git rev-parse HEAD)
git switch -q main && git reset -q --hard "$base"
# The merge ref GitHub would have made when main was still $base; ci.sh must ignore it.
stale_merge=$(git commit-tree "$sha^{tree}" -p "$base" -p "$sha" -m "stale merge ref")
# The real main is $main, while every fixture reports the stale baseRefOid $base. PR 16 targets release/1.0 ($base)
# and PR 17 conflicts with main.
for r in $PRIV $PUB; do
  git init -q --bare "$t/github/$r.git"
  for n in 7 8 9 11 15 16; do git push -q "$t/github/$r.git" "$sha:refs/pull/$n/head" "$stale_merge:refs/pull/$n/merge"; done
  git push -q "$t/github/$r.git" "$main:refs/heads/main" "$base:refs/heads/release/1.0" "$conflicting:refs/pull/17/head"
done
pr_fixture() {
  jq -n --arg sha "$2" --arg who "$3" --arg state "${4:-OPEN}" --argjson cross "${5:-false}" --arg base "$base" --arg name "${6:-main}" \
    '{headRefOid: $sha, baseRefOid: $base, baseRefName: $name, author: {login: $who}, state: $state, isCrossRepository: $cross}' >"$FX/pr-$1.json"
}
pr_fixture 7 "$sha" Rakesh1002
pr_fixture 8 "$sha" someone
pr_fixture 9 "$sha" alice
pr_fixture 11 "$sha" Rakesh1002 OPEN true
pr_fixture 15 "$sha" app/dependabot
pr_fixture 16 "$sha" Rakesh1002 OPEN false release/1.0
pr_fixture 17 "$conflicting" Rakesh1002
reset() { rm -f "$FX"/*.log "$FX"/views-* "$FX/cla-written.json"; }
ci() { "$t/repo/scripts/ci.sh" "$@" >"$t/out" 2>&1; }
posted() { grep -c "statuses/$sha -f state=$1" "$FX/gh.log" || true; }
# The jobs ran on one commit whose parents are the given base tip and head, in that order.
ran_on_merge() {
  local tested
  tested=$(cut -d' ' -f1 "$FX/pnpm.log" | sort -u)
  [ "$(git rev-parse "$tested^1" "$tested^2" 2>/dev/null | paste -sd' ' -)" = "$1 $2" ]
}
commits() { jq -n --arg sha "$sha" --args '[$ARGS.positional[] | {sha: "older", author: {login: .}}] | .[-1].sha = $sha' "$@" >"$FX/commits.json"; }

reset
ci --dry-run --pr 7 --merge || fail "a dry run failed"
[ ! -e "$FX/pnpm.log" ] || fail "a dry run ran a job"
[ "$(posted success)$(posted failure)" = 00 ] || fail "a dry run posted a status"
grep -q "would run   gh pr merge 7 .*--match-head-commit $sha" "$t/out" || fail "a dry run did not show the merge"

reset
PNPM_FAIL=test ci --pr 7 --merge && fail "a failing job exited 0"
grep -q "statuses/$sha -f state=failure -f context=Test " "$FX/gh.log" || fail "the failing job did not post failure"
[ "$(posted success)" = 5 ] || fail "the other five jobs did not keep going and pass"
grep -q "pr merge" "$FX/gh.log" && fail "a failing run merged"
grep -q "Not merging PR #7" "$t/out" || fail "a failing run did not say why it did not merge"
ran_on_merge "$main" "$sha" || fail "jobs did not run on the head merged into the real main tip"
[ "$(git worktree list | wc -l | tr -d ' ')" = 1 ] || fail "the CI worktree was left behind"

reset
ci --pr 7 --merge || fail "an all-pass run exited non-zero: $(cat "$t/out")"
for c in Typecheck Test Build "Verify claims" "Browser regressions" "Production dependency audit"; do
  grep -qF "repos/$PRIV/statuses/$sha -f state=success -f context=$c -f description=Ran locally" "$FX/gh.log" || fail "no success status for $c on the head"
done
[ "$(posted success)" = 6 ] || fail "an all-pass run did not post exactly six successes"
grep -qx "pr merge 7 --repo $PRIV --squash --match-head-commit $sha" "$FX/gh.log" || fail "the merge did not pin the head commit"
grep -qE '^Production dependency audit +success' "$t/out" || fail "no summary table"
[ "$(cat "$FX/suites.log")" = "$(printf 'ci.test\ndeploy.test\npublic-sync.test')" ] || fail "the Test job did not run all three shell suites"

reset
rm "$t/bin/gitleaks"
ci --pr 7 || fail "a run without gitleaks failed: $(cat "$t/out")"
printf '#!/bin/sh\n' >"$t/bin/gitleaks" && chmod +x "$t/bin/gitleaks"
[ "$(cat "$FX/suites.log")" = "$(printf 'ci.test\ndeploy.test')" ] || fail "public-sync.test.sh ran without gitleaks, or another suite was skipped"
grep -q "skipping scripts/public-sync.test.sh: gitleaks is not on PATH" "$CI_LOG_DIR/test.log" || fail "skipping public-sync.test.sh was not noted"

reset
ci --ref "$public_only" || fail "a run of the public export failed: $(cat "$t/out")"
[ "$(cat "$FX/suites.log")" = ci.test ] || fail "the public export's Test job did not run ci.test.sh alone"

reset
PNPM_FAIL=test ci --ref "$public_only" && fail "a failing pnpm test passed because a later suite passed"
grep -qF "statuses/$public_only -f state=failure -f context=Test " "$FX/gh.log" || fail "a failing pnpm test did not fail the Test job"
[ "$(grep -cv " CI=true cache-in-worktree " "$FX/pnpm.log")" = 0 ] || fail "a job ran without CI=true or with turbo's cache outside the worktree"

reset
ci --pr 7 || fail "a PR whose GitHub base and merge ref are stale failed: $(cat "$t/out")"
ran_on_merge "$main" "$sha" || fail "a stale baseRefOid or merge ref was tested instead of the real main tip"
[ "$(cut -d' ' -f1 "$FX/pnpm.log" | sort -u)" != "$stale_merge" ] || fail "GitHub's stale merge ref was tested"
git cat-file -e "$(cut -d' ' -f1 "$FX/pnpm.log" | sort -u):other.txt" || fail "the tested tree does not hold the real main's changes"

reset
ci --pr 16 --merge || fail "a PR against release/1.0 failed: $(cat "$t/out")"
ran_on_merge "$base" "$sha" || fail "a PR against release/1.0 was not merged into that branch's tip"
grep -qx "pr merge 16 --repo $PRIV --squash --match-head-commit $sha" "$FX/gh.log" || fail "the release/1.0 merge did not pin the head"

reset
ci --pr 17 --merge && fail "ran a PR that conflicts with main"
grep -q "conflicts with main" "$t/out" || fail "a conflicting PR was not refused as conflicting"
grep -q "other.txt" "$t/out" || fail "the conflicting file was not named"
[ ! -e "$FX/pnpm.log" ] || fail "a conflicting PR ran a job"
grep -q "statuses/" "$FX/gh.log" && fail "a conflicting PR posted a status"

reset
PNPM_ON_TEST="git push -q '$t/github/$PRIV.git' '$main_later:refs/heads/main'" ci --pr 7 --merge &&
  fail "merged after the real main tip moved during the run"
git push -q "$t/github/$PRIV.git" "+$main:refs/heads/main"
grep -q "pr merge" "$FX/gh.log" && fail "called merge after the real main tip moved during the run"
grep -q "main moved since CI ran" "$t/out" || fail "the moved main tip was not reported"

reset
pr_fixture 7.later 0000000000000000000000000000000000000001 Rakesh1002
ci --pr 7 --merge && fail "merged after the head moved during the run"
grep -q "pr merge" "$FX/gh.log" && fail "called merge after the head moved during the run"
grep -q "head moved to 0000000000000000000000000000000000000001" "$t/out" || fail "the moved head was not reported"
rm "$FX/pr-7.later.json"

reset
pr_fixture 7 0000000000000000000000000000000000000000 Rakesh1002
ci --pr 7 && fail "ran a PR whose head moved while fetching"
pr_fixture 7 "$sha" Rakesh1002 MERGED
ci --pr 7 && fail "ran a merged PR"
grep -q "PR #7 on $PRIV is MERGED" "$t/out" || fail "a merged PR was not refused by state"
[ ! -e "$FX/pnpm.log" ] || fail "a moved or merged PR ran a job"
pr_fixture 7 "$sha" Rakesh1002

reset
commits Rakesh1002
echo '[]' >"$FX/comments.json"
ci --pr 8 && fail "ran another author's PR without --reviewed-untrusted"
grep -q -- "--reviewed-untrusted" "$t/out" || fail "the refusal did not say how to proceed"
grep -q "on this machine" "$t/out" || fail "the refusal did not say why"
ci --pr 7 --repo "$PUB" && fail "ran your own public-repo PR without --reviewed-untrusted"
grep -q "Refusing to run PR #7 on $PUB" "$t/out" || fail "your own public-repo PR was not refused as untrusted"
ci --pr 11 && fail "ran a PR from a fork without --reviewed-untrusted"
grep -q "Refusing to run PR #11" "$t/out" || fail "a PR from a fork was not refused as untrusted"
ci --pr 7 --repo agentdrive-sh/old-name --merge && fail "ran your own public-repo PR named by an old name"
grep -q "Refusing to run PR #7 on $PUB" "$t/out" || fail "a public-repo PR named by an old name was not refused"
echo '{"message":"Not Found","documentation_url":"https://docs.github.com/rest","status":"404"}' >"$FX/offline"
ci --pr 7 --repo AgentDrive-SH/AgentDrive --merge && fail "ran your own public-repo PR named in another case"
grep -q "Refusing to run PR #7 on AgentDrive-SH/AgentDrive" "$t/out" || fail "a public-repo PR named in another case was not refused"
rm "$FX/offline"
[ ! -e "$FX/pnpm.log" ] || fail "an untrusted PR ran a job"

reset
ci || fail "a HEAD run failed: $(cat "$t/out")"
grep -q "repos/$PRIV/statuses/$base -f state=success" "$FX/gh.log" || fail "a HEAD run did not post to the repo gh resolves"
reset
ci --repo "$PUB" || fail "a HEAD run against the public repo failed"
grep -qs "statuses/" "$FX/gh.log" && fail "a run that skipped the trust and CLA checks posted to the public repo"
grep -q "running without posting statuses" "$t/out" || fail "skipping the statuses was not explained"
for body in '{"message":"Not Found","documentation_url":"https://docs.github.com/rest","status":"404"}' \
  '{"message":"API rate limit exceeded for user ID 1.","documentation_url":"https://docs.github.com/rest","status":"403"}' \
  'example/elsewhere'; do
  reset
  echo "$body" >"$FX/offline"
  ci --ref "$sha" --repo AgentDrive-SH/AgentDrive || fail "a run against the public repo in another case failed"
  grep -qs "statuses/" "$FX/gh.log" && fail "a failed name lookup ($body) let a run post to the public repo"
  grep -q "running without posting statuses (AgentDrive-SH/AgentDrive;" "$t/out" || fail "a failed name lookup replaced the repo name: $(cat "$t/out")"
done
rm "$FX/offline"
reset
touch "$FX/nameless"
ci --ref "$sha" --repo AgentDrive-SH/AgentDrive || fail "a run whose name lookup returned no name failed"
rm "$FX/nameless"
grep -qs "statuses/" "$FX/gh.log" && fail "a name lookup that returned no name let a run post to the public repo"
reset
ci --ref "$sha" --repo agentdrive-sh/old-name || fail "a run against the public repo's old name failed"
grep -qs "statuses/" "$FX/gh.log" && fail "a run naming the public repo by an old name posted to it"

reset
rm -f "$FX/cla.json"
commits rakesh1002
echo '[]' >"$FX/comments.json"
ci --pr 9 --repo "$PUB" --reviewed-untrusted && fail "a PR whose author never signed passed on allowlisted commits"
grep -qF "context=cla -f description=CLA not signed by: alice" "$FX/gh.log" || fail "the unsigned PR author was not named"

reset
rm -f "$FX/cla.json"
commits alice rakesh1002
echo '[{"id":501,"body":"I have read the CLA Document and I hereby sign the CLA\n","user":{"login":"alice","id":11},"created_at":"2026-11-18T10:00:00Z","updated_at":"2026-11-18T10:00:00Z"}]' >"$FX/comments.json"
ci --pr 9 --repo "$PUB" --reviewed-untrusted || fail "a PR whose author signed by comment failed: $(cat "$t/out")"
[ "$(jq -c '.signedContributors' "$FX/cla-written.json")" = \
  '[{"name":"alice","id":11,"comment_id":501,"created_at":"2026-11-18T10:00:00Z","repoId":42,"pullRequestNo":9}]' ] ||
  fail "the signer was not recorded in the contributor-assistant shape: $(cat "$FX/cla-written.json")"
grep -q "contents/signatures/v1/cla.json -f branch=cla-signatures" "$FX/gh.log" || fail "the signature was not committed to cla-signatures"
grep -q "sha=" "$FX/gh.log" && fail "creating cla.json passed a blob sha"
grep -qF "statuses/$sha -f state=success -f context=cla " "$FX/gh.log" || fail "no cla success status"

cp "$FX/cla-written.json" "$FX/cla.json"
reset
commits Alice bob dave rros-sync erin
jq '.[0].author = null | .[0].commit = {author: {name: "Anon"}} | [{sha: "older", author: {login: "Alice"}}] + .' "$FX/commits.json" >"$FX/c.json" && mv "$FX/c.json" "$FX/commits.json"
cat >"$FX/comments.json" <<'EOF'
[{"id":601,"body":"I have read the CLA Document and I hereby sign the CLA","user":{"login":"mallory","id":13},"created_at":"2026-11-18T10:00:00Z","updated_at":"2026-11-18T10:00:00Z"},
 {"id":602,"body":"I have read the CLA document and I hereby sign the CLA.","user":{"login":"dave","id":14},"created_at":"2026-11-18T10:00:00Z","updated_at":"2026-11-18T10:00:00Z"},
 {"id":603,"body":"I have read the CLA Document and I hereby sign the CLA","user":{"login":"erin","id":15},"created_at":"2026-11-18T10:00:00Z","updated_at":"2026-11-18T11:00:00Z"}]
EOF
ci --dry-run --pr 9 --repo "$PUB" --reviewed-untrusted --merge || fail "a dry run with a failing CLA failed: $(cat "$t/out")"
grep -q "would not merge PR #9: the cla check fails" "$t/out" || fail "a dry run predicted a merge the CLA blocks"
grep -q "would run   gh pr merge" "$t/out" && fail "a dry run showed a merge the CLA blocks"
reset
ci --pr 9 --repo "$PUB" --reviewed-untrusted --merge && fail "a PR with unsigned authors passed"
grep -qF "statuses/$sha -f state=failure -f context=cla -f description=CLA not signed by: bob,dave,erin,rros-sync,unlinked:Anon" "$FX/gh.log" ||
  fail "the cla failure did not name exactly the unsigned authors: $(grep context=cla "$FX/gh.log")"
[ ! -e "$FX/cla-written.json" ] || fail "cla.json was rewritten with no valid new signer"
grep -q "pr merge" "$FX/gh.log" && fail "merged a PR that failed the CLA"

reset
commits alice
jq '.[-1].sha = "elsewhere"' "$FX/commits.json" >"$FX/c.json" && mv "$FX/c.json" "$FX/commits.json"
ci --pr 9 --repo "$PUB" --reviewed-untrusted && fail "checked the CLA on a commit list that does not end at the head"
grep -q "more than 250 commits" "$t/out" || fail "a truncated commit list was not explained"

reset
commits 'dependabot[bot]'
echo '[]' >"$FX/comments.json"
ci --pr 15 --repo "$PUB" --reviewed-untrusted || fail "a Dependabot PR failed: $(cat "$t/out")"
grep -qF "statuses/$sha -f state=success -f context=cla " "$FX/gh.log" || fail "a Dependabot PR, authored as app/dependabot, was not allowlisted"

echo "ci: all checks passed"
