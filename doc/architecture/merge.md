# CPAMC → Cli-Proxy-API-Management-Center 迁移方案

## 背景

CPAMC 是从 Cli-Proxy-API-Management-Center（下称 Center）的历史分支分叉出来的项目，在 Center 基础上新增了用量监控（Usage Service）、服务商管理（Service Providers）、细化 AI Provider 编辑页等特性。

**核心诉求**：以「做加法」的方式将 CPAMC 的独有功能迁移到 Center，尽量不改动 Center 现有代码，避免 Center 的分支合并冲突和混乱开发。

---

## 差异分析

### CPAMC 独有的新增内容（纯增量，可直接复制）

| 类别 | 路径 | 说明 |
|------|------|------|
| Go 后端 | `backend/` | 完整的独立 Go HTTP 服务（SQLite + Collector + API） |
| Docker | `.devcontainer/docker-compose.usage.yml`, `.devcontainer/Dockerfile.usage-service`, `.devcontainer/.dockerignore` | Usage Service 部署配置 |
| 脚本 | `bin/release`, `start-usage.sh`, `start-usage.bat` | 发布与启动脚本 |
| 功能模块 | `frontend/src/features/serviceProviders/` | 服务商管理完整页面 |
| Provider 组件 | `frontend/src/components/providers/{AmpcodeSection,ClaudeSection,CodexSection,GeminiSection,OpenAISection,VertexSection,ProviderList,ProviderNav}/` | 各 Provider 独立编辑组件 |
| Provider 导出 | `frontend/src/components/providers/index.ts`, `types.ts` | Provider 模块入口与类型 |
| UI 组件 | `frontend/src/components/ui/{DropdownMenu,HeaderInputList,ModelInputList,modelInputListUtils}.*` | 新增 UI 组件 |
| 页面 | `frontend/src/pages/AiProviders*`, `MonitoringCenterPage`, `CodexInspectionPage` | 各 Provider 编辑页、监控页 |
| Store | `frontend/src/stores/use{ClaudeEdit,OpenAIEdit,UsageService}Store.ts` | 新增状态管理 |
| 类型 | `frontend/src/types/sourceInfo.ts` | 来源信息类型 |
| 工具 | `frontend/src/utils/{apiKeyHash,sourceResolver,usage}.*`, `frontend/src/utils/quota/{codexQuota,providers}/` | API Key 哈希、来源解析、用量计算 |
| 测试 | `../../frontend/src/test/`, `frontend/src/utils/*.test.ts`, `frontend/src/utils/quota/*.test.ts` | 测试文件 |
| CI | `.github/workflows/{issue-check,pr-check}.yml` | GitHub Actions |
| 图片 | `img/` | 项目图片资源 |

### 两者都存在但内容不同的文件（分叉修改）

| 类别 | 文件 | 分歧程度 | 说明 |
|------|------|---------|------|
| 路由 | `frontend/src/router/MainRoutes.tsx` | **重大** | CPA 拆分为各 Provider 独立路由；Center 用 `ProvidersWorkbenchPage` |
| 布局 | `frontend/src/components/layout/MainLayout.tsx` | 中等 | 导航项差异 |
| 样式 | `frontend/src/styles/{components,layout,mixins,themes,variables}.scss` | 中等 | 新增样式变量/组件 |
| 配置组件 | `frontend/src/components/config/*` | 中等 | 差异化配置编辑器 |
| Provider 组件 | `frontend/src/components/providers/{ProviderStatusBar,hooks/useProviderRecentRequests,utils}.ts` | 中等 | 逻辑扩展 |
| Quota | `frontend/src/components/quota/*`, `frontend/src/utils/quota/*` | 中等 | 新增 codex/xAI quota 支持 |
| 类型 | `frontend/src/types/{authFile,config,provider,visualConfig}.ts` | 中等 | 字段扩展 |
| 工具 | `frontend/src/utils/{clipboard,connection,constants,format,helpers,validation}.ts` | 轻微 | 小幅功能扩展 |
| Store | `frontend/src/stores/index.ts`, `useQuotaStore.ts` | 轻微 | 新增 store 注册 |
| i18n | `frontend/src/i18n/locales/*.json` | 轻微 | 新增翻译 key |
| 其他 | `package.json`, `vite.config.ts`, `tsconfig.*` | 轻微 | 新增依赖/配置 |

---

## 方案对比

### 方案 A：Feature Module + 注册机制（推荐）

**思路**：将 CPAMC 独有代码组织为 Center 的一个独立 feature module，通过注册机制接入，不修改 Center 现有文件。

```
Center 项目结构（迁移后）
├── src/
│   ├── features/
│   │   ├── providers/          ← Center 原有
│   │   ├── serviceProviders/   ← CPA 新增（直接复制）
│   │   └── monitoring/         ← CPA 新增（从 pages/ 重组）
│   ├── modules/
│   │   └── cpa-extension/      ← CPA 扩展模块入口
│   │       ├── index.ts        ← 注册路由、导航、store
│   │       ├── routes.tsx      ← 扩展路由定义
│   │       └── nav.ts          ← 扩展导航项
│   ├── components/
│   │   ├── providers/          ← Center 原有（不改动）
│   │   └── cpa/                ← CPA 新增 Provider 组件
│   │       ├── AmpcodeSection/
│   │       ├── ClaudeSection/
│   │       └── ...
│   └── ...
├── backend/              ← CPA 新增（直接复制）
└── ...
```

**关键设计**：

1. **路由注册机制** — Center 的 `MainRoutes.tsx` 不改动，新增一个 `ModuleRegistry` 在应用启动时动态注入扩展路由：
   ```tsx
   // src/modules/registry.ts
   type RouteModule = { routes: RouteObject[] };
   const modules: RouteModule[] = [];
   export const registerModule = (m: RouteModule) => modules.push(m);
   export const getModuleRoutes = () => modules.flatMap(m => m.routes);
   ```

2. **导航注册机制** — `MainLayout.tsx` 不改动，通过注册函数注入导航项：
   ```tsx
   // src/modules/registry.ts
   type NavItem = { path: string; label: string; icon: ReactNode };
   const navItems: NavItem[] = [];
   export const registerNav = (items: NavItem[]) => navItems.push(...items);
   export const getNavItems = () => navItems;
   ```

3. **CPA 扩展模块入口**：
   ```tsx
   // src/modules/cpa-extension/index.ts
   import { registerModule, registerNav } from '../registry';
   import { cpaRoutes } from './routes';
   import { cpaNavItems } from './nav';

   export function initCpaExtension() {
     registerModule({ routes: cpaRoutes });
     registerNav(cpaNavItems);
   }
   ```

4. **应用入口调用** — 仅在 `main.tsx` 或 `App.tsx` 中加一行：
   ```tsx
   import { initCpaExtension } from '@/modules/cpa-extension';
   initCpaExtension();
   ```

**优点**：
- Center 现有代码改动极小（仅 `main.tsx` 一行 + 注册机制基础设施）
- CPA 扩展代码物理隔离在 `modules/cpa/` 下
- Center 可自由升级上游，CPA 扩展独立维护
- 未来其他扩展也可复用注册机制

**缺点**：
- 需要设计注册机制（约 50-80 行基础设施代码）
- 分叉修改的文件需要以「新增扩展文件」而非「修改原文件」的方式处理

**对 Center 分叉修改的处理策略**：

| 修改类型 | 处理方式 |
|---------|---------|
| 类型扩展 (`types/*.ts`) | 新建 `frontend/src/modules/cpa/types/` 扩展类型，通过 interface 继承或交叉类型组合 |
| Store 扩展 | 新建 `frontend/src/modules/cpa/stores/` 独立 store，不修改 Center 的 `stores/index.ts` |
| 工具函数扩展 | 新建 `frontend/src/modules/cpa/utils/` 包装扩展，import Center 原函数后再组合 |
| 样式扩展 | 新建 `frontend/src/modules/cpa/styles/` 覆盖样式，利用 CSS 优先级 |
| i18n 新增 key | 新建 `frontend/src/modules/cpa/i18n/` 独立 namespace，通过 i18next 的 `addResourceBundle` 动态注入 |
| Provider 组件差异 | CPA 的新 Provider 组件放 `frontend/src/components/cpa/`，不修改 Center 的 `providers/` |

