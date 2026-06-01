# Problem 2：PR2 代码审查发现的问题

> 记录于 PR2 提交前 review 阶段

## 问题 1（严重）：混入了不相关的改动 — API Key 初始化逻辑

diff 中新增了以下代码：

```tsx
// In edit mode, populate the API key from resource.raw so the field is not empty
if (mode === 'edit' && resource && brand !== 'openaiCompatibility') {
  const rawKey = (resource.raw as { apiKey?: string } | undefined)?.apiKey ?? '';
  if (rawKey) initial.apiKey = rawKey;
}
```

此逻辑同时出现在 `form` 和 `initialFormSignature` 两个 state 初始化器中，共两处。

### 为什么有问题

1. **安全设计冲突**：`buildInitialForm` 在 edit 模式下故意把 `apiKey` 设为空字符串（`BaseProviderForm.tsx:138`），这是项目的安全设计——后端不返回明文密钥，前端也不应该尝试从 `resource.raw` 读取。
2. **大概率不生效**：`resource.raw` 的类型是 `GeminiKeyConfig & ProviderKeyConfig`，其中 `apiKey` 字段本身为空或不存在，这段代码实际不会填入任何值。
3. **职责不清**：这个行为变更和"显示/隐藏密码切换"是完全不同的问题，混在同一个 PR 里 reviewer 一定会质疑。即使需要修，也应该单独提 PR。

### 处理方式

从 PR2 中移除这段代码，保持 `buildInitialForm` 原有行为不变。如确有需要，单独提 PR 讨论。

---

## 问题 2（中）：aria-label 硬编码英文

```tsx
aria-label={showPasswords.has(idx) ? 'Hide password' : 'Show password'}
```

项目使用 i18next 做国际化，组件中已有 `useTranslation`，此处应使用 `t()` 翻译，与其他按钮文案保持一致。

### 处理方式

替换为 i18n key，例如：

```tsx
aria-label={showPasswords.has(idx)
  ? t('providersPage.form.hideApiKey')
  : t('providersPage.form.showApiKey')
}
```

并在对应的语言文件中补充翻译。

---

## 问题 3（小）：`.passwordInput` 样式大量重复

新增的 `.passwordInput` 将 `.input` 的属性全部复制了一遍（border、background、font-size、focus 样式等），造成维护负担——未来 `.input` 改动时 `.passwordInput` 不会同步更新。

### 处理方式

两种方案任选其一：

**方案 A：SCSS composes**

```scss
.passwordInput {
  composes: input from global;
  padding-right: 36px;
}
```

**方案 B：className 拼接**

```tsx
className={`${styles.input} ${styles.passwordInput}`}
```

```scss
// .passwordInput 只写差异部分
.passwordInput {
  padding-right: 36px;
}
```
