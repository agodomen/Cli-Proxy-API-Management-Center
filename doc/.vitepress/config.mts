import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type DefaultTheme } from 'vitepress'

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const siteBase = process.env.DOCS_BASE || '/'

const directoryLabels: Record<string, string> = {
  problems: '历史问题',
  'pull-requests': 'Pull Request 记录',
  solutions: '历史解决方案',
}

const serviceMenuItems: DefaultTheme.SidebarItem[] = [
  { text: '运行总览', link: '/services/operate/dashboard' },
  { text: 'AI 提供商', link: '/services/gateway/ai-providers' },
  { text: '认证文件', link: '/services/gateway/auth-files' },
  { text: 'OAuth 登录', link: '/services/gateway/oauth' },
  { text: '配额管理', link: '/services/observe/quota' },
  { text: '日志查看', link: '/services/observe/logs' },
  { text: '配置面板', link: '/services/control/config' },
  { text: '插件管理', link: '/services/control/plugins' },
  { text: '插件商店', link: '/services/control/plugin-store' },
  { text: '中心信息', link: '/services/control/system' },
  { text: '请求监控', link: '/services/operations/monitoring' },
  { text: '实时监控', link: '/services/operations/realtime-request' },
  { text: '巡检管理', link: '/services/operations/inspection' },
  { text: '密钥管理', link: '/services/operations/service-providers' },
  { text: '词元中心', link: '/services/charitable/token-center' },
  { text: '代理管理', link: '/services/charitable/proxies' },
  { text: '调试开发', link: '/services/charitable/debug' },
  { text: '系统设置', link: '/services/system/settings' },
  { text: '其他其它', link: '/services/other/' },
]

const sidebarSections = [
  { text: '背景现状', sources: [{ directory: 'background', route: '/background' }] },
  { text: '功能服务', sources: [{ directory: 'services', route: '/services' }] },
  { text: '架构设计', sources: [{ directory: 'architecture', route: '/architecture' }] },
  { text: '数据模型', sources: [{ directory: 'sqlite', route: '/sqlite' }] },
  { text: '开发记录', sources: [{ directory: 'development', route: '/development' }] },
  { text: '里程碑', sources: [{ directory: 'milestones', route: '/milestones' }] },
  {
    text: '归档文档',
    sources: [
      { directory: 'archive', route: '/archive' },
      { directory: 'history', route: '/history' },
    ],
  },
] as const

const titleOf = (file: string) => {
  const source = fs.readFileSync(file, 'utf8')
  return source.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(file, '.md')
}

const itemsIn = (directory: string, routePrefix: string): DefaultTheme.SidebarItem[] => {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? 1 : -1
      if (left.name === 'index.md') return -1
      if (right.name === 'index.md') return 1
      return left.name.localeCompare(right.name, 'zh-CN')
    })
    .flatMap((entry): DefaultTheme.SidebarItem[] => {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        const children = itemsIn(fullPath, `${routePrefix}/${entry.name}`)
        return children.length ? [{ text: directoryLabels[entry.name] || entry.name, collapsed: true, items: children }] : []
      }
      if (!entry.name.endsWith('.md')) return []
      const name = entry.name.slice(0, -3)
      return [{ text: titleOf(fullPath), link: name === 'index' ? `${routePrefix}/` : `${routePrefix}/${name}` }]
    })
}

const sidebar: DefaultTheme.SidebarItem[] = sidebarSections
  .map((section) => ({
    text: section.text,
    collapsed: section.text === '归档文档',
    items: section.text === '功能服务'
      ? serviceMenuItems
      : section.sources.flatMap(({ directory, route }) => itemsIn(path.join(docsRoot, directory), route)),
  }))
  .filter((section) => section.items.length > 0)

export default defineConfig({
  lang: 'zh-CN',
  title: '工具猿',
  titleTemplate: ':title | amonkey-tools',
  description: 'amonkey-tools 工具、项目与开发文档站',
  base: siteBase,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${siteBase}favicon.svg` }],
  ],
  cleanUrls: true,
  lastUpdated: true,
  // 历史方案中的相对 src/ 路径是源码引用，不是文档站路由。
  ignoreDeadLinks: [/^(?:\.{1,2}\/)+src\//],
  srcExclude: ['node_modules/**'],
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      {
        text: '项目动态',
        items: [
          { text: '最新功能', link: '/milestones/features' },
          { text: '最新修复', link: '/milestones/fixes' },
        ],
      },
      {
        text: '关于站点',
        items: [
          { text: '站点指南', link: '/about/guide' },
          { text: '站点参考', link: '/about/references' },
          { text: '站点应用', link: '/about/applications' },
          { text: '站点变更', link: '/about/changelog' },
        ],
      },
    ],
    sidebar,
    search: { provider: 'local' },
    outline: { level: [2, 3], label: '页面导航' },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新' },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/agodomen/Cli-Proxy-API-Management-Center' },
    ],
  },
})