---

### 方案 B：Git Submodule

**思路**：将 CPAMC 的独有代码独立为子模块，Center 通过 git submodule 引入。

**优点**：
- 零代码改动，物理隔离最彻底
- CPAMC 可独立版本管理

**缺点**：
- 前端项目不适合 submodule — 组件/路由/store 需要在编译时整合
- 运维复杂度高（submodule 更新、CI 适配）
- 无法直接共享 Center 的组件和类型

**结论**：不适合前端项目，不推荐。

---

### 方案 C：独立 npm 包

**思路**：将 CPAMC 独有功能打包为 `@cpa/extension` npm 包，Center 安装后使用。

**优点**：
- 物理隔离清晰，版本管理规范
- 可复用于其他项目

**缺点**：
- 包需要打包构建，开发体验差（改一处要重新 build 包）
- 跨包共享组件/类型/样式困难
- 对于同团队内部项目来说过度工程化

**结论**：适合开源/跨团队场景，当前场景不推荐。

---

### 方案 D：直接复制 + 手动适配

**思路**：直接将 CPAMC 新增文件复制到 Center，对分叉修改的文件手动合并。

**优点**：
- 最简单直接，无架构改动
- 迁移后代码统一，无额外抽象

**缺点**：
- **必须修改 Center 现有文件**（路由、布局、Store 注册、i18n 等），与「不改动 Center 代码」矛盾
- 后续 Center 升级上游代码时，合并冲突不可避免
- 无法实现「做加法」的隔离效果

**结论**：不符合需求约束，仅作为最后手段。

---

## 推荐方案：A — Feature Module + 注册机制

### 实施步骤

#### 第一阶段：基础设施（约 2 小时）

1. **在 Center 中创建注册机制**
   - `frontend/src/modules/registry.ts` — 模块注册中心（路由、导航、store）
   - `frontend/src/modules/types.ts` — 模块接口定义

2. **改造 Center 入口**
   - `frontend/src/main.tsx` — 加载模块注册 + 初始化
   - `MainRoutes.tsx` — 读取注册的路由（仅改这一处：用 `getModuleRoutes()` 替代硬编码）
   - `MainLayout.tsx` — 读取注册的导航（仅改这一处：用 `getNavItems()` 替代硬编码）

#### 第二阶段：迁移纯增量代码（约 3 小时）

3. **复制独立模块（零适配）**
   - `backend/` → 直接复制
   - `.devcontainer/docker-compose.usage.yml`, `.devcontainer/Dockerfile.usage-service` → 直接复制
   - `frontend/src/features/serviceProviders/` → 直接复制
   - `frontend/src/components/ui/{DropdownMenu,HeaderInputList,ModelInputList}*` → 直接复制
   - `frontend/src/utils/{apiKeyHash,sourceResolver,usage}*` → 直接复制
   - `frontend/src/utils/quota/{codexQuota,providers}*` → 直接复制
   - `../../frontend/src/test/` → 直接复制

4. **复制 Provider 组件到隔离目录**
   - `frontend/src/components/providers/{AmpcodeSection,...,VertexSection}` → 复制到 `frontend/src/components/cpa/`
   - `frontend/src/components/providers/{ProviderList,ProviderNav,index,types}*` → 复制到 `frontend/src/components/cpa/`
   - 修改内部 import 路径指向新位置

#### 第三阶段：适配分叉修改（约 4 小时）

5. **路由整合**
   - 创建 `frontend/src/modules/cpa-extension/routes.tsx`，将 CPA 的各 Provider 路由和监控路由定义在此
   - 通过 `registerModule()` 注册

6. **导航整合**
   - 创建 `frontend/src/modules/cpa-extension/nav.ts`，将 CPA 的导航项定义在此
   - 通过 `registerNav()` 注册

7. **类型扩展**
   - Center 的 `types/*.ts` 不改动
   - CPA 扩展类型放 `frontend/src/modules/cpa/types/`，通过交叉类型组合

8. **Store 独立化**
   - `useUsageServiceStore`、`useClaudeEditDraftStore`、`useOpenAIEditDraftStore` 放 `frontend/src/modules/cpa/stores/`
   - 不修改 Center 的 `stores/index.ts`

9. **i18n 动态注入**
   - CPA 新增的翻译 key 放 `frontend/src/modules/cpa/i18n/` 各语言文件
   - 通过 `i18next.addResourceBundle()` 在模块初始化时注入

10. **样式隔离**
    - CPA 新增样式放 `frontend/src/modules/cpa/styles/`
    - 利用 CSS 选择器作用域避免冲突

#### 第四阶段：验证与清理（约 2 小时）

11. **构建验证** — 确保 Center 原有功能 + CPA 扩展功能均正常
12. **类型检查** — `tsc --noEmit` 无错误
13. **清理** — 移除迁移后不再需要的适配代码

### Center 代码改动清单（最小化）

| 文件 | 改动 | 行数估计 |
|------|------|---------|
| `frontend/src/main.tsx` | 增加 `initCpaExtension()` 一行调用 | +2 |
| `frontend/src/modules/registry.ts` | 新增文件 | +50 |
| `frontend/src/modules/types.ts` | 新增文件 | +20 |
| `frontend/src/router/MainRoutes.tsx` | 用 `getModuleRoutes()` 替代硬编码 | +3/-1 |
| `frontend/src/components/layout/MainLayout.tsx` | 用 `getNavItems()` 替代硬编码 | +3/-1 |
| **合计改动 Center 现有文件** | **2 个文件** | **约 5 行** |

---

## 风险评估

| 风险 | 等级 | 应对 |
|------|------|------|
| 注册机制不够灵活 | 低 | 先满足当前需求，后续按需扩展 |
| CPA Provider 组件引用了 Center 内部类型 | 中 | 通过 re-export 或扩展类型桥接 |
| 样式冲突 | 低 | CSS Modules 本身隔离，CPA 扩展用独立前缀 |
| Center 上游升级破坏注册接口 | 低 | 注册接口极简（仅 route + nav），破坏概率极低 |
| 构建体积增大 | 低 | CPA 新增代码约 3700+ 行，对 SPA 影响可忽略 |

---

## 时间估算

| 阶段 | 工时 |
|------|------|
| 基础设施（注册机制） | 2h |
| 纯增量代码迁移 | 3h |
| 分叉修改适配 | 4h |
| 验证与清理 | 2h |
| **合计** | **约 11h** |

---

## 方案 A 的改动文件评估

### 目标

方案 A 追求的是：

- **Center 原有业务代码尽量不动**
- **CPAMC 以扩展模块形式接入**
- **把改动压缩到“壳层接入点”**，避免未来 Center 升级时出现大面积冲突

这里的“会改动的文件”分三类：

1. **必须改动的原文件** — 不改就无法把扩展挂进应用
2. **建议改动的原文件** — 改了更干净，不改也能用但实现会更绕
3. **原则上不改的原文件** — 尽量通过新增扩展文件绕开

---

### 一、必须改动的原文件

#### 1. `../Cli-Proxy-API-Management-Center/src/router/MainRoutes.tsx`

**是否必须改**：是  
**改动目的**：把 CPA 扩展页面挂进主路由  
**当前现状**：路由表 `mainRoutes` 是硬编码数组，没有扩展点

**预计改动内容**：
- 从扩展模块导入 `cpaRoutes` 或 `getModuleRoutes()`
- 将 `mainRoutes` 改为：
  - 原有主路由 + 扩展路由
- 保持原有 fallback 路由不变

