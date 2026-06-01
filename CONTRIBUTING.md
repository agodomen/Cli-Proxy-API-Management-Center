为提高代码历史的可读性、简化 Code Review 流程并支持自动生成 Release Log，本仓库强制执行规范化的 Commit 约定。

*To improve code history readability, streamline code review processes, and support automated release log generation, this repository strictly enforces normalized Git Commit conventions.*

---

## 1. Commit Message 结构 / Commit Message Structure

每次提交必须遵守以下格式：

*Every commit must strictly adhere to the following structure:*

```text
<type>(<scope>): <subject> (#PR号)

[body]

[footer]
```

---

## 2. Type 枚举（必选）/ Type Enumeration (Mandatory)

必须使用以下枚举之一，**禁止使用任意未经定义的词汇**（如 `update` / `change` / `modify` / `misc`）：

*You must use one of the following enumerations. **Unapproved terms are strictly prohibited** (e.g., `update`, `change`, `modify`, `misc`):*

| Type | 说明 / Description | 示例 / Example |
| :--- | :--- | :--- |
| `feat` | 引入新的业务功能或接口<br/>*A new feature or API endpoint* | `feat(order): add auto-cancellation timer` |
| `fix` | 修复 Bug 或逻辑缺陷<br/>*A bug fix or logical correction* | `fix(auth): resolve token expiration edge case` |
| `perf` | 性能优化（不改变业务逻辑）<br/>*Performance improvements (without changing logic)* | `perf(db): add index for user search query` |
| `refactor` | 代码重构（既不是 feat 也不属于 fix）<br/>*Code refactoring (neither a feat nor a fix)* | `refactor(cart): extract price calculation module` |
| `style` | 代码格式调整（不影响代码运行逻辑，如空格、缩进等）<br/>*Formatting changes (whitespace, formatting, etc.)* | `style(user): format import statements` |
| `docs` | 仅变更文档（如 README、API 文档、注释）<br/>*Documentation-only changes (README, API docs, comments)* | `docs(api): update swagger spec for payment v2` |
| `test` | 增加、修改单元测试或集成测试<br/>*Adding or correcting existing unit/integration tests* | `test(payment): add unit tests for mock gateway` |
| `chore` | 构建过程、构建工具或辅助工具的变动<br/>*Changes to build process, tooling, or auxiliary tools* | `chore(deps): bump log4j from 2.14.1 to 2.17.1` |
| `ci` | 部署、持续集成脚本与配置调整<br/>*Changes to CI/CD configuration scripts and workflows* | `ci(github): add workflow for daily integration tests` |
| `revert` | 回滚之前的某次 Commit<br/>*Reverts a previous commit* | `revert: feat(user): add email verification` |

---

## 3. Scope 作用域（推荐）/ Scope Enumeration (Recommended)

Scope 用于指定提交影响的**业务模块或技术层级**。应优先选择小写英文字符，**禁止填写具体的代码文件名**（如 `UserService.java`）。

*Scope specifies the **business domain or technical module** affected by the commit. Use lowercase English letters. **Never write specific source filenames as the scope** (e.g., `UserService.java`).*

| 分类 / Category | 推荐枚举 / Recommended Enum | 适用场景 / Applicable Context |
| :--- | :--- | :--- |
| **业务域**<br/>*Business Domain* | `user` / `order` / `payment` / `auth` / `cart` | 具体的业务功能模块<br/>*Specific functional business modules* |
| **技术域**<br/>*Technical Domain* | `api` / `db` / `cache` / `config` / `queue` | 通用技术架构、基础设施组件<br/>*General technical architecture & infrastructure* |
| **工具与工程**<br/>*Tooling & DevOps* | `ci` / `deps` / `repo` / `build` | 项目配置、依赖管理、仓库治理<br/>*Repository config, dependency management, build system* |

---

## 4. Subject 标题规范 / Subject Guidelines

- **动词要求**：使用**祈使句**动词原形（如 `add`, `fix`, `remove`, `update`, `refactor`），不要使用过去式或动名词（如 `added`, `adding`, `fixed`）。
  * **Imperative Mood**: Use imperative, present tense verbs (e.g., `add`, `fix`, `remove`, `update`, `refactor`). Do not use past tense or gerunds (e.g., `added`, `adding`, `fixed`).*
- **大小写**：首字母**必须小写**。
  * **Capitalization**: First letter **must be lowercase**.*
- **标点**：结尾**绝对不能加句号** `.`。
  * **Punctuation**: **No trailing period** (`.`) at the end.*
- **长度限制**：包括 type/scope 在内，整行**控制在 72 个字符以内**。
  * **Length Limit**: Entire header line (type + scope + subject) must not exceed **72 characters**.*

```text
✅ 正确 / Correct:
feat(user): add email verification
fix(payment): resolve timeout error during checkout

❌ 错误 / Incorrect:
Added email verification.             (使用过去式 + 结尾带句号 / Uses past tense + trailing period)
feat(user): Add email verification.    (首字母大写 + 结尾带句号 / Capitalized first letter + trailing period)
fix: fixed the payment timeout error   (过去式 + 未使用推荐 scope / Past tense + non-standard scope)
```

