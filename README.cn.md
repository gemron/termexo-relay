# termexo-relay

[English](README.md) | **简体中文**

[Termexo](https://github.com/gemron/Termexo) 的中继服务。桌面端主动向它建立一条出站隧道，手机或另一台
电脑就能通过 `https://<中继>/d/<deviceId>/` 打开那台电脑上完整的 Termexo 工作台——不需要公网 IP，也不
需要在路由器上开端口。

隧道协议、流前导与设备凭据格式定义在共用 crate `termexo-relay-protocol` 里。它归
[Termexo](https://github.com/gemron/Termexo) 仓库所有——桌面端也要编译同一份——本仓库通过 git 依赖引用
它，设计文档 [`docs/architecture/relay-service.md`](https://github.com/gemron/Termexo/blob/main/docs/architecture/relay-service.md)
也在那边。

> 管理控制台跟随浏览器语言，提供简体中文与英文。服务端自己产生的内容——API 报错、设备离线与无权访问
> 页面、日志以及首次管理员密码的提示——都是简体中文。

## 目录

- [工作原理](#工作原理)
- [安装](#安装)
- [快速上手：一分钟在局域网跑起一台中继](#快速上手一分钟在局域网跑起一台中继)
- [命令参考](#命令参考)
  - [`serve`](#serve)
  - [`link`](#link)
  - [`admin reset-password`](#admin-reset-password)
- [部署场景](#部署场景)
- [日常运维](#日常运维)
- [数据目录的权限](#数据目录的权限)
- [停止](#停止)
- [开发](#开发)
- [已知限制](#已知限制)

## 工作原理

```
 手机 / 笔记本浏览器                    中继                        桌面端 Termexo
 ─────────────────────   https   ─────────────────    出站连接    ─────────────────
 https://中继/d/<id>/   ───────▶  termexo-relay   ◀─────────────  /tunnel（WebSocket）
                                  转发字节流        yamux 多路流
```

- 桌面端**主动**连到 `GET /tunnel` 并保持连接，所以在 NAT 和防火墙后面也能用。
- 浏览器对 `/d/<deviceId>/` 的每个请求都顺着这条隧道送到桌面端自己的 Web 服务。中继决定设备**能不能
  到达**；到达之后**能做什么**，仍由桌面端的访问令牌决定。
- 终端流量（`/ws`）用 AES-256-GCM 端到端加密，密钥由桌面端的访问令牌派生，而令牌从不经过中继。中继
  只知道设备何时在线、哪些地址在访问、流量的时间与大小，看不到终端输出、命令，也拿不到令牌。工作台的
  静态文件是明文传输的，它们本来就是公开的应用代码。

## 安装

### 预编译产物

每打一个 `v*` tag，CI 会在各自架构的原生构建机上编译下列目标，连同一份 `SHA256SUMS` 发到
[Releases](https://github.com/gemron/termexo-relay/releases)。归档里是可执行文件和 README，解压即可
运行，没有别的运行时依赖。

| 操作系统 | 架构 | 归档 | target triple |
| --- | --- | --- | --- |
| Linux（glibc） | x86-64 | `.tar.gz` | `x86_64-unknown-linux-gnu` |
| Linux（glibc） | ARM64 | `.tar.gz` | `aarch64-unknown-linux-gnu` |
| Linux（musl，静态链接） | x86-64 | `.tar.gz` | `x86_64-unknown-linux-musl` |
| Linux（musl，静态链接） | ARM64 | `.tar.gz` | `aarch64-unknown-linux-musl` |
| macOS | Intel | `.tar.gz` | `x86_64-apple-darwin` |
| macOS | Apple Silicon | `.tar.gz` | `aarch64-apple-darwin` |
| Windows | x86-64 | `.zip` | `x86_64-pc-windows-msvc` |
| Windows | ARM64 | `.zip` | `aarch64-pc-windows-msvc` |

在 Linux x86-64 上下载、校验并安装：

```bash
VERSION=0.10.2
TARGET=x86_64-unknown-linux-gnu
curl -LO "https://github.com/gemron/termexo-relay/releases/download/v${VERSION}/termexo-relay-${VERSION}-${TARGET}.tar.gz"
curl -LO "https://github.com/gemron/termexo-relay/releases/download/v${VERSION}/SHA256SUMS"
sha256sum -c SHA256SUMS --ignore-missing
tar -xzf "termexo-relay-${VERSION}-${TARGET}.tar.gz"
sudo install -m 0755 "termexo-relay-${VERSION}-${TARGET}/termexo-relay" /usr/local/bin/
termexo-relay --version
```

两个 musl 版本是静态链接的，不依赖发行版的 glibc 版本，老系统和 Alpine 用它；其余 Linux 场景用 glibc
版本即可。

这张表以外的平台（FreeBSD、32 位 ARM、Linux riscv64 等）**没有预编译产物**，但源码里没有任何平台专有
分支，自行编译通常可行。

### 容器镜像

镜像发布在 GitHub Container Registry，是一份同时包含 `linux/amd64` 与 `linux/arm64` 的 manifest list，
docker 会自动拉取匹配当前机器的那一个：

```bash
docker pull ghcr.io/gemron/termexo-relay:0.10.2
```

| 标签 | 指向 |
| --- | --- |
| `0.10.2` | 这个精确版本 |
| `0.10` | 0.10 版本线的最新发布 |
| `latest` | 最新的发布 tag |
| `main` | `main` 分支最新提交，用于尝鲜，不建议生产使用 |

镜像基于 `debian:bookworm-slim`，SQLite 已经编进二进制，运行时只额外带了 CA 证书。镜像里设置了
`TERMEXO_RELAY_DATA_DIR=/var/lib/termexo-relay`（声明为卷）和 `TERMEXO_RELAY_LISTEN=0.0.0.0:8443`，默认
命令是 `serve`。**没有**再单独出一份 musl/Alpine 镜像：静态二进制在 Releases 里已经有了。

完整示例见[Docker](#docker)和[Docker Compose 加 Caddy](#docker-compose-加-caddy)。

### 从源码构建

只需要两样东西：

- **Rust 工具链**，版本不低于 `Cargo.toml` 里的 `rust-version`（当前 1.88）；
- **一个 C/C++ 编译器**——TLS 用的 `aws-lc-rs` 和 `rusqlite` 的 bundled SQLite 都要编 C。

非 FIPS 构建**不需要** CMake、bindgen 或 Go：`aws-lc-rs` 自带预生成的绑定，Windows x86-64 还有一份预编译
的 NASM 目标兜底。

| 平台 | 需要安装 |
| --- | --- |
| Linux | `build-essential`（gcc）；musl 目标另需 `musl-tools`，它提供 `musl-gcc` |
| macOS | Xcode 命令行工具（`xcode-select --install`） |
| Windows | Visual Studio 2022 生成工具的「使用 C++ 的桌面开发」工作负载（MSVC） |

```bash
cargo build --release                      # 产物 target/release/termexo-relay

# 静态链接的 Linux 二进制：
sudo apt-get install -y musl-tools
rustup target add x86_64-unknown-linux-musl
CC_x86_64_unknown_linux_musl=musl-gcc cargo build --release --target x86_64-unknown-linux-musl
```

这样编出来的二进制里嵌的是控制台**占位页**。要嵌真实控制台，先构建前端再编译（这一步需要 Node）：

```bash
npm --prefix console install
npm --prefix console run build             # 产物 console/dist/relay-console/browser
cargo build --release
```

## 快速上手：一分钟在局域网跑起一台中继

假设中继所在的机器是家里局域网的 `192.168.1.20`，而且没有域名。

1. 用自签名证书（默认的 TLS 模式）启动中继：

   ```bash
   termexo-relay serve \
     --data-dir ./relay-data \
     --public-url https://192.168.1.20:8443
   ```

2. 从输出里记下两样东西。密码**只在第一次启动时打印**，指纹每次启动都会写进日志：

   ```
   ────────────────────────────────────────────
   控制台账号：admin
   一次性密码：K7QD3MTR9WXF2HJN
   请立即登录 /console/ 并修改密码，这条信息只显示一次。
   ────────────────────────────────────────────
   INFO termexo_relay::tls: 自签名证书指纹（SHA-256） fingerprint=45:7C:B9:97:…:1E
   INFO termexo_relay::server: Termexo 中继已启动 listen=0.0.0.0:8443 public_url=https://192.168.1.20:8443 …
   ```

3. 打开 `https://192.168.1.20:8443/console/`，确认证书警告，用 `admin` 登录并修改密码。
4. 进入「**接入码**」页，签发一个 `desktop` 类型的接入码，例如 `ABCD-EFGH-JKLM`。
5. 在桌面端打开 Termexo「**设置 → 远程访问 → 通过中继访问**」，填写：
   - **中继地址**：`https://192.168.1.20:8443`
   - **证书指纹（SHA-256）**：第 2 步里的指纹
   - **接入方式**：选「接入码」，粘贴 `ABCD-EFGH-JKLM`，点「**接入**」
6. 面板上会显示设备地址，例如 `https://192.168.1.20:8443/d/<deviceId>/`，在手机上打开即可。

## 命令参考

```
termexo-relay serve                  启动中继服务
termexo-relay link                   用接入码接入上游中继（只写入配置）
termexo-relay admin reset-password   重置控制台账号的密码
termexo-relay --help | --version
```

`termexo-relay <命令> --help` 会列出某个命令的全部参数。

### `serve`

启动中继：隧道入口、公开反向代理、API 与控制台。

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--data-dir <路径>` | `TERMEXO_RELAY_DATA_DIR` | `relay-data` | SQLite 数据库与自签名证书的存放目录 |
| `--listen <地址:端口>` | `TERMEXO_RELAY_LISTEN` | `0.0.0.0:8443` | 监听地址 |
| `--public-url <地址>` | `TERMEXO_RELAY_PUBLIC_URL` | 由监听地址推导 | 浏览器访问中继用的公开地址 |
| `--tls <模式>` | `TERMEXO_RELAY_TLS` | `self-signed` | `self-signed`、`cert:<证书链>,<私钥>` 或 `off` |
| `--trusted-proxy <网段>` | `TERMEXO_RELAY_TRUSTED_PROXY` | 无 | 受信任的反向代理网段；仅 `--tls off` 时生效 |
| `--subdomain-base <主机名>` | `TERMEXO_RELAY_SUBDOMAIN_BASE` | 无 | 开启 `<deviceId>.<主机名>` 形式的设备地址 |

命令行参数优先于对应的环境变量。

#### `--data-dir`

存放 `relay.db`（用户、设备、接入码、会话、审计、上游链接）的目录；自签名模式下还有 `tls/cert.pem` 与
`tls/key.pem`。目录不存在时自动创建，每次启动都会收紧权限（见[数据目录的权限](#数据目录的权限)）。

```bash
# 服务部署用固定路径
termexo-relay serve --data-dir /var/lib/termexo-relay

# 等价的环境变量写法
TERMEXO_RELAY_DATA_DIR=/var/lib/termexo-relay termexo-relay serve

# Windows 上开发
termexo-relay.exe serve --data-dir "C:\termexo-relay\data"
```

默认值 `relay-data` 是**相对**当前工作目录的路径。启动日志会打印实际使用的绝对路径：

```
INFO termexo_relay::server: 中继数据目录 data_dir=/var/lib/termexo-relay
```

#### `--listen`

```bash
# 所有 IPv4 网卡的 8443 端口（默认）
termexo-relay serve --listen 0.0.0.0:8443

# 只监听本机回环——中继放在同一台机器的 Caddy 或 nginx 后面
termexo-relay serve --listen 127.0.0.1:8443 --tls off

# 换一个端口
termexo-relay serve --listen 0.0.0.0:9443

# IPv6
termexo-relay serve --listen '[::]:8443'
```

1024 以下的端口需要额外权限；默认的 8443 避开了这一点，所以容器不需要额外的 capability。

#### `--public-url`

浏览器看到的源：协议、主机名和可选的端口，**不能带路径、查询串或片段**。中继用它生成所有对外地址——
控制台和桌面端面板里的设备地址、通告给上游中继的地址——也用它决定会话 cookie 要不要带 `Secure`。

```bash
# 反向代理在 443 端口提供的域名
termexo-relay serve --public-url https://relay.example.com

# 带端口的局域网地址
termexo-relay serve --public-url https://192.168.1.20:8443

# 末尾的斜杠可以写，会被去掉
termexo-relay serve --public-url https://relay.example.com/
```

会被拒绝的写法：

| 值 | 报错原因 |
| --- | --- |
| `relay.example.com` | 必须以 `http://` 或 `https://` 开头 |
| `https://relay.example.com/console` | 不能带路径 |
| `https://` | 缺少主机名 |

不设置 `--public-url` 时，中继由 `--listen` 推导：`0.0.0.0:8443` 加 TLS 会变成 `https://localhost:8443`，
其它机器根本打不开——**正式部署一定要设置它**。

#### `--tls`

| 模式 | 适用场景 |
| --- | --- |
| `self-signed` | 没有域名（局域网、VPN、裸 IP）。桌面端按指纹固定证书 |
| `cert:<证书链>,<私钥>` | 已有证书，想让中继自己终止 TLS |
| `off` | 中继放在 Caddy、nginx 等负责 TLS 的反向代理后面 |

```bash
# 自签名（默认）：首次启动生成到 <data-dir>/tls/，之后一直复用
termexo-relay serve --tls self-signed --public-url https://192.168.1.20:8443

# 自己的 PEM 证书链与私钥，用逗号分隔
termexo-relay serve \
  --tls cert:/etc/letsencrypt/live/relay.example.com/fullchain.pem,/etc/letsencrypt/live/relay.example.com/privkey.pem \
  --public-url https://relay.example.com:8443

# 在反向代理后面用明文 HTTP
termexo-relay serve --tls off --listen 127.0.0.1:8443 \
  --public-url https://relay.example.com --trusted-proxy 127.0.0.1/32
```

自签名模式每次启动都会在日志里打印证书的 SHA-256 指纹，也可以直接从文件读：

```bash
openssl x509 -in /var/lib/termexo-relay/tls/cert.pem -noout -fingerprint -sha256
```

证书的主体名称取自 `--public-url`（设置了 `--subdomain-base` 时再加上泛域名）。这两项后来改了，已经
生成的证书**不会自动重签**：停掉中继、删掉 `<data-dir>/tls/` 再启动，然后在各台桌面端重新填入新指纹。

`cert:` 必须同时给出两个路径，只写 `cert:/etc/full.pem` 会被拒绝。中继**不内置 ACME**（Let's Encrypt
自动证书），需要时交给反向代理。

#### `--trusted-proxy`

只在 `--tls off` 时读取。来自这些网段的连接可以通过 `X-Forwarded-For`、`X-Forwarded-Proto`、
`X-Forwarded-Host` 告诉中继真实的来源；其余连接一律以套接字地址为准。不设置的话，反代后面的所有浏览器
看起来都是反代自己的地址，一个人输错密码会把所有人一起锁住。

取值必须是 **CIDR 网段**——写 `127.0.0.1/32`，不能写 `127.0.0.1`。

```bash
# 反代与中继在同一台机器上
termexo-relay serve --tls off --trusted-proxy 127.0.0.1/32

# 多个网段可以重复这个参数……
termexo-relay serve --tls off --trusted-proxy 10.0.0.0/8 --trusted-proxy 172.16.0.0/12

# ……也可以用逗号分隔，环境变量也是这样传多个值
TERMEXO_RELAY_TRUSTED_PROXY=10.0.0.0/8,172.16.0.0/12 termexo-relay serve --tls off

# IPv6 回环
termexo-relay serve --tls off --trusted-proxy ::1/128
```

在 Docker 里，填反代容器所在的桥接网络，例如 `172.16.0.0/12`。

#### `--subdomain-base`

一个裸主机名（不带协议、端口或路径），每台设备会在它下面多一个子域名入口。

```bash
termexo-relay serve --tls off --listen 127.0.0.1:8443 \
  --public-url https://relay.example.com \
  --trusted-proxy 127.0.0.1/32 \
  --subdomain-base relay.example.com
```

之后每台设备有两个入口：

```
https://<deviceId>.relay.example.com/        # 子域名形式
https://relay.example.com/d/<deviceId>/      # 路径形式，一直可用
```

取值会转成小写并去掉首尾的点（`Relay.Example.COM.` 等同于 `relay.example.com`）。
`https://relay.example.com`、`relay.example.com:8443`、`localhost`、`-bad.example.com` 都会被拒绝。
DNS 与证书的要求见[子域名入口](#子域名入口)。

#### 只用环境变量配置 `serve`

```bash
export TERMEXO_RELAY_DATA_DIR=/var/lib/termexo-relay
export TERMEXO_RELAY_LISTEN=127.0.0.1:8443
export TERMEXO_RELAY_PUBLIC_URL=https://relay.example.com
export TERMEXO_RELAY_TLS=off
export TERMEXO_RELAY_TRUSTED_PROXY=127.0.0.1/32
export TERMEXO_RELAY_SUBDOMAIN_BASE=relay.example.com
termexo-relay serve
```

#### 日志级别

日志输出到标准输出，默认级别 `info`。`RUST_LOG` 接受
[tracing 过滤表达式](https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html)：

```bash
# 全部输出 debug
RUST_LOG=debug termexo-relay serve

# 只看警告和错误
RUST_LOG=warn termexo-relay serve

# 隧道模块输出 debug，其余保持 info
RUST_LOG=info,termexo_relay::tunnel=debug termexo-relay serve
```

### `link`

用**上游**中继签发的 `relay` 类型接入码，把本中继接到上游。它只把凭据写进数据目录就退出；下一次 `serve`
会自动建立并保持这条链接。之后本中继名下的设备在上游中继上也能访问。

| 参数 | 环境变量 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `--data-dir <路径>` | `TERMEXO_RELAY_DATA_DIR` | 否（`relay-data`） | **本中继**的数据目录 |
| `--upstream <地址>` | — | 是 | 上游中继的公开地址 |
| `--code <接入码>` | — | 是 | 上游签发的 `relay` 类型接入码 |
| `--name <名称>` | — | 否 | 本中继在上游上显示的名称；默认取本中继已保存的公开地址主机名 |
| `--certificate-fingerprint <sha256>` | — | 上游使用自签名证书时必填 | 上游证书的 SHA-256 指纹 |

```bash
# 上游证书受信任（例如在 Caddy 后面）
termexo-relay link --data-dir /var/lib/termexo-relay \
  --upstream https://relay-a.example.com \
  --code ABCD-EFGH-JKLM

# 给本中继在上游起一个好认的名字
termexo-relay link --data-dir /var/lib/termexo-relay \
  --upstream https://relay-a.example.com \
  --code ABCD-EFGH-JKLM \
  --name 办公室中继

# 上游使用自签名证书：固定它的指纹
termexo-relay link --data-dir /var/lib/termexo-relay \
  --upstream https://203.0.113.10:8443 \
  --code ABCD-EFGH-JKLM \
  --certificate-fingerprint 45:7C:B9:97:…:1E
```

指纹带不带冒号、大小写都可以，会规范化成小写无冒号后存储；上游证书受信任时不要填。不写 `--name` 时，
中继用上一次运行 `serve` 时保存的公开地址主机名，从没运行过则用一个通用名称——想确定上游显示什么，就
显式传 `--name`。最终使用的名称会打印出来。

### `admin reset-password`

重置一个控制台账号的密码，打印新的一次性密码，并让该账号在所有地方退出登录。它直接读写数据目录，中继
可以不停。

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--data-dir <路径>` | `TERMEXO_RELAY_DATA_DIR` | `relay-data` | 中继的数据目录 |
| `--username <用户名>` | — | `admin` | 要重置的账号 |

```bash
# 首个管理员
termexo-relay admin reset-password --data-dir /var/lib/termexo-relay

# 其他账号
termexo-relay admin reset-password --data-dir /var/lib/termexo-relay --username alice

# 在容器里
docker exec -it termexo-relay termexo-relay admin reset-password
```

## 部署场景

### 没有域名的局域网或 VPN 中继

自签名 TLS，桌面端固定指纹。适合家里的服务器、NAS，或 Tailscale、WireGuard 这类 VPN。

```bash
termexo-relay serve \
  --data-dir /var/lib/termexo-relay \
  --listen 0.0.0.0:8443 \
  --public-url https://192.168.1.20:8443
```

在 VPN 里就把 VPN 地址写进 `--public-url`，例如 `https://100.64.0.5:8443`。浏览器会在每台设备上提示一次
证书不受信任；桌面端不会，因为它固定了指纹。

### 放在 Caddy 后面的公网中继（推荐）

Caddy 负责申请和续期证书，中继只在本机回环上说明文 HTTP。

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:8443
}
```

```bash
termexo-relay serve \
  --data-dir /var/lib/termexo-relay \
  --tls off \
  --listen 127.0.0.1:8443 \
  --public-url https://relay.example.com \
  --trusted-proxy 127.0.0.1/32
```

- `--public-url` 必须是浏览器看到的地址，不是 `http://127.0.0.1:8443`。
- `--trusted-proxy` 必须覆盖 Caddy 的来源地址，否则登录失败锁定会一次锁住所有人。
- Caddy 默认就会转发 WebSocket 升级和 `X-Forwarded-*` 头，不需要额外配置。
- 证书是公开受信的，桌面端的「证书指纹」留空。

### 放在 nginx 后面的公网中继

```nginx
server {
    listen 80;
    server_name relay.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name relay.example.com;

    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8443;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # 设备隧道和终端会话都是长连接。
        proxy_read_timeout 1h;
    }
}
```

中继的启动参数与 Caddy 示例相同。

### 放在 Traefik 后面的公网中继

Traefik（v3）默认就会转发 WebSocket 升级、保留 `Host` 头并设置 `X-Forwarded-*` 头，只需要配置路由和证书。

**用 Docker 标签**——Traefik 自动发现中继容器，用 TLS-ALPN 验证申请 Let's Encrypt 证书：

```yaml
# compose.yaml
services:
  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.le.acme.email=you@example.com
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.le.acme.tlschallenge=true
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik-certs:/letsencrypt

  relay:
    image: ghcr.io/gemron/termexo-relay:0.10.2
    restart: unless-stopped
    environment:
      TERMEXO_RELAY_TLS: "off"
      TERMEXO_RELAY_PUBLIC_URL: https://relay.example.com
      # Traefik 所在的 Compose 网络。
      TERMEXO_RELAY_TRUSTED_PROXY: 172.16.0.0/12
    volumes:
      - relay-data:/var/lib/termexo-relay
    labels:
      - traefik.enable=true
      - traefik.http.routers.relay.rule=Host(`relay.example.com`)
      - traefik.http.routers.relay.entrypoints=websecure
      - traefik.http.routers.relay.tls.certresolver=le
      - traefik.http.services.relay.loadbalancer.server.port=8443

volumes:
  relay-data:
  traefik-certs:
```

Docker 通常从 `172.16.0.0/12` 给 Compose 网络分配地址；如果你的环境用的是别的地址池
（`docker network inspect <项目名>_default` 可以看到），就改为信任那个网段。

**用中继二进制加 Traefik 的文件配置**——中继和 Caddy 示例一样只监听本机回环：

```yaml
# /etc/traefik/traefik.yml（静态配置）
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

certificatesResolvers:
  le:
    acme:
      email: you@example.com
      storage: /var/lib/traefik/acme.json
      tlsChallenge: {}

providers:
  file:
    filename: /etc/traefik/dynamic.yml
```

```yaml
# /etc/traefik/dynamic.yml
http:
  routers:
    relay:
      rule: Host(`relay.example.com`)
      entryPoints:
        - websecure
      service: relay
      tls:
        certResolver: le
  services:
    relay:
      loadBalancer:
        servers:
          - url: http://127.0.0.1:8443
```

```bash
termexo-relay serve \
  --data-dir /var/lib/termexo-relay \
  --tls off \
  --listen 127.0.0.1:8443 \
  --public-url https://relay.example.com \
  --trusted-proxy 127.0.0.1/32
```

**开启子域名入口**——泛域名证书需要 DNS-01 验证。以 Cloudflare 为例，给 Traefik 设置 `CF_DNS_API_TOKEN`
环境变量，把 TLS 验证换成 DNS 验证，并把基础域名和它的子域名都路由到中继：

```yaml
  traefik:
    environment:
      CF_DNS_API_TOKEN: ${CF_DNS_API_TOKEN}
    command:
      # ……入口配置同上，证书解析器改用 DNS 验证，不再用 tlschallenge：
      - --certificatesresolvers.le.acme.email=you@example.com
      - --certificatesresolvers.le.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.le.acme.dnschallenge.provider=cloudflare

  relay:
    environment:
      TERMEXO_RELAY_TLS: "off"
      TERMEXO_RELAY_PUBLIC_URL: https://relay.example.com
      TERMEXO_RELAY_TRUSTED_PROXY: 172.16.0.0/12
      TERMEXO_RELAY_SUBDOMAIN_BASE: relay.example.com
    labels:
      - traefik.enable=true
      - traefik.http.routers.relay.rule=Host(`relay.example.com`) || HostRegexp(`^[^.]+\.relay\.example\.com$`)
      - traefik.http.routers.relay.entrypoints=websecure
      - traefik.http.routers.relay.tls.certresolver=le
      - traefik.http.routers.relay.tls.domains[0].main=relay.example.com
      - traefik.http.routers.relay.tls.domains[0].sans=*.relay.example.com
      - traefik.http.services.relay.loadbalancer.server.port=8443
```

DNS 仍然需要[子域名入口](#子域名入口)一节里说的泛域名记录。

### 中继自己用证书终止 TLS

不用反代，中继直接加载证书。注意中继不会自动重新加载续期后的证书，续期后要重启。

```bash
termexo-relay serve \
  --data-dir /var/lib/termexo-relay \
  --listen 0.0.0.0:8443 \
  --public-url https://relay.example.com:8443 \
  --tls cert:/etc/termexo/fullchain.pem,/etc/termexo/privkey.pem
```

### Docker

```bash
docker run -d --name termexo-relay \
  --restart unless-stopped \
  -p 8443:8443 \
  -v termexo-relay-data:/var/lib/termexo-relay \
  -e TERMEXO_RELAY_PUBLIC_URL=https://192.168.1.20:8443 \
  ghcr.io/gemron/termexo-relay:0.10.2

docker logs termexo-relay          # 查看一次性管理员密码与证书指纹
```

入口就是二进制本身，所以也可以把参数写在镜像名后面：

```bash
docker run -d --name termexo-relay -p 8443:8443 \
  -v termexo-relay-data:/var/lib/termexo-relay \
  ghcr.io/gemron/termexo-relay:0.10.2 \
  serve --public-url https://192.168.1.20:8443
```

使用宿主机上的证书：

```bash
docker run -d --name termexo-relay -p 8443:8443 \
  -v termexo-relay-data:/var/lib/termexo-relay \
  -v /etc/termexo:/etc/termexo:ro \
  -e TERMEXO_RELAY_PUBLIC_URL=https://relay.example.com:8443 \
  -e TERMEXO_RELAY_TLS=cert:/etc/termexo/fullchain.pem,/etc/termexo/privkey.pem \
  ghcr.io/gemron/termexo-relay:0.10.2
```

`docker stop` 发出的 SIGTERM 直接送到中继进程（它就是 PID 1），中继关闭隧道后退出，远在 Docker 默认的
10 秒宽限期之内。

### Docker Compose 加 Caddy

```yaml
# compose.yaml
services:
  relay:
    image: ghcr.io/gemron/termexo-relay:0.10.2
    restart: unless-stopped
    environment:
      TERMEXO_RELAY_TLS: "off"
      TERMEXO_RELAY_PUBLIC_URL: https://relay.example.com
      # Caddy 所在的 Compose 网络。
      TERMEXO_RELAY_TRUSTED_PROXY: 172.16.0.0/12
    volumes:
      - relay-data:/var/lib/termexo-relay

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data

volumes:
  relay-data:
  caddy-data:
```

```caddyfile
# Caddyfile
relay.example.com {
    reverse_proxy relay:8443
}
```

```bash
docker compose up -d
docker compose logs relay          # 查看一次性管理员密码
```

### systemd 服务

```bash
sudo useradd --system --home-dir /var/lib/termexo-relay --create-home termexo-relay
```

```ini
# /etc/systemd/system/termexo-relay.service
[Unit]
Description=Termexo relay
After=network-online.target
Wants=network-online.target

[Service]
User=termexo-relay
Group=termexo-relay
WorkingDirectory=/var/lib/termexo-relay
Environment=TERMEXO_RELAY_DATA_DIR=/var/lib/termexo-relay
Environment=TERMEXO_RELAY_LISTEN=127.0.0.1:8443
Environment=TERMEXO_RELAY_PUBLIC_URL=https://relay.example.com
Environment=TERMEXO_RELAY_TLS=off
Environment=TERMEXO_RELAY_TRUSTED_PROXY=127.0.0.1/32
ExecStart=/usr/local/bin/termexo-relay serve
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now termexo-relay
journalctl -u termexo-relay -e      # 查看一次性管理员密码
```

一定要显式设置 `TERMEXO_RELAY_DATA_DIR`（或 `WorkingDirectory`）：两者都没有时，相对的默认值 `relay-data`
会落到 `/relay-data`。

### 子域名入口

让每台设备有自己的主机名，例如 `https://3f9c2a.relay.example.com/`。

1. 添加**泛域名 DNS 记录**：`*.relay.example.com` 指向中继（`relay.example.com` 本身的记录保留）。
2. 准备**泛域名证书**。用 Caddy 需要 DNS-01 验证和对应的 DNS 插件，以 Cloudflare 为例：

   ```caddyfile
   relay.example.com, *.relay.example.com {
       tls {
           dns cloudflare {env.CLOUDFLARE_API_TOKEN}
       }
       reverse_proxy 127.0.0.1:8443
   }
   ```

3. 带上 `--subdomain-base` 启动中继：

   ```bash
   termexo-relay serve --tls off --listen 127.0.0.1:8443 \
     --public-url https://relay.example.com \
     --trusted-proxy 127.0.0.1/32 \
     --subdomain-base relay.example.com
   ```

变化如下：

- 两种入口**同时有效**，已经发出去的路径形式链接不会失效。
- 中继对外给出的地址（控制台的访问地址、桌面端的地址清单、通告给上游的地址）改用子域名形式。
- `/console/*`、`/api/*` 和 `/tunnel` 仍然只在基础域名上提供，子域名上的一切都转发给设备。
- Host 匹配不区分大小写、忽略端口，只认**恰好一层**子域名，且这一层必须是合法的 deviceId；其它 Host
  一律走普通路由。
- `--tls self-signed` 会把 `*.relay.example.com` 加进证书；已经生成过的证书不会重签，需要删掉
  `<data-dir>/tls/` 再启动（桌面端固定过指纹的要重新固定）。
- `access = relay-login` 的设备在子域名入口上会被 302 回路径形式：控制台会话 cookie 是 host-only 的，
  不会发到设备子域名上。

### 中继级联

一台中继可以像桌面端一样接到另一台中继上。典型用法：办公室局域网里的中继，同时让自己名下的桌面端能经
公网中继访问。

```
 手机 ──▶ relay-a.example.com（公网）──▶ 办公室中继（局域网）──▶ 桌面端
```

1. 在**上游**（`relay-a`）签发 `relay` 类型的接入码：

   ```bash
   curl -X POST https://relay-a.example.com/api/admin/enrollments \
     -H 'Content-Type: application/json' \
     -H 'X-Requested-With: termexo-console' \
     -b cookies.txt \
     -d '{"kind":"relay","ttlMinutes":30,"note":"办公室中继"}'
   ```

2. 在**下游**（办公室中继）上接入并重启：

   ```bash
   termexo-relay link --data-dir /var/lib/termexo-relay \
     --upstream https://relay-a.example.com \
     --code ABCD-EFGH-JKLM \
     --name 办公室中继
   sudo systemctl restart termexo-relay
   ```

   也可以在控制台「**中继**」页填写，或者调接口，这两种方式不需要重启：

   ```bash
   curl -X POST https://office-relay.lan:8443/api/admin/relays/upstream \
     --cacert /var/lib/termexo-relay/tls/cert.pem \
     -H 'Content-Type: application/json' \
     -H 'X-Requested-With: termexo-console' \
     -b cookies.txt \
     -d '{"url":"https://relay-a.example.com","code":"ABCD-EFGH-JKLM"}'

   # 断开上游
   curl -X DELETE https://office-relay.lan:8443/api/admin/relays/upstream \
     --cacert /var/lib/termexo-relay/tls/cert.pem \
     -H 'X-Requested-With: termexo-console' -b cookies.txt
   ```

信任是单向的：上游能看到下游名下的设备，也能断开经过自己的流，但看不到下游的用户，也不能撤销下游的设备。
经下游通告上来的设备在上游没有数据库记录，它的访问策略由**它直连的那台中继**决定（在上游 `PATCH` 会得到
404）。形成环路的接入会被拒绝。

## 日常运维

### 首个管理员

数据库里没有任何用户时，中继会创建 `admin` 账号，并把一次性随机密码打印到标准输出——**只打印一次**
（见[快速上手](#快速上手一分钟在局域网跑起一台中继)）。忘了就用 [`admin reset-password`](#admin-reset-password)。

### 用 curl 调用 API

控制台本身就是 `/api/*` 的客户端，所以它能做的事都能写成脚本。两条规则：

- 先登录一次，保存会话 cookie（`termexo_relay_session`，有效期 7 天）。
- 除 `GET`、`HEAD`、`OPTIONS` 以外的请求都必须带 `X-Requested-With: termexo-console`。

```bash
RELAY=https://relay.example.com

# 登录并保存 cookie
curl -c cookies.txt -X POST "$RELAY/api/auth/login" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"username":"admin","password":"K7QD3MTR9WXF2HJN"}'

# 当前登录的是谁
curl -b cookies.txt "$RELAY/api/me"

# 修改自己的密码
curl -b cookies.txt -X POST "$RELAY/api/me/password" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"currentPassword":"K7QD3MTR9WXF2HJN","newPassword":"一个足够长的新密码"}'

# 退出登录
curl -b cookies.txt -X POST "$RELAY/api/auth/logout" -H 'X-Requested-With: termexo-console'
```

自签名中继要显式信任它的证书，而不是关掉校验：

```bash
curl --cacert /var/lib/termexo-relay/tls/cert.pem https://192.168.1.20:8443/api/health
```

同一来源地址在 10 分钟内登录失败 5 次，会被锁定 10 分钟。

### 接入桌面端

**用接入码**——管理员签发，桌面端用户填写。控制台「**接入码**」页，或者调接口：

```bash
# desktop 接入码，默认 15 分钟有效
curl -b cookies.txt -X POST "$RELAY/api/admin/enrollments" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"kind":"desktop"}'

# 24 小时有效（上限），归属某个已有用户，并附备注
curl -b cookies.txt -X POST "$RELAY/api/admin/enrollments" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"kind":"desktop","ttlMinutes":1440,"ownerUserId":"<用户 id>","note":"Alice 的笔记本"}'

# 列出接入码，作废一个还没用过的
curl -b cookies.txt "$RELAY/api/admin/enrollments"
curl -b cookies.txt -X DELETE "$RELAY/api/admin/enrollments/<接入码 id>" \
  -H 'X-Requested-With: termexo-console'
```

| 字段 | 取值 | 默认值 |
| --- | --- | --- |
| `kind` | `desktop` 表示 Termexo 桌面端，`relay` 表示下游中继 | 必填 |
| `ttlMinutes` | 1 到 1440，超出范围会被截断 | 15 |
| `ownerUserId` | 控制台账号的 id（从 `GET /api/admin/users` 获取），该用户随后可以管理这台设备 | 无——只有管理员能管理 |
| `note` | 最多 200 个字符 | 无 |

响应里的 `code` 形如 `ABCD-EFGH-JKLM`，**只在这一次响应里出现**（数据库只存它的 SHA-256），一次性使用。
桌面端操作：「**设置 → 远程访问 → 通过中继访问 → 接入方式：接入码**」。

**用中继账号**——桌面端用户用自己的控制台用户名和密码接入（「接入方式：账号密码」），设备归属这个账号。
密码只用于这一次请求，桌面端不会保存。

### 给同事开账号

控制台「**用户**」页。`admin` 管理一切；`user` 只能看到自己的设备、改自己的密码。

```bash
# 创建用户
curl -b cookies.txt -X POST "$RELAY/api/admin/users" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"username":"alice","password":"初始密码","role":"user"}'

# 列出用户（ownerUserId 要用这里的 id）
curl -b cookies.txt "$RELAY/api/admin/users"

# 提升为管理员、禁用或设置新密码——三个字段任选
curl -b cookies.txt -X PATCH "$RELAY/api/admin/users/<用户 id>" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"role":"admin"}'
curl -b cookies.txt -X PATCH "$RELAY/api/admin/users/<用户 id>" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"disabled":true}'

# 删除用户
curl -b cookies.txt -X DELETE "$RELAY/api/admin/users/<用户 id>" \
  -H 'X-Requested-With: termexo-console'
```

禁用或删除用户会同时撤销该用户名下的所有设备，这些设备的隧道立即断开。

### 谁能到达一台设备

每台设备有一个 `access` 取值，决定谁能**到达**它：

| 取值 | 行为 |
| --- | --- |
| `public`（默认） | 任何拿到 `/d/<deviceId>/` 链接的人都能到达；能不能操作仍由桌面端的访问令牌决定 |
| `relay-login` | 浏览器必须先登录中继，且是该设备的**所有者**或**管理员**，中继才转发 |

`relay-login` 对该设备的**全部**请求生效——页面、静态资源和 `/ws` 升级一视同仁。未登录时回 302 到
`/console/login?next=<原路径>`，登录后自动跳回；已登录但无权时回 403 页面。陌生人连设备在不在线都无法得知。

控制台「**设备**」页打开设备，勾选「**访问前必须先登录中继**」。或者调接口：

```bash
# 管理员修改任意设备
curl -b cookies.txt -X PATCH "$RELAY/api/admin/devices/<deviceId>" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"access":"relay-login"}'

# 所有者修改自己的设备（可以同时改名）
curl -b cookies.txt -X PATCH "$RELAY/api/devices/<deviceId>" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"access":"public","name":"家里的台式机"}'

# 备注只有管理员能改
curl -b cookies.txt -X PATCH "$RELAY/api/admin/devices/<deviceId>" \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -d '{"note":"三楼左侧工位"}'
```

### 撤销或断开设备

```bash
# 列出设备：管理员看全部，普通用户只看自己的
curl -b cookies.txt "$RELAY/api/admin/devices"
curl -b cookies.txt "$RELAY/api/devices"

# 撤销：立即且永久生效——在线隧道关闭，桌面端必须重新接入
curl -b cookies.txt -X POST "$RELAY/api/admin/devices/<deviceId>/revoke" \
  -H 'X-Requested-With: termexo-console'
curl -b cookies.txt -X POST "$RELAY/api/devices/<deviceId>/revoke" \
  -H 'X-Requested-With: termexo-console'           # 撤销自己的设备

# 断开（仅管理员）：只断掉当前隧道，不撤销任何东西
curl -b cookies.txt -X POST "$RELAY/api/admin/devices/<deviceId>/disconnect" \
  -H 'X-Requested-With: termexo-console'
```

被撤销的桌面端会在远程访问面板上显示「已被撤销」。

### 审计日志

控制台「**审计**」页。登录、接入、设备与用户的变更都会记录——但不会记录密码、接入码、凭据或指纹。

```bash
# 最新 100 条（默认一页）
curl -b cookies.txt "$RELAY/api/admin/audit"

# 20 条
curl -b cookies.txt "$RELAY/api/admin/audit?limit=20"

# 事件 4812 之前的一页，用于向前翻页
curl -b cookies.txt "$RELAY/api/admin/audit?limit=100&before=4812"

# 某台设备或某个用户的全部记录
curl -b cookies.txt "$RELAY/api/admin/audit?targetId=<deviceId 或用户 id>"
```

### 健康检查与监控

`GET /api/health` 不需要登录，也不会泄露隧道握手之外的任何信息：

```bash
curl -s https://relay.example.com/api/health
# {"version":"0.10.2","relayId":"…","protocol":1}
```

负载均衡的健康检查、可用性监控都可以指向它。容器镜像里没有 `curl`，请从容器外部检查。

```bash
# 管理员：中继 id、公开地址与版本
curl -b cookies.txt "$RELAY/api/admin/settings"
```

放在反向代理后面时，部署完成以及每次改动代理配置后，还要用明文 HTTP 地址访问一次：

```bash
curl -sI http://relay.example.com/api/health
# 应返回 3xx 跳转，Location 指向 https://relay.example.com/api/health
```

80 端口的请求到不了中继。代理的跳转一旦失效，不带 `https://` 输入地址的人只会看到代理返回的 404 或连接被拒，
而通过 HTTPS 访问 `/api/health`、查看中继日志都发现不了。

### 升级与备份

```bash
# 二进制：替换后重启
sudo install -m 0755 termexo-relay /usr/local/bin/termexo-relay
sudo systemctl restart termexo-relay

# 容器
docker pull ghcr.io/gemron/termexo-relay:0.10.2
docker rm -f termexo-relay && docker run -d --name termexo-relay …   # 参数与之前相同

# 备份：停止、复制数据目录、启动
sudo systemctl stop termexo-relay
sudo tar -czf termexo-relay-backup.tar.gz -C /var/lib termexo-relay
sudo systemctl start termexo-relay
```

数据库迁移在启动时自动执行，可以重复执行。重启后桌面端会自动重连，凭据不受影响。

## 数据目录的权限

中继是无人值守的服务进程，没有 keyring：数据库里的控制台会话令牌、设备密钥的 SHA-256、argon2 密码哈希与
审计，以及 `--tls self-signed` 生成的私钥，全都只靠文件权限保护。因此每次启动（`serve` 与 `link` 都一样）
中继会把

- `<data-dir>/` 与 `<data-dir>/tls/` 收紧为 `0700`；
- `<data-dir>/relay.db` 与 `<data-dir>/tls/key.pem` 收紧为 `0600`。

`cert.pem` 是公开的，不动；SQLite 的 `-wal` / `-shm` 边车文件由 `0700` 的目录挡住。收紧只会**去掉**同组和
其他用户的权限，不会放宽你自己设得更严的位（比如私钥留在 `0400`），已经正确的权限不会被重复改写；旧版本
升级上来的数据目录会在下一次启动时一并修好。文件系统不支持权限位时只打印一条告警，不影响启动。Windows 上
不做处理，文件按所在目录的 ACL 继承。

> 收紧之后只有**运行中继的那个用户**能读写数据目录。容器换 UID、改用别的服务账号，或者让备份进程去读这个
> 目录时，记得先 `chown -R`。

## 停止

Unix 上中继同时监听 **SIGTERM** 与 **SIGINT**：`docker stop`、`systemctl stop`、Kubernetes 驱逐发来的都是
SIGTERM。收到之后它

1. 不再接受新的 HTTP 连接，给进行中的请求最多 5 秒；
2. 断开与上游中继的链接（如果配置了），让上游立刻回「设备离线」，而不是把新请求打进一个正在退出的进程。
   凭据不会被清除，重启后自动重连。

设备隧道是长连接，有设备在线时这个过程一般就是整整 5 秒。Docker 默认 10 秒、systemd 默认 90 秒、Kubernetes
默认 30 秒的宽限期都足够。日志里会写明是哪个信号停的它。

Windows 上只处理 Ctrl-C——中继的部署目标是 Linux，Windows 只用于开发。

## 开发

```bash
cargo test                       # 单元测试与 tests/ 下的集成测试
cargo test relay_access          # 按名称只跑一个测试或一组
cargo clippy --all-targets
cargo fmt
```

控制台是 `console/` 下的独立 Angular 工作区：

```bash
npm --prefix console install
npm --prefix console test -- --watch=false
npm --prefix console run build   # 产物 console/dist/relay-console/browser
```

产物由 `build.rs` 通过 `include_dir` 嵌进二进制；产物不存在时退回 `console-placeholder/`，因此 `cargo test`
不依赖前端构建。

自己构建带真实控制台的镜像：

```bash
npm --prefix console install && npm --prefix console run build
docker build --build-arg CONSOLE_DIR=console/dist/relay-console/browser -t termexo-relay .
```

### 与 Termexo 一起开发

`Cargo.toml` 把 `termexo-relay-protocol` 声明为 Termexo 仓库的 git 依赖，并**钉在具体 commit 上**——分支合并
后会被删除，commit 不会。

把 `.cargo/config.toml.example` 复制成 `.cargo/config.toml`，就会改用**相邻目录**的 Termexo 检出：

```
devlop/
├── Termexo/
└── termexo-relay/
```

这样改完协议不必先推送、也不必重新钉 commit 就能在这里编译。这个文件**不提交**——cargo 在 `paths` 指向的
目录不存在时会直接报错，所以全新克隆、CI 和 Docker 构建都不能看到它。

它用的是 `paths` 而不是 `[patch]`，这一点是刻意的：`[patch]` 会把 `Cargo.lock` 里该 crate 的来源改写成本地
路径，于是每次本地构建都在悄悄解除版本钉定，而把那样的 lock 提交上去会让所有没有这个覆盖的地方（CI、
Docker、别人的克隆）全部构建失败。`paths` 覆盖不动 lock。

### 持续集成与发布

| 工作流 | 触发 | 做什么 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR | Linux x64、macOS ARM64、Windows x64 三格跑 `cargo fmt --check`、`clippy -D warnings`、`cargo test --locked`；另一格跑控制台的测试、构建与 `prettier --check` |
| `.github/workflows/release.yml` | `v*` tag、手动 | 上表八个目标各在**自己架构的构建机**上编译打包，汇总 `SHA256SUMS`，创建 Release |
| `.github/workflows/docker.yml` | push main、`v*` tag、手动 | amd64 与 arm64 各在原生构建机上建镜像，按 digest 推送后合并成一份 manifest list 推到 ghcr.io |

都不交叉编译：`aws-lc-rs` 与 bundled SQLite 都要编 C，交叉工具链比多开一台构建机麻烦得多。控制台只构建一次，
再分发给各个构建机，因此每份产物里的控制台是同一份。

版本号同时写在 `Cargo.toml` 和 `console/package.json` 里，跟随它所对接的 Termexo 版本；两者不一致或 tag 对不上
时，`release.yml` 会拒绝构建。发布：

```bash
git tag v0.10.2
git push origin v0.10.2
```

## 已知限制

- **不内置 ACME**：签发证书需要一个公网可达的域名才能通过验证。公网部署请把中继放在 Caddy 之类的反代后面用
  `--tls off`；内网用 `--tls self-signed` 加指纹固定。
- 所有流量都经过中继，没有直连。终端内容是端到端加密的，但路径上每台中继的运营者仍然知道你的设备何时在线、
  哪些地址在访问，并且可以随时断开。接入别人运营的上游中继前要清楚这一点。
- 子域名模式需要泛域名 DNS 与证书；`--tls self-signed` 生成过的证书不会因为后来加了 `--subdomain-base` 而
  自动重签。
- `--tls cert:` 加载的证书续期后，需要重启才生效。
- 一台桌面端只能接一台中继，多中继冗余尚未支持。