**改动量**：小（约 3~8 行）

**风险等级**：低  
**原因**：
- 只是在数组中拼接新增路由
- 不会改变 Center 现有页面逻辑
- 若扩展模块失效，只影响新增页面，不影响原有页面

**建议写法**：
- 不要把 CPA 全部页面硬编码进 `MainRoutes.tsx`
- 只做一层拼接，例如：
  ```ts
  const routes = [...mainRoutes, ...cpaRoutes];
  ```
- 这样未来冲突最小

---

#### 2. `../Cli-Proxy-API-Management-Center/src/components/layout/MainLayout.tsx`

**是否必须改**：是  
**改动目的**：把 CPA 扩展菜单挂进侧边栏/导航  
**当前现状**：导航项和图标映射是硬编码的

**预计改动内容**：
- 从扩展模块导入 `cpaNavItems` 或 `getNavItems()`
- 在现有导航项数组后拼接扩展菜单
- 如果图标映射是硬编码 key → icon，扩展菜单最好自带 icon，避免改动内部映射逻辑

**改动量**：小到中（约 5~15 行）

**风险等级**：低到中  
**原因**：
- 布局文件通常耦合较多，但这里只建议在导航数据层做拼接
- 若不改渲染逻辑，只加菜单数据，风险可控

**建议写法**：
- 不要让 `MainLayout.tsx` 知道 CPA 菜单细节
- 只接收一个扩展菜单数组，例如：
  ```ts
  const navItems = [...coreNavItems, ...cpaNavItems];
  ```
- 扩展项自带 `labelKey/icon/path`

---

### 二、建议改动的原文件

#### 3. `../Cli-Proxy-API-Management-Center/src/main.tsx`

**是否必须改**：通常建议改，但理论上可绕开  
**改动目的**：初始化 CPA 扩展（i18n 注入、模块注册、一次性 setup）

**预计改动内容**：
- 增加一行初始化调用，例如：
  ```ts
  initCpaExtension();
  ```
- 或在应用启动时导入 CPA 扩展入口模块

**改动量**：极小（1~3 行）

**风险等级**：低  
**原因**：
- 只是增加启动初始化
- 不改渲染结构，不改状态逻辑

**为什么建议改**：
- 这样 i18n、routes、nav 的注册可以集中处理
- 避免在 `MainRoutes.tsx` / `MainLayout.tsx` 分别做隐式初始化

**如果不改 `main.tsx`**：
- 可以在 `MainRoutes.tsx` 或 `MainLayout.tsx` 中直接 import 扩展数据
- 但这样扩展初始化分散，不够干净

---

### 三、可选改动的原文件

#### 4. `../Cli-Proxy-API-Management-Center/src/i18n/index.ts`

**是否必须改**：否  
**推荐策略**：尽量不改

**原因**：
- CPA 新增翻译完全可以在扩展模块初始化时通过 `i18next.addResourceBundle()` 动态注入
- 没必要直接改 Center 的 locale JSON 或 i18n 初始化资源对象

**什么时候才需要改**：
- 如果 Center 的 i18n 初始化封装限制了运行时注入
- 或者团队明确要求所有文案必须静态进入 locale JSON

**改动量**：如果改，也很小  
**风险等级**：低

**结论**：能不改就不改

---

#### 5. `../Cli-Proxy-API-Management-Center/package.json`

**是否必须改**：大概率需要  
**但性质不同**：这是依赖接入，不属于业务侵入

**预计改动内容**：
- 增加测试依赖或运行依赖（如果 CPA 的增量代码引用了 Center 当前没有的包）
- 例如：`vitest`、`react-test-renderer`、`@types/node` 等

**风险等级**：低  
**原因**：
- 依赖升级/补充一般属于可控改动
- 但需要注意不要无意义覆盖 Center 当前依赖版本

**建议**：
- 只补真正缺失的依赖
- 尽量以 Center 当前版本为准，不把 CPA 的依赖版本整体覆盖进去

---

### 四、原则上不改的原文件

以下文件虽然 CPAMC 与 Center 存在差异，但在方案 A 下，原则上都应该通过“扩展层新增文件”来绕开，而不是直接修改 Center 原文件。

#### 1. 类型文件

- `../Cli-Proxy-API-Management-Center/src/types/provider.ts`
- `../Cli-Proxy-API-Management-Center/src/types/config.ts`
- `../Cli-Proxy-API-Management-Center/src/types/authFile.ts`
- `../Cli-Proxy-API-Management-Center/src/types/visualConfig.ts`

**原因**：
- 这些差异目前看主要是字段扩展，不是核心模型重构
- 可以在 CPA 扩展里定义：
  - `ExtendedProvider`
  - `ExtendedAppConfig`
  - `UsageConfig`
- 用交叉类型 / 包装类型解决，而不是污染 Center 基础类型

**风险**：低  
**结论**：不建议改原文件

---

#### 2. Store 聚合文件

- `../Cli-Proxy-API-Management-Center/src/stores/index.ts`

**原因**：
- CPA 只是新增 re-export：`useUsageServiceStore`、`useOpenAIEditDraftStore`、`useClaudeEditDraftStore`
- 完全可以从扩展模块内部直接 import，不必挂到 Center 的统一出口

**风险**：低  
**结论**：不建议改原文件

---

#### 3. 语言包 JSON

- `../Cli-Proxy-API-Management-Center/src/i18n/locales/en.json`
- `../Cli-Proxy-API-Management-Center/src/i18n/locales/zh-CN.json`
- `../Cli-Proxy-API-Management-Center/src/i18n/locales/zh-TW.json`
- `../Cli-Proxy-API-Management-Center/src/i18n/locales/ru.json`

**原因**：
- 动态注入资源即可
- 改原始大 JSON 文件，未来最容易产生无意义冲突

**风险**：中（如果直接改）  
**结论**：尽量不要改

---

#### 4. 现有业务组件/页面

- `frontend/src/components/config/*`
- `frontend/src/components/quota/*`
- `frontend/src/components/providers/*`（Center 原有部分）
- `frontend/src/features/providers/*`
- `frontend/src/pages/*`（Center 原有页面）

**原因**：
- 这些是最容易和 Center 上游持续演进发生冲突的区域
- 如果为了兼容 CPA 去直接改这些文件，后面每次合并都会很痛苦

**推荐做法**：
- CPA 的差异页面全部新建为扩展页面
- CPA 的 Provider 编辑器放独立目录
- 不反向改造 Center 当前 provider workbench

**风险**：高（如果直接改）  
**结论**：原则上不动

---

### 五、方案 A 下的“最小改动清单”

#### 必改原文件

1. `../Cli-Proxy-API-Management-Center/src/router/MainRoutes.tsx`
2. `../Cli-Proxy-API-Management-Center/src/components/layout/MainLayout.tsx`

#### 建议改动原文件

3. `../Cli-Proxy-API-Management-Center/src/main.tsx`
4. `../Cli-Proxy-API-Management-Center/package.json`（仅在缺依赖时）

#### 原则上不改的原文件

- `../Cli-Proxy-API-Management-Center/src/types/*`
- `../Cli-Proxy-API-Management-Center/src/stores/index.ts`
- `../Cli-Proxy-API-Management-Center/src/i18n/locales/*.json`
- `../Cli-Proxy-API-Management-Center/src/components/config/*`
- `../Cli-Proxy-API-Management-Center/src/components/providers/*`（Center 原生部分）
- `../Cli-Proxy-API-Management-Center/src/components/quota/*`
- `../Cli-Proxy-API-Management-Center/src/features/providers/*`
- `../Cli-Proxy-API-Management-Center/src/pages/*`（已有页面）

---

### 六、推荐的改动范围分级

#### Level 1：超保守接入

**只改 2 个原文件**：
- `MainRoutes.tsx`
- `MainLayout.tsx`

