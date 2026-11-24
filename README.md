# hidden-spec-cli-20261124-resubmit

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/azkamahvin88/hidden-spec-cli-20261124-resubmit/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/azkamahvin88/hidden-spec-cli-20261124-resubmit/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend — one patch tool for every AI edit format: unified diff, SEARCH/REPLACE, V4A and JSON edits with three-tier matching, atomic all-or-nothing writes, and byte-exact output per SPEC.md.

## Run it

```sh
node main.ts [--format=NAME] [--check] [--strict] [PATCH]
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=d7ry1fct&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>

## What it does

`mend` applies an edit that an AI model wrote to a tree of text files. Models write edits
in four formats, and `mend` reads each one exactly as `SPEC.md` says — every file is
changed, or nothing is:

- **Unified diffs** — wrong line numbers tolerated (nearest occurrence wins), `---`/`+++`,
  `diff --git`, rename, create, delete and move sections, `\ No newline at end of file`,
  CRLF preservation.
- **SEARCH/REPLACE blocks** — path from the nearest non-blank line above the block, exact
  ambiguity detection (more than one occurrence at the first matching tier fails).
- **V4A patches** — Add / Delete / Update File sections, `*** Move to:`, anchored chunks
  with a moving cursor, end-of-file chunks.
- **JSON edits** — `create`, `str_replace` (exact, overlap-counted, CRLF-aware) and
  `insert` (line numbers 0..N), as one array or JSON Lines.

Matching runs at three tiers (exact, ignore trailing whitespace, ignore leading +
trailing whitespace with re-indent); `--strict` forces tier 0 only. `--check` dry-runs
with identical output and exit code. All edits apply in patch order to the tree as
earlier edits left it; any failed edit is reported and nothing is written (exit 1).
Exit 2 covers usage, unreadable patch, undetectable format and parse errors, each on
the exact line SPEC.md names.

## Verify it

```sh
node check.ts <kit>/program/generator/practice.json
# 100 of 100 passed: practice score 1000
```

Node 22, standard library only — no install, no network, no model calls. See `SPEC.md`
for the full contract (version 1).
