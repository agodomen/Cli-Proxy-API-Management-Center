# Problem 1：新条目插入顺序与连通性状态的冲突

> 记录于 PR #289 review 阶段，gemini-code-assist 指出的问题

## 问题描述

PR1 有两个目标，但它们存在冲突：

| 目标 | 做法 | 冲突点 |
|------|------|--------|
| 新条目出现在顶部（UX） | `prepend: [new, ...old]` | 数组下标整体后移 |
| 连通性状态不丢失 | `openaiStatuses[idx]` 按下标追踪 | 下标变了，状态就错位了 |

根因：`useConnectivityTest.ts` 用数组下标绑定状态，而 `key={idx}` 也按下标识别 DOM 节点。prepend 导致所有已有条目的下标 +1，两套机制同时失效。

### 具体表现

插入前（3 个条目）：

| 下标 | 条目 | 签名 | 连通性状态 |
|------|------|------|-----------|
| 0 | A | `A_sig` | success |
| 1 | B | `B_sig` | loading |
| 2 | C | `C_sig` | error |

prepend 新条目后（4 个条目）：

| 下标 | 条目 | `curr[i]` | `prev[i]` | 匹配？ | 状态结果 |
|------|------|-----------|-----------|--------|---------|
| 0 | new | `new_sig` | `A_sig` | 否 | idle（本来就是） |
| 1 | A | `A_sig` | `B_sig` | 否 | **被重置为 idle**（丢失 success） |
| 2 | B | `B_sig` | `C_sig` | 否 | **被重置为 idle**（丢失 loading） |
| 3 | C | `C_sig` | undefined | 跳过 | error 保留 |

所有已有条目的连通性测试状态均丢失。

### 相关代码

- 状态同步逻辑：`src/features/providers/sheets/forms/useConnectivityTest.ts:140-158`
- 渲染 key：`BaseProviderForm.tsx` 中 `key={idx}`
- 状态读取：`connectivity.openaiStatuses[idx]`

---

## 解决思路

**数组顺序和显示顺序是两件事，分离开：**

```
数组（状态层）：始终 append   →  [A, B, C, new]
                                    下标稳定
显示（视图层）：渲染时 reverse →  [new, C, B, A]
                                    用户看到新条目在顶部
```

- 数组操作：`[...apiKeyEntries, emptyApiKeyEntry()]` — 追加，下标不变
- 渲染：`[...apiKeyEntries].reverse().map(...)` — 倒序，新条目视觉在前
- 连通性查找：`openaiStatuses[realIdx]` — 用真实下标，状态不丢失
- React key：`key={realIdx}` — DOM 节点识别正确，无 focus 问题

---

## 具体改动（仅 BaseProviderForm.tsx）

```tsx
// 按钮：追加，不 prepend
onClick={() =>
  updateField('apiKeyEntries', [...apiKeyEntries, emptyApiKeyEntry()])
}

// 渲染：倒序，用 realIdx 关联状态和 key
{[...apiKeyEntries].reverse().map((entry, visualIdx) => {
  const realIdx = apiKeyEntries.length - 1 - visualIdx;
  const status = connectivity.openaiStatuses[realIdx] ?? {
    state: 'idle' as ConnectivityState,
    message: '',
  };
  return (
    <div key={realIdx} className={styles.entryCard}>
      {/* 删除按钮也用 realIdx */}
      onClick={() =>
        updateField(
          'apiKeyEntries',
          apiKeyEntries.filter((_, i) => i !== realIdx)
        )
      }
      ...
    </div>
  );
})}
```

---

## 变更范围总结

| 层面 | 是否改动 |
|------|---------|
| 状态管理（useConnectivityTest） | 不动 |
| 数据结构（ApiKeyEntryInput） | 不动 |
| 数组操作（updateField） | 改回 append，与原代码一致 |
| 渲染顺序 | 加 `.reverse()` + `realIdx` 映射 |

改动最小，两层关注点完全解耦。