**特点**：
- 改动最小
- 不做通用注册机制
- 直接 import `cpaRoutes` / `cpaNavItems`
- 适合先落地

#### Level 2：平衡型接入（推荐）

**改 3 个原文件**：
- `main.tsx`
- `MainRoutes.tsx`
- `MainLayout.tsx`

**特点**：
- 初始化更清晰
- i18n 注入更干净
- 后续可维护性更好
- 依旧基本不动 Center 业务代码

#### Level 3：通用插件化

**改 4~6 个原文件/核心文件**：
- `main.tsx`
- `MainRoutes.tsx`
- `MainLayout.tsx`
- 可能新增/调整 `frontend/src/modules/registry.ts`、`frontend/src/modules/types.ts`
- 可能对少量入口代码做抽象

**特点**：
- 架构更完整
- 未来可复用给其他扩展
- 当前实现成本更高

---

### 七、最终建议

如果当前目标是：

- **尽快把 CPAMC 以加法方式迁回 Center**
- **尽量不改原文件**
- **先降低未来合并冲突风险**

那么最合适的是：

- 采用 **方案 A**
- 落地时优先选择 **Level 2：平衡型接入**
- 把原文件改动控制在：
  - `frontend/src/main.tsx`
  - `frontend/src/router/MainRoutes.tsx`
  - `frontend/src/components/layout/MainLayout.tsx`
  - `package.json`（仅当确实缺依赖时）

也就是说，**Center 真正需要改的业务壳层文件，大概率只有 3 个**。

这已经是“能挂进去、能维护、还能控制冲突”的一个比较优的平衡点。

---

## 增量内容隔离清单

以下按三个层次分类：**不需要移植**、**需要隔离（放 `frontend/src/external/`）**、**可直接使用社区原文件**。

---

### 一、不需要移植的文件

这些文件是 CPAMC 对社区样式的覆盖/重写，移植回去会破坏社区的界面风格和布局，应当放弃。

| 文件 | 差异内容 | 不移植原因 |
|------|---------|-----------|
| `frontend/src/styles/variables.scss` | 色彩体系从暖灰改为 Element Plus 蓝色风格 | 会覆盖社区配色方案 |
| `frontend/src/styles/themes.scss` | 全部 CSS 变量值不同（暖灰 vs 冷蓝） | 会覆盖社区主题 |
| `frontend/src/styles/components.scss` | 142 行差异，组件样式覆盖 | 会覆盖社区组件样式 |
| `frontend/src/styles/layout.scss` | 409 行差异，布局/间距/宽度覆盖 | 会覆盖社区布局 |
| `frontend/src/styles/mixins.scss` | 新增 4 个响应式断点 mixin | 仅 CPA 自用布局需要 |
| `frontend/src/components/ui/icons.tsx` | 图标替换（Plus/Pencil/AlertTriangle → Chevron 系列），stroke 属性不同 | 社区图标体系不同，按需在 external 中单独定义 |
| `../README.md` / `../README_CN.md` | 项目描述差异 | 各自维护，不需要移植 |
| `doc.local/summary.md` | 各自技术文档 | 各自维护 |
| `AGENTS.md` | 各自开发约束 | 各自维护 |

---

### 二、需要隔离的文件（放 `frontend/src/external/`）

这些是 CPAMC 新增或大幅改动的功能代码，必须移植但不能放入社区原目录，需隔离到 `frontend/src/external/` 下。

#### 2.1 纯新增文件（直接搬入 `frontend/src/external/`）

| 原路径 | 目标路径 | 说明 |
|--------|---------|------|
| `backend/` | `backend/` | Go 后端服务，独立进程，直接放项目根目录 |
| `.devcontainer/docker-compose.usage.yml` | `.devcontainer/docker-compose.usage.yml` | Docker 部署配置 |
| `.devcontainer/Dockerfile.usage-service` | `.devcontainer/Dockerfile.usage-service` | Docker 镜像 |
| `.devcontainer/.dockerignore` | `.devcontainer/.dockerignore` | Docker 忽略规则 |
| `bin/` | `bin/` | 发布/启动脚本 |
| `../../frontend/src/test/` | `../../frontend/src/test/` | 测试文件 |
| `img/` | `img/` | 项目图片 |

**前端 `frontend/src/` 下的纯新增：**

| 原路径 | 目标路径 | 说明 |
|--------|---------|------|
| `frontend/src/features/monitoring/` | `frontend/src/external/features/monitoring/` | 监控模块（账号额度/健康状态/使用量） |
| `frontend/src/features/requestMonitor/` | `frontend/src/external/features/requestMonitor/` | 请求监控页面 |
| `frontend/src/features/serviceProviders/hooks/` | `frontend/src/external/features/serviceProviders/hooks/` | 服务商 hooks |
| `frontend/src/features/serviceProviders/ui/` | `frontend/src/external/features/serviceProviders/ui/` | 服务商 UI 组件 |
| `frontend/src/features/serviceProviders/utils/` | `frontend/src/external/features/serviceProviders/utils/` | 服务商工具函数 |
| `frontend/src/features/serviceProviders/styles/` | `frontend/src/external/features/serviceProviders/styles/` | 服务商样式 |
| `frontend/src/features/serviceProviders/types.ts` | `frontend/src/external/features/serviceProviders/types.ts` | 服务商类型 |
| `frontend/src/features/serviceProviders/index.tsx` | `frontend/src/external/features/serviceProviders/index.tsx` | 服务商入口 |
| `frontend/src/components/providers/AmpcodeSection/` | `frontend/src/external/components/providers/AmpcodeSection/` | Ampcode 编辑组件 |
| `frontend/src/components/providers/ClaudeSection/` | `frontend/src/external/components/providers/ClaudeSection/` | Claude 编辑组件 |
| `frontend/src/components/providers/CodexSection/` | `frontend/src/external/components/providers/CodexSection/` | Codex 编辑组件 |
| `frontend/src/components/providers/GeminiSection/` | `frontend/src/external/components/providers/GeminiSection/` | Gemini 编辑组件 |
| `frontend/src/components/providers/OpenAISection/` | `frontend/src/external/components/providers/OpenAISection/` | OpenAI 编辑组件 |
| `frontend/src/components/providers/VertexSection/` | `frontend/src/external/components/providers/VertexSection/` | Vertex 编辑组件 |
| `frontend/src/components/providers/ProviderList.tsx` | `frontend/src/external/components/providers/ProviderList.tsx` | Provider 列表 |
| `frontend/src/components/providers/ProviderNav/` | `frontend/src/external/components/providers/ProviderNav/` | Provider 导航 |
| `frontend/src/components/providers/index.ts` | `frontend/src/external/components/providers/index.ts` | Provider 导出入口 |
| `frontend/src/components/providers/types.ts` | `frontend/src/external/components/providers/types.ts` | Provider 扩展类型 |
| `frontend/src/components/ui/DropdownMenu.*` | `frontend/src/external/components/ui/DropdownMenu.*` | 下拉菜单组件 |
| `frontend/src/components/ui/HeaderInputList.tsx` | `frontend/src/external/components/ui/HeaderInputList.tsx` | Header 输入列表 |
| `frontend/src/components/ui/ModelInputList.tsx` | `frontend/src/external/components/ui/ModelInputList.tsx` | Model 输入列表 |
| `frontend/src/components/ui/modelInputListUtils.ts` | `frontend/src/external/components/ui/modelInputListUtils.ts` | Model 输入工具 |
| `frontend/src/pages/AiProvidersPage.tsx` | `frontend/src/external/pages/AiProvidersPage.tsx` | AI Provider 列表页 |
| `frontend/src/pages/AiProvidersPage.module.scss` | `frontend/src/external/pages/AiProvidersPage.module.scss` | 列表页样式 |
| `frontend/src/pages/AiProviders*EditPage.tsx` (8个) | `frontend/src/external/pages/AiProviders*EditPage.tsx` | 各 Provider 编辑页 |
| `frontend/src/pages/AiProvidersEditLayout.module.scss` | `frontend/src/external/pages/AiProvidersEditLayout.module.scss` | 编辑页布局样式 |
| `frontend/src/pages/MonitoringCenterPage.*` | `frontend/src/external/pages/MonitoringCenterPage.*` | 监控中心页 |
| `frontend/src/pages/CodexInspectionPage.*` | `frontend/src/external/pages/CodexInspectionPage.*` | Codex 巡检页 |
| `frontend/src/pages/Login/` | `frontend/src/external/pages/Login/` | 登录页模块 |
| `frontend/src/pages/loginMode.ts` | `frontend/src/external/pages/loginMode.ts` | 登录模式 |
| `frontend/src/stores/useUsageServiceStore.ts` | `frontend/src/external/stores/useUsageServiceStore.ts` | Usage 服务状态 |
| `frontend/src/stores/useClaudeEditDraftStore.ts` | `frontend/src/external/stores/useClaudeEditDraftStore.ts` | Claude 编辑草稿 |
| `frontend/src/stores/useOpenAIEditDraftStore.ts` | `frontend/src/external/stores/useOpenAIEditDraftStore.ts` | OpenAI 编辑草稿 |
| `frontend/src/types/sourceInfo.ts` | `frontend/src/external/types/sourceInfo.ts` | 来源信息类型 |
| `frontend/src/utils/apiKeyHash.ts` | `frontend/src/external/utils/apiKeyHash.ts` | API Key 哈希 |
| `frontend/src/utils/sourceResolver.ts` | `frontend/src/external/utils/sourceResolver.ts` | 来源解析 |
| `frontend/src/utils/usage.ts` | `frontend/src/external/utils/usage.ts` | 使用量计算 |
| `frontend/src/utils/quota/codexQuota.ts` | `frontend/src/external/utils/quota/codexQuota.ts` | Codex 额度 |
| `frontend/src/utils/quota/providers/` | `frontend/src/external/utils/quota/providers/` | 额度 Provider |
| `frontend/src/hooks/useApi.ts` | `frontend/src/external/hooks/useApi.ts` | API 请求 hook |
| `frontend/src/hooks/useDebounce.ts` | `frontend/src/external/hooks/useDebounce.ts` | 防抖 hook |
| `frontend/src/hooks/usePagination.ts` | `frontend/src/external/hooks/usePagination.ts` | 分页 hook |
| `frontend/src/hooks/useRequestMonitoringAvailability.ts` | `frontend/src/external/hooks/useRequestMonitoringAvailability.ts` | 监控可用性 hook |
| `frontend/src/services/api/usageService.ts` | `frontend/src/external/backend/api/usageService.ts` | Usage API 层 |
| `frontend/src/services/api/codexQuota.ts` | `frontend/src/external/backend/api/codexQuota.ts` | Codex 额度 API |
| `frontend/src/features/authFiles/sessionAuthConverter.ts` | `frontend/src/external/features/authFiles/sessionAuthConverter.ts` | Session 认证转换 |

