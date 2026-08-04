# PR 1 — fix(ui): 将"新增条目"按钮移至工具栏

> 草稿，供提交时复制使用

## Title

```
fix(ui): move "add entry" button to entries toolbar
```

## Body

```markdown
## Summary

- 将"新增 API Key 条目"按钮从条目卡片列表底部移至 `entriesToolbar` 区域，与"全部测试"按钮并列显示。
- 移除底部独立的 `addBtn`，使该操作始终可见，无需滚动。
- 新条目现在插入到列表顶部，以便用户立即看到并编辑新增条目。
- 通过新增 `.entriesToolbarSplit` 修饰类限定 `space-between` 布局仅作用于 API Key 工具栏，避免影响模型区工具栏的布局。

## Background

当某个 Provider 拥有较多 API Key 条目时，"新增"按钮位于所有卡片下方，用户每次都需要滚动到页面底部才能点击，操作繁琐且效率低。

将其移至工具栏后，无论条目数量多少，该按钮始终保持可见且易于访问。

## Changes

- **`src/features/providers/sheets/forms/BaseProviderForm.tsx`**
  - 删除条目卡片循环之后的底部 `<button>`（addBtn）。
  - 在 `entriesToolbar` 内新增"新增条目"按钮，与已有的"全部测试"按钮并列。
  - API Key 工具栏同时应用 `styles.entriesToolbar` 和 `styles.entriesToolbarSplit`，激活左右分列布局。
  - 新条目插入位置从末尾改为列表开头（`[emptyApiKeyEntry(), ...apiKeyEntries]`）。

- **`src/features/providers/sheets/forms/sharedForm.module.scss`**
  - 新增 `.entriesToolbarSplit` 修饰类，设置 `justify-content: space-between`。基础 `.entriesToolbar` 保持 `flex-end` 不变，模型区工具栏不受影响。

## Verification

- [ ] `bun run type-check`
- [ ] `bun run build`
- [ ] 手动验证：打开一个具有多个 API Key 条目的 OpenAI 兼容提供商，确认"新增"按钮出现在工具栏中且功能正常。
- [ ] 手动验证：打开一个带有模型区的提供商（如 OpenAI 兼容），确认"从 /v1/models 导入"按钮仍然靠右显示，不受影响。
```
