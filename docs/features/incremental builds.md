---
title: Incremental Builds
---

Quartz now supports incremental builds by default.

## How it works

- Quartz stores build state in your output directory at:
  - `.quartz-build-state.json`
- Source file changes are detected using `mtime + size`.
- Unchanged content-page, folder-page, tag-page, alias, and OG-image outputs are skipped.
- On markdown deletion, Quartz removes known derived outputs immediately and conservatively rebuilds markdown pages to avoid stale link/backlink state.

## Force a full rebuild

Use:

```bash
npx quartz build --full-rebuild
```

This restores previous behavior by cleaning the output directory before emitting.

## CI behavior

When `CI` is set, Quartz defaults to `--full-rebuild`.

To opt into incremental behavior in CI:

```bash
QUARTZ_INCREMENTAL_CI=1 npx quartz build
```