**测试文件：**

| 原路径 | 目标路径 |
|--------|---------|
| `frontend/src/utils/apiKeyHash.test.ts` | `frontend/src/external/utils/apiKeyHash.test.ts` |
| `frontend/src/utils/connection.test.ts` | `frontend/src/external/utils/connection.test.ts` |
| `frontend/src/utils/usage.test.ts` | `frontend/src/external/utils/usage.test.ts` |
| `frontend/src/utils/quota/codexQuota.test.ts` | `frontend/src/external/utils/quota/codexQuota.test.ts` |
| `frontend/src/services/api/usageService.test.ts` | `frontend/src/external/backend/api/usageService.test.ts` |
| `frontend/src/services/api/codexQuota.test.ts` | `frontend/src/external/backend/api/codexQuota.test.ts` |
| `frontend/src/services/api/providers.test.ts` | `frontend/src/external/backend/api/providers.test.ts` |
| `frontend/src/services/api/authFiles.test.ts` | `frontend/src/external/backend/api/authFiles.test.ts` |
| `frontend/src/features/authFiles/sessionAuthConverter.test.ts` | `frontend/src/external/features/authFiles/sessionAuthConverter.test.ts` |
| `frontend/src/features/authFiles/hooks/useAuthFilesData.test.ts` | `frontend/src/external/features/authFiles/hooks/useAuthFilesData.test.ts` |
| `frontend/src/pages/MonitoringCenterPage.test.tsx` | `frontend/src/external/pages/MonitoringCenterPage.test.tsx` |
| `frontend/src/pages/AuthFilesPage.*.test.tsx` | `frontend/src/external/pages/AuthFilesPage.*.test.tsx` |
| `frontend/src/pages/ConfigPage.test.ts` | `frontend/src/external/pages/ConfigPage.test.ts` |
| `frontend/src/pages/LoginPage.test.ts` | `frontend/src/external/pages/LoginPage.test.ts` |
| `frontend/src/features/monitoring/*.test.ts` | `frontend/src/external/features/monitoring/*.test.ts` |

---

#### 2.2 社区已有但被改动的文件（需拆分隔离）

这些文件在社区项目中已存在，CPAMC 对其做了功能扩展或修改。不能直接覆盖社区文件，需要把 CPA 的差异部分拆到 `frontend/src/external/` 中。

| 文件 | 差异内容 | 隔离策略 |
|------|---------|---------|
| `frontend/src/components/providers/ProviderStatusBar.tsx` | 扩展了状态展示逻辑 | 将 CPA 扩展版本放 `frontend/src/external/components/providers/ProviderStatusBar.tsx`，external 页面引用扩展版 |
| `frontend/src/components/providers/hooks/useProviderRecentRequests.ts` | 扩展了请求监控 | 将 CPA 扩展版本放 `frontend/src/external/components/providers/hooks/` |
| `frontend/src/components/providers/utils.ts` | 扩展了工具函数 | 将 CPA 扩展版本放 `frontend/src/external/components/providers/utils.ts` |
| `frontend/src/components/quota/quotaConfigs.ts` | 新增 codex/xAI quota 配置 | 将扩展配置放 `frontend/src/external/components/quota/quotaConfigs.ts`，动态合并 |
| `frontend/src/components/quota/QuotaSection.tsx` | 集成 codex quota | 将扩展版放 `frontend/src/external/components/quota/QuotaSection.tsx` |
| `frontend/src/components/quota/index.ts` | 新增 re-export | 在 `frontend/src/external/components/quota/index.ts` 自行导出 |
| `frontend/src/utils/quota/constants.ts` | 新增 codex 常量 | 将扩展常量放 `frontend/src/external/utils/quota/constants.ts` |
| `frontend/src/utils/quota/index.ts` | 新增 codex 导出 | 在 `frontend/src/external/utils/quota/index.ts` 自行导出 |
| `frontend/src/utils/quota/parsers.ts` | 新增 codex 解析 | 将扩展版放 `frontend/src/external/utils/quota/parsers.ts` |
| `frontend/src/utils/quota/resolvers.ts` | 新增 codex 解析 | 将扩展版放 `frontend/src/external/utils/quota/resolvers.ts` |
| `frontend/src/utils/quota/validators.ts` | 新增 codex 验证 | 将扩展版放 `frontend/src/external/utils/quota/validators.ts` |
| `frontend/src/utils/connection.ts` | 新增 `resolveDefaultCPAConnectionBase` 等 | 将新增函数放 `frontend/src/external/utils/connection.ts`，import 社区原函数后扩展 |
| `frontend/src/utils/constants.ts` | 新增 OAuth/分页/日志等常量 | 将新增常量放 `frontend/src/external/utils/constants.ts` |
| `frontend/src/utils/format.ts` | 新增 `maskSensitiveText`、`formatDateTime` 等 | 将新增函数放 `frontend/src/external/utils/format.ts` |
| `frontend/src/utils/helpers.ts` | 新增 `normalizeArrayResponse`、`debounce`、`throttle` | 将新增函数放 `frontend/src/external/utils/helpers.ts` |
| `frontend/src/utils/validation.ts` | 新增 `isValidUrl`、`isValidApiBase`、`isValidApiKey` 等 | 将新增函数放 `frontend/src/external/utils/validation.ts` |
| `frontend/src/utils/clipboard.ts` | CPA 删除了 `readFromClipboard` | 不需要移植，社区原版保持不变 |
| `frontend/src/types/provider.ts` | 新增 `headers?: Record<string, string>` | 在 `frontend/src/external/types/provider.ts` 中定义 `ExtendedProvider` 交叉类型 |
| `frontend/src/types/config.ts` | 新增 `clean`、`usageStatisticsEnabled` 等 | 在 `frontend/src/external/types/config.ts` 中定义 `ExtendedAppConfig` 交叉类型 |
| `frontend/src/types/authFile.ts` | 字段扩展 | 在 `frontend/src/external/types/authFile.ts` 中定义扩展类型 |
| `frontend/src/types/visualConfig.ts` | 字段扩展 | 在 `frontend/src/external/types/visualConfig.ts` 中定义扩展类型 |
| `frontend/src/stores/index.ts` | 新增 3 个 store re-export | 不需要改，external 内部自行 import |
| `frontend/src/stores/useQuotaStore.ts` | 扩展了 quota 逻辑 | 将扩展版放 `frontend/src/external/stores/useQuotaStore.ts` |
| `frontend/src/services/api/version.ts` | 新增 `checkManagerLatest` | 将扩展版放 `frontend/src/external/backend/api/version.ts` |
| `frontend/src/i18n/locales/*.json` | 新增大量翻译 key（1272 行差异） | 将新增 key 放 `frontend/src/external/i18n/` 独立 JSON，运行时动态注入 |

