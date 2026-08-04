# PR 2 — fix(ui): add show/hide toggle for API key inputs

> 草稿，供提交时复制使用

## Title

```
fix(ui): add show/hide toggle for API key inputs and populate key on edit
```

## Body

```markdown

## Summary

- Add a show/hide password toggle button to **all** API key input fields in the provider form.
- Apply the toggle to both the single API key field (`descriptor.supportsApiKey`, used by Gemini/Codex/Claude/Vertex) and the per-entry API key fields (`apiKeyEntries`, used by OpenAI-compatible providers).
- Fix the edit-mode API key field displaying as empty — now populates the value from `resource.raw.apiKey` so existing keys can be verified without re-entering.

## Background

All API key inputs in the provider form use `type="password"` with no visibility toggle. Two problems exist:

1. **No toggle**: When editing an existing provider the key is masked as `••••••`, making it impossible to verify or partially update the value without re-entering the entire key.
2. **Empty field on edit**: For non-OpenAI providers, `buildInitialForm` sets `apiKey: ''` in edit mode (security design — backend doesn't return plaintext). The value exists in `resource.raw.apiKey` but was never populated into the form, so the field appeared completely empty.

The login page (`LoginPage.tsx`) already implements the eye-toggle pattern using `IconEye` / `IconEyeOff` from `@/components/ui/icons`. This PR follows the same approach.

## Changes

### `src/features/providers/sheets/forms/BaseProviderForm.tsx`

**State additions:**
- `showPasswords` (`Set<number>`) — tracks which OpenAI-entry API key fields are in "visible" mode (per-entry independent toggle).
- `showSingleApiKey` (`boolean`) — tracks visibility for the single API key field (non-OpenAI providers).
- `useEffect` resets both states to default (hidden) when `resource?.id` or `mode` changes (i.e., sheet closes or switches to a different provider).

**Edit-mode API key initialization (line ~209–226):**
- `form` state initializer: in edit mode for non-OpenAI providers, reads `resource.raw.apiKey` and populates `initial.apiKey` so the field is not empty.
- `initialFormSignature`: applies the same logic to keep `isDirty` detection in sync (avoids false-positive dirty state on open).

**Single API key field (line ~491–513):**
- Wraps the input in `.passwordField` container.
- Changes `className` from `styles.input` to `styles.passwordInput`.
- Changes `type` from hardcoded `"password"` to `showSingleApiKey ? 'text' : 'password'`.
- Adds a toggle `<button>` with `IconEye` / `IconEyeOff` inside `.passwordToggle`.

**Per-entry API key fields (line ~740–772):**
- Same pattern as above, but uses `showPasswords.has(idx)` for per-entry independent visibility.
- Toggle button calls `togglePasswordVisibility(idx)` which adds/removes the index from the `Set`.

### `src/features/providers/sheets/forms/sharedForm.module.scss`

New styles (line ~541–597):
- `.passwordField` — `position: relative; display: flex; align-items: center` wrapper.
- `.passwordInput` — input styled to match existing `.input` but with `padding-right: 36px` to make room for the toggle button.
- `.passwordToggle` — absolutely-positioned button on the right side of the input, with hover/disabled states.

## Verification

- [ ] `bun run type-check`
- [ ] `bun run build`
- [ ] Manually verify: open a non-OpenAI provider (e.g. Gemini) in edit mode — API key field should show the existing key (masked), toggle reveals it.
- [ ] Manually verify: open an OpenAI-compatible provider with multiple API key entries — each entry has an independent show/hide toggle.
- [ ] Manually verify: close the sheet and reopen — password visibility resets to hidden.
- [ ] Manually verify: switch between providers — password visibility resets to hidden.
- [ ] Manually verify: edit mode dirty detection — opening a provider and not changing anything should NOT show unsaved changes.

```
