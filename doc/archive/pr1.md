# PR 1 — fix(ui): move "add entry" button to toolbar

> 草稿，供提交时复制使用

## Title

```
fix(ui): move "add entry" button to entries toolbar
```

## Body

```markdown

## Summary

- Move the "add API key entry" button from the bottom of the entry card list to the `entriesToolbar` area, placing it alongside the "test all" button.
- Remove the standalone bottom `addBtn` so the action is always visible without scrolling.
- New entries are now inserted at the top of the list so the freshly added entry is immediately visible and editable.
- Add an `.entriesToolbarSplit` modifier class to scope the `space-between` layout to the API key toolbar only, avoiding unintended layout shift in the models section toolbar.

## Background

When a provider has many API key entries, the "add" button sits below all cards and requires scrolling to the bottom to reach it, making the workflow unnecessarily tedious.

Placing it in the toolbar keeps it consistently accessible regardless of entry count.

## Changes

- **`src/features/providers/sheets/forms/BaseProviderForm.tsx`**
  - Remove the bottom `<button>` (addBtn) after the entry card loop.
  - Insert a new "add entry" button inside `entriesToolbar`, next to the existing "test all" button.
  - Apply both `styles.entriesToolbar` and `styles.entriesToolbarSplit` to the API key toolbar to activate the split layout.
  - Insert new entries at the beginning of the list (`[emptyApiKeyEntry(), ...apiKeyEntries]`) instead of the end.

- **`src/features/providers/sheets/forms/sharedForm.module.scss`**
  - Add `.entriesToolbarSplit` modifier class with `justify-content: space-between`. The base `.entriesToolbar` stays `flex-end`, keeping the models section toolbar unchanged.

## Verification

- [ ] `bun run type-check`
- [ ] `bun run build`
- [ ] Manually verify: open an OpenAI-compatible provider with multiple API key entries; confirm the "add" button appears in the toolbar and still functions correctly.
- [ ] Manually verify: open a provider with a models section (e.g. OpenAI-compatible); confirm the "from /v1/models import" button remains right-aligned and is unaffected.

```