---

#### 2.3 需要样式隔离的文件

这些文件的差异主要是样式/布局，必须用 CSS Modules 局部作用域隔离，确保不影响社区界面。

| 文件 | 差异内容 | 隔离策略 |
|------|---------|---------|
| `frontend/src/components/config/ConfigSection.tsx` + `.module.scss` | 社区新增 `indexLabel` prop，CPA 去掉了 | 不移植，使用社区原版 |
| `frontend/src/components/config/VisualConfigEditor.tsx` + `.module.scss` + `Blocks.tsx` | 样式和布局差异 | 不移植样式差异，功能差异如需要则在 external 中另建 |
| `frontend/src/components/common/PageTransition.tsx` | 动画差异 | 不移植，使用社区原版 |
| `frontend/src/components/modelAlias/ModelMappingDiagram.tsx` | 渲染差异 | 不移植，使用社区原版 |
| `frontend/src/components/ui/Modal.tsx` | 样式差异 | 不移植，使用社区原版 |
| `frontend/src/components/ui/Select.tsx` + `.module.scss` | 样式差异 | 不移植，使用社区原版 |
| `frontend/src/components/ui/SelectionCheckbox.tsx` + `.module.scss` | 样式差异 | 不移植，使用社区原版 |
| `frontend/src/components/ui/ToggleSwitch.module.scss` | 样式差异 | 不移植，使用社区原版 |
| `frontend/src/features/authFiles/components/*.tsx` | 样式/布局差异 | 不移植样式差异，功能差异如需要则在 external 中另建 |

---

### 三、可直接使用社区原文件的（不需要隔离）

以下类型的文件不存在合并冲突风险，可以直接使用社区版本：

| 类型 | 说明 |
|------|------|
| `frontend/src/assets/` 下的 SVG/图片 | 静态资源，直接引用社区路径 |
| `frontend/src/components/ui/Collapsible/` | 社区独有的 UI 组件，CPA 不需要 |
| `frontend/src/utils/routeParams.ts` | 社区独有的路由工具，CPA 不需要 |
| `frontend/src/components/ui/scrollLock.ts` | 社区独有，CPA 不需要 |
| `.github/workflows/release.yml` | 各自维护 |
| `.gitignore` | 各自维护 |

---

### 四、总结

| 分类 | 数量 | 处理方式 |
|------|------|---------|
| 不需要移植 | ~13 个文件 | 放弃（样式覆盖/各自维护） |
| 纯新增，直接搬入 `frontend/src/external/` | ~70+ 个文件/目录 | 搬入对应 external 子目录 |
| 社区已有但需拆分隔离 | ~25 个文件 | 差异部分拆到 external，复用社区原文件 |
| 需要样式隔离 | ~9 个文件 | 不移植样式差异，用社区原版 |
| 可直接使用社区原文件 | 若干 | 直接引用，不拷贝 |

---

## 九、依赖差异清单

> 仅列出 CPAMC 比 Center **多出来或版本不同的依赖**。迁移到 Center 时只补真正缺失的，不做无谓升级。

### 9.1 运行时依赖 (dependencies)

Center 与 CPAMC 的运行时依赖**完全一致**（名称相同，版本号差异可忽略），无需追加。

### 9.2 开发依赖 (devDependencies)

| 包名 | Center 有？ | CPA 版本 | 是否需补 | 说明 |
|------|------------|---------|---------|------|
| `vitest` | ❌ | `^4.1.5` | **是** | external 模块和测试依赖 vitest 运行 |
| `react-test-renderer` | ❌ | `^19.2.1` | **是** | 测试所需，renderer 组件测试 |
| `@types/react-test-renderer` | ❌ | `^19.1.0` | **是** | TypeScript 类型定义 |
| `@types/node` | ❌ | `^25.7.0` | 视需求 | 如果 external 中无 Node 特定代码则不需要 |
| `prettier` | ✅ | `^3.7.4` | 否 | Center 已有，版本可对齐 |

**操作建议**：
- 在 Center 的 `package.json` 中只追加 `vitest`、`react-test-renderer`、`@types/react-test-renderer`
- 不要覆盖 Center 已有的其他依赖版本

### 9.3 额外文件

| 文件 | 处理 |
|------|------|
| `package-lock.json` | 不迁移（Center 使用 bun，保留 `bun.lock`） |
| `bun.lock` | 不迁移（各自锁定） |

---

## 十、路由与导航映射表

> 下面列出 CPAMC 所有新增页面路由、对应目标路径、以及导航归属。

### 10.1 新增路由（全部指向 `frontend/src/external/pages/`）

| CPA 当前路由 | external 目标页面 | 说明 |
|-------------|------------------|------|
| `/ai-providers` | `frontend/src/external/pages/AiProvidersPage.tsx` | AI Provider 总览列表（替换 Center 的 `/ai-providers` 单页） |
| `/ai-providers/gemini/new` | `frontend/src/external/pages/AiProvidersGeminiEditPage.tsx` | 新建 Gemini |
| `/ai-providers/gemini/:index` | `frontend/src/external/pages/AiProvidersGeminiEditPage.tsx` | 编辑 Gemini |
| `/ai-providers/codex/new` | `frontend/src/external/pages/AiProvidersCodexEditPage.tsx` | 新建 Codex |
| `/ai-providers/codex/:index` | `frontend/src/external/pages/AiProvidersCodexEditPage.tsx` | 编辑 Codex |
| `/ai-providers/claude/new` | `frontend/src/external/pages/AiProvidersClaudeEditLayout.tsx` | 新建 Claude 布局 |
| `/ai-providers/claude/new` (子) | `frontend/src/external/pages/AiProvidersClaudeEditPage.tsx` | Claude 编辑（含模型） |
| `/ai-providers/claude/:index` | `frontend/src/external/pages/AiProvidersClaudeEditLayout.tsx` | 编辑 Claude 布局 |
| `/ai-providers/claude/:index` (子) | `frontend/src/external/pages/AiProvidersClaudeEditPage.tsx` | Claude 编辑 |
| `/ai-providers/claude/:index/models` | `frontend/src/external/pages/AiProvidersClaudeModelsPage.tsx` | Claude 模型管理 |
| `/ai-providers/vertex/new` | `frontend/src/external/pages/AiProvidersVertexEditPage.tsx` | 新建 Vertex |
| `/ai-providers/vertex/:index` | `frontend/src/external/pages/AiProvidersVertexEditPage.tsx` | 编辑 Vertex |
| `/ai-providers/openai/new` | `frontend/src/external/pages/AiProvidersOpenAIEditLayout.tsx` | 新建 OpenAI 布局 |
| `/ai-providers/openai/:index` | `frontend/src/external/pages/AiProvidersOpenAIEditLayout.tsx` | 编辑 OpenAI 布局 |
| `/ai-providers/openai/:index/models` | `frontend/src/external/pages/AiProvidersOpenAIModelsPage.tsx` | OpenAI 模型管理 |
| `/ai-providers/ampcode` | `frontend/src/external/pages/AiProvidersAmpcodeEditPage.tsx` | Ampcode 编辑 |
| `/monitoring` | `frontend/src/external/pages/MonitoringCenterPage.tsx` | 监控中心 |
| `/monitoring/codex-inspection` | `frontend/src/external/pages/CodexInspectionPage.tsx` | Codex 巡检 |
| `/realtime/request` | `frontend/src/external/features/requestMonitor/RequestMonitorPage.tsx` | 实时请求监控 |