---

## 5. Body 内容体（可选）/ Body (Optional)

当单靠 Subject 无法交代清楚背景时，需补充 Body。

*Include a body when the subject alone cannot explain the necessary context.*

- **核心定位**：主要解释**为什么进行修改（Why & What）**，而不是重写一遍代码实现细节（How）。
  * **Core Purpose**: Explain **why** the changes were made, rather than repeating **how** the code works.*
- **格式规范**：与 Subject 之间必须空出一行；每行长度不超过 **72 个字符**，建议折行。
  * **Formatting**: Must leave one blank line after the subject line. Wrap lines at **72 characters**.*

---

## 6. Footer 结尾（可选）/ Footer (Optional)

用于**关联 Issue/PR** 或声明 **破坏性变更（Breaking Changes）**。

*Used to **reference Issues / PRs** or declare **Breaking Changes**.*

**关联 Issue / PR：** 使用官方关联关键字（如 `Closes`, `Fixes`, `Refs`）
* **Referencing Issues / PRs:** Use official issue tracking keywords (e.g., `Closes`, `Fixes`, `Refs`)*

```text
Closes #42
Fixes #108
```

**声明 Breaking Change（不兼容变更）：** 如果本次修改引入了重大破坏性更新，**必须**在 Footer 显式声明，并在 Type 后加 `!`

* **Declaring Breaking Changes:** If the commit introduces breaking changes, you **must** explicitly state it in the footer and append `!` after the type/scope*

```text
feat(auth)!: remove deprecated v1 login endpoint

BREAKING CHANGE: The /v1/login API has been removed. All clients must migrate to /v2/login.
```

---

## 7. 典型示例 / Commit Examples

**示例 1：标准功能提交（包含 Body 与 Footer）**

* **Example 1: Standard Feature Commit (Header + Body + Footer)**

```text
feat(auth): add jwt refresh mechanism (#56)

Support silent refresh without user interaction.
Token rotation enabled by default to enhance security.

Closes #49
```

**示例 2：简单 Bug 修复（仅 Header）**

* **Example 2: Simple Bug Fix (Header Only)**

```text
fix(order): prevent negative total calculation (#102)
```

**示例 3：破坏性变更（Breaking Change）**

* **Example 3: Breaking Change Commit**

```text
refactor(api)!: drop legacy XML payload support (#204)

BREAKING CHANGE: XML payloads are no longer accepted. Switch to JSON.

Closes #189
```

---

## 8. 工具约束与自动校验 / Tool Enforcements & Automated Checks

本仓库启用 **husky + commitlint** 进行提交校验：

*This repository uses **husky + commitlint** to enforce commit conventions automatically:*

1. 当执行 `git commit` 时，`commit-msg` 钩子会自动拦截并检查 Commit Message。
   *When running `git commit`, the `commit-msg` hook validates your message automatically.*
2. 不符合规范的 Commit 将**直接被拒绝提交**。
   *Non-compliant commit messages will be **rejected instantly**.*
3. **推荐使用交互式 Commit 工具**，在命令行执行以下命令引导填写：
   * **Interactive CLI helper is recommended**. Run the following command for guided commit wizard:*

```bash
pnpm commit   # 或 npm run commit / cz
```

---

## 9. 常见问题答疑 (FAQ) / Frequently Asked Questions (FAQ)

#### Q1：Scope 不确定怎么填？
*What if the scope is uncertain?*

> **A：** 优先选择最贴切的业务域；如果变动涉及全局配置或框架层，使用 `config` / `repo`；实在无法判断时，可以省略括号及 Scope，仅保留 `type: subject`（例如 `chore: update build script`）。
> 
> ***A:** Prioritize selecting the most appropriate business domain. For cross-cutting or infrastructure changes, use `config` or `repo`. If still uncertain, scope can be omitted entirely, leaving `type: subject` (e.g., `chore: update build script`).*

---

#### Q2：一次提交涉及多个 Scope 或多种变更类型？
*What if a single commit spans multiple scopes or types?*

> **A：** 强烈建议拆分为多次独立的 Commit（遵循“单一职责原则”）。如果无法拆分，必须选择最核心的 Scope，并在 Body 中列出详细影响范围。
> 
> ***A:** Strongly recommend breaking it down into multiple independent atomic commits (Single Responsibility Principle). If splitting is impossible, select the primary scope and list detailed impacts in the body.*

---

#### Q3：提交后发现 Commit Message 写错了怎么修？
*How to fix a commit message after committing?*

> **A：**
> - **最新一次提交（未 Push）：** 执行 `git commit --amend` 直接修改。
>   * **Latest Commit (Unpushed):** Run `git commit --amend` to edit directly.*
> - **历史提交（未 Push）：** 使用 `git rebase -i HEAD~N` 并标记对应提交为 `reword`。
>   * **Historical Commit (Unpushed):** Run `git rebase -i HEAD~N` and mark the target commit as `reword`.*
> - **已 Push 到远端：** 原则上禁止强推（Force Push），除非在独立的 Feature 分支且未合并到主干。
>   * **Pushed to Remote:** Force-push is prohibited on shared branches; allowed only in personal feature branches prior to PR merge.*