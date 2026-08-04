# CPAMC 迁移到 Cli-Proxy-API-Management-Center 执行计划

## 目标

将 CPAMC 的代码以"加法式"迁移到 Center 项目的 `feat/cpa-integration` 分支，
尽量不改动 Center 原有代码，保持社区风格和布局不变。

---

## 总体约束

- Center 现有文件只允许改 4 个桥接文件：`frontend/src/main.tsx`、`frontend/src/router/MainRoutes.tsx`、`frontend/src/components/layout/MainLayout.tsx`、`package.json`
- 所有 CPA 新增代码放 `frontend/src/external/`
- 样式隔离：不污染社区原有 SCSS/CSS 变量和布局
- i18n 注入方式：`addResourceBundle`，不改社区 locale JSON

---

## 阶段与验收计划

### 阶段 1：项目初始化与基础设施

**目标**：在 Center 新分支上创建目录结构，接入外部服务配置。

| 任务                                                                                             | 验收标准 |
|--------------------------------------------------------------------------------------------------|---------|
| 创建 `frontend/src/external/` 目录结构                                                                    | 目录结构符合 plan.md 约定 |
| 将usage-service的目录搬迁 `backend/` Go 后端目录                                                | `go build` 编译通过 |
| 搬迁 `Dockerfile.usage-service` 到 `.devcontainer/` 目录，并修改`Dockerfile.usage-service`的内容 | `docker build -f .devcontainer/Dockerfile.usage-service` 镜像构建成功 |
| 搬迁 `docker-compose.usage.yml` 到 `.devcontainer/` 目录，并修改`docker-compose.usage.yml`的内容 | `docker compose config` 配置校验通过 |
| 搬迁 `.dockerignore` 到 `.devcontainer/` 目录                                                    | 文件存在且规则正确 |
| 搬迁 `bin/release` 脚本                                                                          | 脚本存在且可执行 |
| 搬迁 `start-usage.sh` / `start-usage.bat`                                                        | 脚本存在且可执行 |

**验收命令**：
```bash
cd services && go build ./...
docker compose -f .devcontainer/docker-compose.usage.yml config
```

---

### 阶段 2：独立模块搬迁（无 UI 依赖）

**目标**：搬迁不依赖 UI 的工具层、类型、hooks、stores、services。

| 任务 | 验收标准 |
|------|---------|
| 搬迁 `frontend/src/external/utils/` 工具函数（apiKeyHash, sourceResolver, usage 等） | 每个文件 TypeScript 编译通过，单测通过 |
| 搬迁 `frontend/src/external/utils/quota/` 额度相关工具 | 单测通过 |
| 搬迁 `frontend/src/external/types/` 扩展类型定义 | TypeScript 无类型错误 |
| 搬迁 `frontend/src/external/hooks/` 自定义 hooks（useApi, useDebounce, usePagination） | 编译通过 |
| 搬迁 `frontend/src/external/stores/` 新增 store | 编译通过 |
| 搬迁 `frontend/src/external/backend/api/` API 层 | 编译通过 |
| 搬迁 `frontend/src/external/i18n/` 增量语言包 | 文件完整，JSON 格式正确 |

**验收命令**：
```bash
npx tsc --noEmit
npx vitest run
```

---

### 阶段 3：组件搬迁（有 UI，但无路由依赖）

**目标**：搬迁独立组件，这些组件不依赖社区页面，但会被阶段 4 的页面引用。

| 任务 | 验收标准 |
|------|---------|
| 搬迁 `frontend/src/external/components/ui/` 新增 UI 组件（DropdownMenu, HeaderInputList, ModelInputList） | 编译通过，样式模块独立 |
| 搬迁 `frontend/src/external/components/providers/` 各 Provider Section 组件 | 编译通过 |
| 搬迁 `frontend/src/external/components/providers/ProviderNav/` Provider 导航组件 | 编译通过 |
| 搬迁 `frontend/src/external/components/providers/ProviderList.tsx` | 编译通过 |
| 搬迁 `frontend/src/external/components/ui/icons.tsx`（如有 CPA 新增图标） | 编译通过 |

**验收命令**：
```bash
npx tsc --noEmit
```

---

### 阶段 4：页面搬迁（依赖阶段 2 和 3）

**目标**：搬迁完整的页面组件，这些页面会由路由引用。

| 任务 | 验收标准 |
|------|---------|
| 搬迁 `frontend/src/external/pages/AiProvidersPage.tsx` + 样式 | 编译通过 |
| 搬迁 `frontend/src/external/pages/AiProviders*EditPage.tsx` 各 Provider 编辑页（8 个） | 编译通过 |
| 搬迁 `frontend/src/external/pages/MonitoringCenterPage.tsx` + 样式 | 编译通过 |
| 搬迁 `frontend/src/external/pages/CodexInspectionPage.tsx` + 样式 | 编译通过 |
| 搬迁 `frontend/src/external/features/serviceProviders/` 完整功能模块 | 编译通过 |
| 搬迁 `frontend/src/external/features/monitoring/` 监控功能模块 | 编译通过 |
| 搬迁 `frontend/src/external/features/requestMonitor/` 请求监控模块 | 编译通过 |
| 搬迁 `frontend/src/external/features/authFiles/` 增量功能（AuthJsonPasteModal 等） | 编译通过 |