### 10.2 新增导航项（需注入到 `MainLayout.tsx`）

| 路径 | 导航标签 key | 图标 | 分组 | 触发条件 |
|------|-------------|------|------|---------|
| `/ai-providers` | `nav.ai_providers` | `sidebarIcons.aiProviders` | gateway | 替换 Center 原有 AI Providers 页 |
| `/realtime/request` | `nav.realtime_monitor` | `sidebarIcons.monitoring` | gateway | 始终显示 |
| `/monitoring` | `nav.monitoring_center` | `sidebarIcons.monitoring` | observe | 仅在 requestMonitoring 可用时显示 |
| `/monitoring/codex-inspection` | — | — | — | 不单独显示导航，入口在监控中心页面内 |

### 10.3 Center 路由改动对比

| Center 当前 | CPA 版本 | 冲突 | 处理 |
|------------|---------|------|------|
| `/ai-providers` → `ProvidersWorkbenchPage` | `/ai-providers` → `AiProvidersPage`（新增子路由） | 是 | external 页面接管该路由路径 |
| 无 `/monitoring` 路由 | 新增 `/monitoring` 和子路由 | 否 | 纯新增，追加到路由表 |
| 无 `/realtime/request` 路由 | 新增 `/realtime/request` | 否 | 纯新增 |
| `/service-providers` → `ServiceProvidersPage` | 同 Center 路径，但 CPA 额外有 hooks/utils | 轻微 | 保留 Center 入口，external 补充增量 |

---

## 十一、i18n 注入策略

### 注入方案

1. **提取增量**：从 `frontend/src/i18n/locales/*.json`（CPA 版本）中仅提取 Center 版本不存在的 key
2. **放 `frontend/src/external/i18n/locales/`**
3. **运行时注入**：在 external 模块初始化时调用 `i18next.addResourceBundle()`

### 约束

- 不修改 `frontend/src/i18n/locales/*.json`
- 不修改 `frontend/src/i18n/index.ts`
- 增量 key 不与 Center 已有 key 重名（如重名则以 Center 为准）

---

## 十二、类型扩展策略

| Center 文件 | CPA 新增字段 | 扩展方式 | 存放位置 |
|------------|------------|---------|---------|
| `frontend/src/types/provider.ts` | `headers?: Record<string, string>` | 交叉类型 `ExtendedProvider` | `frontend/src/external/types/provider.ts` |
| `frontend/src/types/config.ts` | `clean?`, `usageStatisticsEnabled?` 等 | 交叉类型 `ExtendedAppConfig` | `frontend/src/external/types/config.ts` |
| `frontend/src/types/authFile.ts` | 字段扩展 | 交叉类型 | `frontend/src/external/types/authFile.ts` |
| `frontend/src/types/visualConfig.ts` | 字段扩展 | 交叉类型 | `frontend/src/external/types/visualConfig.ts` |
| `frontend/src/types/sourceInfo.ts` | 纯新增 | 直接定义 | `frontend/src/external/types/sourceInfo.ts` |

---

## 十三、实施边界与验收标准

### 13.1 禁止修改的配置文件

| 文件 | 差异存在？ | 说明 |
|------|----------|------|
| `vite.config.ts` | 无差异 | 完全一致 |
| `eslint.config.js` | 无差异 | 完全一致 |
| `tsconfig.json` | 仅多 `types: ["vite/client"]` | 如 external 编译报类型错误，可申请追加 |
| `tsconfig.node.json` | 仅多 declaration 输出 | 如 external 不需要声明文件输出，不修改 |

### 13.2 允许谨慎修改的壳层文件

| 文件 | 改动范围 |
|------|---------|
| `frontend/src/main.tsx` | 追加 external 初始化调用，<= 3 行 |
| `frontend/src/router/MainRoutes.tsx` | 追加 external 路由，不对 Center 已有路由做结构性改动 |
| `frontend/src/components/layout/MainLayout.tsx` | 追加 external 导航项，不改变现有导航分组结构 |
| `package.json` | 仅追加 external 所需依赖，不升级已有依赖 |

### 13.3 验收检查清单

| # | 验收项 | 通过标准 |
|---|-------|---------|
| 1 | external 隔离 | 所有 CPA 增量代码在 `frontend/src/external/` 和 `backend/` 目录下 |
| 2 | Center 主题不变 | 页面打开后色彩、字体、间距、圆角等与 Center 原版一致 |
| 3 | Center 样式不变 | 社区原有页面渲染效果与迁移前无差异 |
| 4 | 壳层改动最小 | `git diff` 仅包含 4 个壳层文件 + external 新增 |
| 5 | 新增路由可访问 | `/monitoring`、`/ai-providers/gemini/new` 等新路由在浏览器可正常访问 |
| 6 | 新增导航可见 | 导航栏出现 `monitoring_center`、`realtime_monitor` 等新菜单项 |
| 7 | i18n 正常 | 切换语言后 external 页面文案同步切换 |
| 8 | 编译通过 | `bun run build` 成功 |
| 9 | 类型检查通过 | `tsc --noEmit` 无错误 |
| 10 | 测试通过 | `bun test` 或 `vitest run` 通过 |
| 11 | 无社区无关改动 | `git diff` 中不存在对 Center 现有组件的无意修改 |
| 12 | Center 原有路由正常 | `/`、`/config`、`/auth-files`、`/oauth` 等核心路由可访问 |

### 13.4 Git 分支策略

- 在 Center 仓库中基于 `main` 创建 `feat/cpa-integration` 分支
- 迁移完成后，分支中的 diff 应清晰分为两类：
  1. `frontend/src/external/` 和 `backend/` — 增量功能代码（大面积）
  2. 壳层桥接（小范围，每文件 <= 30 行变动）
- 每个提交应标注是来自 CPAMC 的移植

---

## 十四、文档版本

| 版本 | 日期 | 变更 |
|------|------|------|
| 0.1 | 2026-06-15 | 初稿：背景 + 四种方案分析 |
| 0.2 | 2026-06-15 | 补充方案 A 文件改动评估 |
| 0.3 | 2026-06-16 | 补充增量隔离清单、依赖差异、路由映射、i18n策略、类型扩展、验收标准 |

---

## 十五、authFiles 功能增量清单（续）

> 本节补充 `frontend/src/features/authFiles/` 相关的功能差异，这些在原文档中被低估了。

### 15.1 纯新增文件（必须迁移）

