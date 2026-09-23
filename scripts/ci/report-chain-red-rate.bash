#!/usr/bin/env bash

# How often the ordered Owner chain goes red, counted the only way that is correct.
#
# Three filters make this question easy to answer wrongly, and all three have been used wrongly in
# the last two days:
#
#   `--status failure`      A chain job can fail inside a run whose own conclusion is `cancelled`,
#                           because a newer push supersedes the run after the job has already gone
#                           red. Two such runs exist in the 200 most recent at the time of writing,
#                           and filtering on the run's conclusion loses that class entirely.
#   `--event pull_request`  The chain runs on `schedule` too, and `main`'s own verdict comes from
#                           there. The 2026-09-22 entry-28 failure was a scheduled run; a listing
#                           of pull requests does not contain it.
#   a short window          A count with no window attached is not a rate. The same chain measured
#                           40% red on 09-21, 12% on 09-22 and 0% on 09-23, so any single number
#                           covering all three describes a state the repository was never in.
#
# So this reads every run in the window whatever its conclusion and whatever its event, asks each
# one what its chain job concluded, and never prints an aggregate without the per-day split beside
# it. Every number it prints carries the window it was measured over.

set -Eeuo pipefail

# This script asserts with bare commands in places, and a bare command that fails under `set -e`
# prints nothing at all. `-E` carries the trap into a function body.
trap 'echo "report-chain-red-rate.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

runs="${1:-200}"
chain_job="rd owner postgres (ubuntu-22.04)"

if ! command -v gh > /dev/null 2>&1; then
  echo "ERROR: gh is required to read workflow history." >&2
  exit 1
fi

if ! [[ "$runs" =~ ^[0-9]+$ ]] || [[ "$runs" -lt 1 ]]; then
  echo "ERROR: usage: report-chain-red-rate.bash [run-count]   (default 200)" >&2
  exit 1
fi

listing="$(mktemp)"
joined="$(mktemp)"
trap 'rm -f "$listing" "$joined"' EXIT

# No `--status`, no `--event`: both would drop a class of chain failure. See the header.
gh run list --workflow build.yml --limit "$runs" \
  --json databaseId,event,conclusion,createdAt,headBranch \
  -q '.[] | select(.conclusion != null)
      | "\(.databaseId)\t\(.event)\t\(.conclusion)\t\(.createdAt)\t\(.headBranch)"' > "$listing"

listed="$(grep -c '' "$listing" || true)"
if [[ "$listed" -eq 0 ]]; then
  echo "ERROR: no completed build.yml runs were returned." >&2
  echo "       That is the shape a broken query has, not the shape this repository has." >&2
  exit 1
fi

echo "reading the chain job's conclusion from $listed completed runs..." >&2
while IFS=$'\t' read -r id event run_conclusion created branch; do
  job_conclusion="$(gh run view "$id" --json jobs \
    -q ".jobs[] | select(.name == \"$chain_job\") | .conclusion" 2> /dev/null || true)"
  [[ -n "$job_conclusion" ]] || continue
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$id" "$event" "$run_conclusion" "$job_conclusion" "$created" "$branch" >> "$joined"
done < "$listing"

ran="$(grep -c '' "$joined" || true)"
if [[ "$ran" -eq 0 ]]; then
  echo "ERROR: none of the $listed runs carries a job named '$chain_job'." >&2
  echo "       Either the job was renamed or the query is wrong; a zero here is not a rate." >&2
  exit 1
fi

window_first="$(awk -F'\t' 'NR==1 || $5 < first { first = $5 } END { print first }' "$joined")"
window_last="$(awk -F'\t' '$5 > last { last = $5 } END { print last }' "$joined")"
red="$(awk -F'\t' '$4 == "failure"' "$joined" | grep -c '' || true)"

printf '\nwindow   %s -> %s\n' "${window_first:0:16}" "${window_last:0:16}"
printf 'runs     %s listed, %s ran the chain\n' "$listed" "$ran"
printf 'criterion  the chain job'"'"'s own conclusion, every event, every run conclusion\n\n'

printf 'run conclusion / chain job conclusion\n'
awk -F'\t' '{ print "  " $3 " / " $4 }' "$joined" | sort | uniq -c | sort -rn
hidden="$(awk -F'\t' '$3 == "cancelled" && $4 == "failure"' "$joined" | grep -c '' || true)"
printf '\n  %s of the %s chain failures sit in a run whose own conclusion is not "failure".\n' \
  "$hidden" "$red"
printf '  Filtering on the run conclusion would report %s instead of %s.\n' "$((red - hidden))" "$red"

# The per-day split is printed unconditionally, next to the aggregate and never instead of it: the
# aggregate is an average over whatever regimes the window happens to span.
printf '\nby day\n'
awk -F'\t' '{ day = substr($5, 1, 10); total[day]++; if ($4 == "failure") fail[day]++ }
  END { for (d in total) printf "  %s  red %3d / ran %3d  %5.1f%%\n", d, fail[d] + 0, total[d], (fail[d] + 0) * 100 / total[d] }' \
  "$joined" | sort

printf '\nby branch, failures only (repeats on one branch are one problem, not several)\n'
awk -F'\t' '$4 == "failure" { print "  " $6 }' "$joined" | sort | uniq -c | sort -rn
distinct="$(awk -F'\t' '$4 == "failure" { print $6 }' "$joined" | sort -u | grep -c '' || true)"
printf '\n  %s failures across %s distinct branches.\n' "$red" "$distinct"

printf '\naggregate  %s / %s = %.1f%% - read the per-day split above before quoting this.\n' \
  "$red" "$ran" "$((red * 1000 / ran))e-1"
