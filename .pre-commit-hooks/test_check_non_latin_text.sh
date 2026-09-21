#!/usr/bin/env bash

# The hook this tests once used a bare `perl -C`, which leaves the decoding of input to the
# locale. With LANG and LC_ALL unset - how an agent's shell usually runs - it read files as bytes,
# no byte fell in the blocked ranges, and CJK passed silently; in a developer's terminal, which
# normally sets LANG, the same tree failed. Two machines, opposite verdicts, no error either way.
#
# So this does not only check that each script is rejected. It runs every case under several
# locales and requires the verdict to be identical, which is the property that was missing.

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
HOOK="$REPO_ROOT/.pre-commit-hooks/check_non_latin_text.sh"

CASE_ROOT=$(mktemp -d)
trap 'rm -rf "$CASE_ROOT"' EXIT

# Every environment the hook must agree in. The first two are the ones a bare `-C` got wrong.
LOCALES=("" "LC_ALL=C" "LC_ALL=C.UTF-8")

write_codepoint() {
  local path="$1"
  local codepoint="$2"

  mkdir -p "$(dirname "$path")"
  perl -CSDA -e 'print "comment ", chr(hex($ARGV[0])), "\n"' "$codepoint" > "$path"
}

# Runs the hook with every locale variable cleared, then with `$1` set, so a locale inherited from
# the caller cannot decide the result.
run_hook_in() {
  local locale="$1" case_dir="$2" file="$3"
  if [[ -z "$locale" ]]; then
    (cd "$case_dir" && env -u LANG -u LC_ALL -u LC_CTYPE -u PERL_UNICODE \
      bash "$HOOK" "$file") > "$case_dir/out.txt" 2>&1
  else
    (cd "$case_dir" && env -u LANG -u LC_ALL -u LC_CTYPE -u PERL_UNICODE "$locale" \
      bash "$HOOK" "$file") > "$case_dir/out.txt" 2>&1
  fi
}

expect_in_every_locale() {
  local want="$1" case_dir="$2" file="$3" name="$4"
  local locale status
  for locale in "${LOCALES[@]}"; do
    status=0
    run_hook_in "$locale" "$case_dir" "$file" || status=$?
    if [[ "$want" == reject && "$status" -eq 0 ]]; then
      echo "check non-Latin text accepted $name under [${locale:-no locale set}]." >&2
      echo "A bare 'perl -C' does this: it decodes by locale, so the verdict follows the" >&2
      echo "environment rather than the file. The hook must use -CSD." >&2
      exit 1
    fi
    if [[ "$want" == accept && "$status" -ne 0 ]]; then
      echo "check non-Latin text rejected $name under [${locale:-no locale set}]:" >&2
      cat "$case_dir/out.txt" >&2
      exit 1
    fi
  done
}

while IFS='|' read -r codepoint name; do
  case_dir="$CASE_ROOT/reject-$codepoint"
  write_codepoint "$case_dir/sample.py" "$codepoint"
  expect_in_every_locale reject "$case_dir" "sample.py" "$name"
done << 'CASES'
4E2D|U+4E2D CJK
3042|U+3042 HIRAGANA
30A2|U+30A2 KATAKANA
AC00|U+AC00 HANGUL
0416|U+0416 CYRILLIC
0628|U+0628 ARABIC
CASES

ascii_dir="$CASE_ROOT/accept-ascii"
mkdir -p "$ascii_dir"
printf '# plain ASCII comment\nvalue = 1\n' > "$ascii_dir/sample.py"
expect_in_every_locale accept "$ascii_dir" "sample.py" "an ASCII-only file"

echo "ok: non-Latin scripts rejected and ASCII accepted, identically in ${#LOCALES[@]} locales"