| 文件 | 说明 |
|------|------|
| `frontend/src/features/authFiles/sessionAuthConverter.ts` + `.test.ts` | Session Auth 转换器，将外部 auth json 转换为 CPA 格式 |
| `frontend/src/features/authFiles/components/AuthJsonPasteModal.tsx` + `.module.scss` + `.test.tsx` | Auth JSON 粘贴弹窗 |
| `frontend/src/features/authFiles/hooks/useAuthFilesData.test.ts` | 测试文件 |

### 15.2 已有文件的功能性差异（非样式）

| CPA 改动 | 差异内容 | 隔离建议 |
|---------|---------|---------|
| `constants.ts` | 新增 `isHealthyAuthFile()` 辅助函数 | 将该函数提取到 external |
| `uiState.ts` | 排序模式从 3 种扩展到 8 种；新增 `AUTH_FILES_VIEW_MODES`（diagram/list）；新增 `viewMode`、`healthyOnly` 状态 | 将扩展的状态放 external |
| `useAuthFilesData.ts` | 新增 `loadFiles({ throwOnError })` 参数；新增 `savePastedAuthJson()` 方法；新增 `healthyOnly` 筛选；新增 `authJsonPasteSaving` 状态 | 将 hook 扩展版放入 external，不改社区原 hook |
| `useAuthFilesPrefixProxyEditor.ts` | 细微调整（1 行差异） | 可忽略，沿用社区版 |
| `AuthFileCard.tsx` | 新增 `projectIdValue` 字段展示；新增健康状态卡片样式；按钮展 logic 调整 | 展示层差异，不改社区组件，external 如需要则另建卡片组件 |
| `AuthFileQuotaSection.tsx` | 字段/样式调整 | 同上 |
| `AuthFilesPrefixProxyEditorModal.tsx` | 细微调整 | 可忽略 |

### 15.3 实施建议

1. **不修改社区 `frontend/src/features/authFiles/` 下的任何已有文件**
2. **CPA 的 authFiles 增量能力全部放入**：
   ```
   src/external/features/authFiles/
   ├── sessionAuthConverter.ts        # 复制
   ├── sessionAuthConverter.test.ts   # 复制
   ├── components/
   │   ├── AuthJsonPasteModal.tsx     # 复制
   │   ├── AuthJsonPasteModal.module.scss
   │   └── AuthJsonPasteModal.test.tsx
   ├── hooks/
   │   └── useAuthFilesDataExternal.ts  # 重写，依赖社区的 useAuthFilesData 但扩展功能
   ├── uiState.ts                     # 复制 CPA 版或按需重写
   └── constants.ts                   # 只复制 isHealthyAuthFile 等 CPA 特有函数
   ```
3. **调用链**：如果 external 页面需要 authFiles 功能，通过传入或组合的方式调用社区原 hook，而不是覆盖它。

---

## 十六、serviceProviders 页面差异

### 16.1 当前状态

- CPA 中 `frontend/src/features/serviceProviders/ServiceProvidersPage.tsx` 已被大幅改造
- 它现在 import 的是 `./ui/*`、`./utils/*`、`./types` 等相对路径而不是 `@/features/providers/*` 的绝对路径
- 这意味着 CPA 版的 ServiceProvidersPage 已经是独立实现

### 16.2 策略

| 做法 | 说明 |
|------|------|
| 方案 A：直接替换 | 将 CPA 整个 `ServiceProvidersPage.tsx` 复制到 external，MainRoutes 仍然指向它 |
| 方案 B：保留社区页 | 只用 CPA 的 hooks/ui/utils，页面层仍然用社区原版（当前文档倾向这个） |

**更推荐方案 A**，因为：
- CPA 页面本体已有大量自定义逻辑，包括新增的 API Key 测试、拉取模型功能等
- 强行把子模块塞给社区页面会导致组件传参、数据流、样式的适配成本很高
- 社区后续升级 providers 相关功能时，serviceProviders 作为独立 feature 更容易解耦

---

## 十七、hooks 目录差异

### 17.1 `frontend/src/hooks/index.ts`

| 差异 | 说明 |
|------|------|
| 新增 `useApi`、`useDebounce`、`usePagination` 导出 | 必须迁移到 external |

### 17.2 `frontend/src/hooks/useVisualConfig.ts`

| 差异 | 说明 |
|------|------|
| 新增 `usageStatisticsEnabled` 校验 | 属于 usage 配置链，配置链路改动需慎重 |
| 新增 `redisUsageQueueRetentionSeconds` 校验 | 同上 |
| 校验函数实现差异（从 `getNonNegativeIntegerError` 改为 `getRedisUsageQueueRetentionError`） | 函数实现层面差异 |

### 17.3 策略

- **不修改社区的 `useVisualConfig.ts`**
- 如需支持 usage 相关配置项，在 external 单独实现配置解析逻辑
- 示例：在 external 的 config store 或配置页中读取和验证这些字段

---

## 十八、首轮明确不迁移的功能性差异

以下差异在原文档中被归为“样式/布局”，但实际属于**行为/交互层**差异。首轮迁移时不处理，保持用社区版本。

| 文件 | 差异性质 | 首轮策略 |
|------|---------|---------|
| `frontend/src/components/common/PageTransition.tsx` | 146 行 diff，动画行为差异 | 不迁移，继续用社区版 |
| `frontend/src/features/authFiles/components/AuthFileCard.tsx` | 展示逻辑和行为调整 | 不迁移，external 如需要则另建 |
| `frontend/src/features/serviceProviders/ServiceProvidersPage.tsx` | 页面本体改造 | 迁移到 external |
| `frontend/src/utils/quota/providers/` | Codex 额度相关逻辑 | 迁移（已有） |
| `frontend/src/services/api/version.ts` 的 `checkManagerLatest` | GitHub API 调用，非核心功能 | 标记为“可选迁移” |

---

## 十九、其他补充说明

### 19.1 图标策略

- CPA 新增页面可能需要新图标（如 monitoring、realtime）
- **不要修改社区 `frontend/src/components/ui/icons.tsx`**
- 在 `frontend/src/external/components/ui/icons.tsx` 中定义 external 专用图标

### 19.2 版本检查功能

- `frontend/src/services/api/version.ts` 中的 `checkManagerLatest` 访问 GitHub API
- 属于非核心功能，**首轮可暂不迁移**
- 如后续需要，在 external 中单独实现

### 19.3 @types/node 依赖

- 当前 CPA 测试文件和部分工具可能引用 Node 类型
- **默认不添加到 Center**，只有在 `tsc --noEmit` 报错时再追加

---

## 二十、勘误对照表

| 原文档表述 | 修正后 |
|-----------|-------|
| `frontend/src/features/authFiles/` 只提 `sessionAuthConverter.ts` | 补充完整的 authFiles 增量清单（15.1–15.3） |
| `frontend/src/features/serviceProviders/` 只搬子目录 | 明确页面本体也要迁移（方案 A） |
| `frontend/src/hooks/index.ts` 无差异 | 补充新增导出项（17.1） |
| `frontend/src/hooks/useVisualConfig.ts` 无差异 | 补充配置校验差异（17.2） |
| `frontend/src/components/common/PageTransition.tsx` 归为样式差异 | 改为“行为/交互差异，首轮不迁移” |
| `@types/node` “视需求” | 明确“默认不加，报错再加” |
| 缺少图标策略 | 补充 19.1 节 |

---

## 二十一、文档版本（续）

| 版本 | 日期 | 变更 |
|------|------|------|
| 0.1 | 2026-06-15 | 初稿：背景 + 四种方案分析 |
| 0.2 | 2026-06-15 | 补充方案 A 文件改动评估 |
| 0.3 | 2026-06-16 | 补充增量隔离清单、依赖差异、路由映射、i18n策略、类型扩展、验收标准 |
| 0.4 | 2026-06-16 | 补充 authFiles 增量、serviceProviders 页面差异、hooks 差异、勘误对照表 |