**验收命令**：
```bash
npx tsc --noEmit
npx vitest run
```

---

### 阶段 5：路由与导航接入（唯一改动 Center 桥接文件）

**目标**：通过修改 4 个桥接文件，将 external 页面接入主应用路由和导航。

| 任务 | 验收标准 |
|------|---------|
| 修改 `frontend/src/router/MainRoutes.tsx`：追加 external 路由 | `/monitoring`、`/realtime/request` 等新路由可访问 |
| 修改 `frontend/src/components/layout/MainLayout.tsx`：追加 external 导航项 | 侧边栏出现新菜单项，点击跳转正常 |
| 修改 `frontend/src/main.tsx`：初始化 external 模块，注入 i18n | 应用启动无报错，新页面文案正确 |
| 修改 `package.json`：追加依赖（vitest 等） | `npm install` 无报错 |

**验收命令**：
```bash
npx tsc --noEmit
npm run build
```

---

### 阶段 6：整体验收（端到端测试）

**目标**：确保整个应用（原有功能 + CPA 新增功能）正常工作。

| 任务 | 验收标准 |
|------|---------|
| 原有社区页面功能正常 | Dashboard、AuthFiles、Config、System 等页面功能无退化 |
| 新增监控页面功能正常 | `/monitoring` 页面展示数据，图表渲染正确 |
| 新增实时监控页面功能正常 | `/realtime/request` 表格正常，5 秒自动刷新生效 |
| 新增 Provider 编辑页面功能正常 | `/ai-providers/gemini/new` 等编辑页正常打开 |
| 新增服务商管理页面功能正常 | `/service-providers` 页面正常 |
| i18n 语言切换正常 | 切换语言后新页面文案同步更新 |
| 样式隔离验证 | 社区原有页面颜色、间距、布局无变化 |
| `services` 集成验证 | Go 后端启动后，前端能正常连接并获取数据 |
| 移动端/响应式验证 | 新页面在移动端布局正常 |
| 全量测试通过 | `npm run build` 无警告，`vitest run` 全部通过 |

**验收命令**：
```bash
# 1. 构建验证
npm run build

# 2. 类型检查
npx tsc --noEmit

# 3. 单元测试
npx vitest run

# 4. 端到端手动验证（打开浏览器逐页检查）
#    - 访问 /monitoring，确认图表和表格正常
#    - 访问 /realtime/request，确认表格和自动刷新正常
#    - 访问 /ai-providers，确认各 Provider 编辑页正常
#    - 访问 /service-providers，确认服务商页面正常
#    - 切换语言（中/英），确认新页面文案同步
#    - 对比社区原有页面样式，确认无视觉变化

# 5. 样式对比验证（截图对比或视觉回归测试）
```

---

## 执行顺序

```
阶段 1 (基础设施)
  └─→ 阶段 2 (独立模块)
        └─→ 阶段 3 (组件)
              └─→ 阶段 4 (页面)
                    └─→ 阶段 5 (桥接接入)
                          └─→ 阶段 6 (整体验收)
```

---

## 进度追踪

| 阶段 | 状态 | 备注 |
|------|------|------|
| 阶段 1：基础设施 | ⬜ 待开始 | |
| 阶段 2：独立模块 | ⬜ 待开始 | |
| 阶段 3：组件 | ⬜ 待开始 | |
| 阶段 4：页面 | ⬜ 待开始 | |
| 阶段 5：桥接接入 | ⬜ 待开始 | |
| 阶段 6：整体验收 | ⬜ 待开始 | |

---

## 文件清单速查

### 放入 `frontend/src/external/` 的目录
```
src/external/
├── components/
│   ├── providers/     ← 各 Provider Section 组件
│   └── ui/            ← 新增 UI 组件
├── features/
│   ├── monitoring/    ← 监控功能模块
│   ├── requestMonitor/ ← 请求监控
│   └── serviceProviders/ ← 服务商管理
├── hooks/             ← 自定义 hooks
├── i18n/              ← 增量语言包
├── pages/             ← 新增页面
├── backend/
│   └── api/           ← API 层
├── stores/            ← 新增 store
├── styles/            ← 独立样式
└── types/             ← 扩展类型
```

### 放入项目根目录的
```
backend/                  ← Go 后端
.devcontainer/docker-compose.usage.yml  ← Docker 配置
.devcontainer/Dockerfile.usage-service  ← Docker 镜像
.devcontainer/.dockerignore     ← Docker 忽略
bin/release                     ← 发布脚本
start-usage.sh / start-usage.bat ← 启动脚本
```
