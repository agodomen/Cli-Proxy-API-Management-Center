# PR 2 — fix(ui): 为 API 密钥输入框添加显示/隐藏切换

> 草稿，供提交时复制使用

## Title

```
fix(ui): add show/hide toggle for API key inputs
```

## Body

```markdown
## Summary

- 为 Provider 表单中所有 API 密钥输入框添加显示/隐藏密码切换按钮。
- 同时应用于单 API 密钥字段（`descriptor.supportsApiKey`）和多条目 API 密钥字段（`apiKeyEntries`），使已有密钥无需离开页面即可核对。

## Background

Provider 表单中所有 API 密钥输入框均使用 `type="password"` 且没有可见性切换。新增条目时字段为空不影响操作，但编辑已有 Provider 时密钥显示为 `••••••`，无法确认内容是否正确，也无法部分修改，只能整段重新输入。

项目登录页（`LoginPage.tsx`）已使用 `IconEye` / `IconEyeOff`（来自 `@/components/ui/icons`）实现了相同的切换模式，本 PR 复用该方案。

## Changes

- **`src/features/providers/sheets/forms/BaseProviderForm.tsx`**
  - 新增 `showApiKey` 状态（boolean）用于控制密码可见性。
  - 单 API 密钥字段（约第 460 行）：将 `type="password"` 改为 `type={showApiKey ? 'text' : 'password'}`，并添加 `IconEye` / `IconEyeOff` 切换按钮。
  - 多条目 API 密钥字段（约第 700 行）：对每个条目卡片的 API 密钥输入框应用相同的切换逻辑。

## Verification

- [ ] `bun run type-check`
- [ ] `bun run build`
- [ ] 手动验证：打开一个已有 API 密钥的 Provider 编辑页面，确认密钥初始为遮挡状态，点击切换按钮可显示/隐藏。
- [ ] 手动验证：打开一个具有多个 API Key 条目的 OpenAI 兼容提供商，确认每个条目的 API 密钥字段均有独立的显示/隐藏切换按钮。
```
