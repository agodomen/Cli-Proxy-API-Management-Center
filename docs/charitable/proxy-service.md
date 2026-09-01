# 本机代理服务

## 概述

本机代理服务是 CPA 管理中心的二开功能，允许在管理面板中启动一个轻量级本机代理服务。该服务支持 SOCKS5/HTTP 代理和 Shadowsocks AEAD 加密隧道，所有逻辑通过 Go 原生实现，不依赖外部进程。

## 功能

### 协议支持

| 模式 | 加密 | 协议 | 说明 |
|------|------|------|------|
| 无加密 | none | SOCKS5 + HTTP | 单端口自动嗅探协议，支持用户名/密码认证 |
| Shadowsocks AEAD | aes-128-gcm | SS TCP + UDP | 标准 Shadowsocks AEAD 2017 |
| Shadowsocks AEAD | aes-256-gcm | SS TCP + UDP | 标准 Shadowsocks AEAD 2017 |
| Shadowsocks AEAD | chacha20-ietf-poly1305 | SS TCP + UDP | 标准 Shadowsocks AEAD 2017 |

### 配置持久化

服务配置持久化到 SQLite settings 表，key 为 `charitable.proxy.service.v1`：

```json
{
  "listen_addr": "127.0.0.1",
  "tcp_port": 1080,
  "udp_port": 0,
  "password": "",
  "encryption_method": "none",
  "auto_register": false,
  "enabled": false
}
```

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/v0/cpamc/charitable/proxies/service` | 获取配置和运行状态 |
| PUT | `/v0/cpamc/charitable/proxies/service` | 更新配置（enabled 变化时自动启停） |
| POST | `/v0/cpamc/charitable/proxies/service/start` | 启动服务 |
| POST | `/v0/cpamc/charitable/proxies/service/stop` | 停止服务 |
| POST | `/v0/cpamc/charitable/proxies/service/restart` | 重启服务 |

所有端点需要管理密钥认证。

### 虚拟系统节点

当服务运行且 `auto_register` 开启时，代理节点列表会自动注入一个虚拟系统节点：

- `proxy_index`: `system:local-proxy-service`
- `proxy_type`: SOCKS5 (无加密) 或 Shadowsocks (有加密)
- `proxy_info`: `{"privacy":"local","source":"system","service":"local-proxy"}`
- `privacy=local` 确保 Clash 导出自动跳过该节点
- 节点不持久化到数据库，服务停止后自动消失
- 节点支持探测连通性（通过 `handleProxyProbe` 注入）

## 安全设计

- 默认监听 `127.0.0.1`，仅本机可访问
- 非 loopback 监听地址必须设置密码
- 密码持久化到 SQLite，不会每次启动变化
- SS 加密模式必须设置密码
- 所有启停操作需要管理密钥认证
- 进程退出时优雅关闭所有监听器（`cmd/cpamc` 退出钩子）

## 技术实现

### 加密库

使用 Go 标准库和 `golang.org/x/crypto`：

- `crypto/aes` + `crypto/cipher` (GCM) — AES-128-GCM, AES-256-GCM
- `golang.org/x/crypto/chacha20poly1305` — ChaCha20-IETF-Poly1305
- `golang.org/x/crypto/hkdf` — 会话子密钥派生
- `crypto/rand` — 盐值和随机数生成

### Shadowsocks AEAD 协议

- 密钥派生: EVP_BytesToKey (MD5+SHA1)
- 会话子密钥: HKDF-SHA256, info="ss-subkey"
- TCP: 每个方向独立 nonce 计数器，从 0 开始
- TCP 数据块格式: `[2字节长度+AEAD tag][payload+AEAD tag]`
- UDP: 每个数据包独立 salt + nonce=0

### 文件结构

```
backend/internal/core/proxy/service/
├── service.go          # 服务生命周期管理 (Start/Stop/Restart/Shutdown)
├── cipher.go           # SS AEAD 密码套件、密钥派生、会话 AEAD
├── ss_tcp.go           # Shadowsocks TCP 中继
├── ss_udp.go           # Shadowsocks UDP 中继
├── socks5.go           # SOCKS5 服务器 (RFC 1928/1929)
├── httpproxy.go        # HTTP 代理 (CONNECT + forward)
├── tcp.go              # TCP accept 循环 + 协议嗅探
├── crypto_util.go      # 随机数辅助函数
└── *_test.go           # 单元测试和端到端测试
```
