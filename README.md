# termexo-relay

Termexo 的中继服务。桌面端主动向它建立一条出站隧道，手机或另一台电脑就能通过
`https://<中继>/d/<deviceId>/` 打开那台电脑上完整的 Termexo 工作台——不需要公网 IP，也不需要在
路由器上开端口。

隧道协议、流前导与设备凭据格式定义在共用 crate `termexo-relay-protocol` 里。它归
[Termexo](https://github.com/gemron/Termexo) 仓库所有——桌面端也要编译同一份——本仓库通过 git
依赖引用它，设计文档 `docs/architecture/relay-service.md` 也在那边。

## 支持的平台

每打一个 `v*` tag，CI 会在各自架构的原生构建机上编译，并把下列产物连同一份 `SHA256SUMS` 发到
[Releases](https://github.com/gemron/termexo-relay/releases)。归档里是可执行文件和这份 README，
解压即可运行，没有别的运行时依赖。

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

归档命名形如 `termexo-relay-0.9.0-x86_64-unknown-linux-gnu.tar.gz`。校验：

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

musl 两个是静态链接的，不依赖发行版的 glibc 版本，老系统和 Alpine 用它；其余 Linux 场景用 glibc
版本即可。容器镜像见下面的[容器](#容器)一节，同样提供 amd64 与 arm64。

这张表以外的平台（FreeBSD、32 位 ARM、Linux riscv64 等）**没有预编译产物**，但源码里没有任何
平台专有分支，自行编译通常可行。

### 从源码构建

只需要两样东西：

* **Rust 工具链**，版本不低于 `Cargo.toml` 里的 `rust-version`（当前 1.88）；
* **一个 C/C++ 编译器**——TLS 用的 `aws-lc-rs` 和 `rusqlite` 的 `bundled` SQLite 都要编 C。

非 FIPS 构建**不需要** CMake、bindgen 或 Go：`aws-lc-rs` 自带预生成的绑定，Windows x86-64 还有一份
预编译的 NASM 目标兜底。各平台具体要装的是：

| 平台 | 需要 |
| --- | --- |
| Linux | `build-essential`（gcc）；musl 目标另需 `musl-tools`，它提供 `musl-gcc` |
| macOS | Xcode 命令行工具（`xcode-select --install`） |
| Windows | Visual Studio 2022 生成工具的「使用 C++ 的桌面开发」工作负载（MSVC） |

```bash
cargo build --release            # 产物 target/release/termexo-relay
```

这样编出来的二进制里嵌的是控制台**占位页**。要嵌真实控制台，先构建前端再编译——那一步需要 Node，
详见下面的[开发](#开发)一节。

## 启动

```bash
termexo-relay serve \
  --data-dir /var/lib/termexo-relay \
  --listen 0.0.0.0:8443 \
  --public-url https://relay.example.com \
  --tls cert:/etc/termexo/fullchain.pem,/etc/termexo/privkey.pem
```

每个参数都有环境变量等价物，方便容器部署：

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `--data-dir` | `TERMEXO_RELAY_DATA_DIR` | `relay-data` | SQLite 数据库与自签名证书的存放目录 |
| `--listen` | `TERMEXO_RELAY_LISTEN` | `0.0.0.0:8443` | 监听地址 |
| `--public-url` | `TERMEXO_RELAY_PUBLIC_URL` | 由监听地址推导 | 浏览器访问中继用的公开地址 |
| `--tls` | `TERMEXO_RELAY_TLS` | `self-signed` | `self-signed`、`cert:<证书>,<私钥>` 或 `off` |
| `--trusted-proxy` | `TERMEXO_RELAY_TRUSTED_PROXY` | 无 | 受信任的反代网段，可重复；仅 `--tls off` 时生效 |
| `--subdomain-base` | `TERMEXO_RELAY_SUBDOMAIN_BASE` | 无 | 子域名模式的基础域名，例如 `relay.example.com` |

TLS 三种模式：

* `self-signed`：首次启动生成证书并保存到 `<data-dir>/tls/`，之后一直复用；启动日志会打印证书的
  SHA-256 指纹，桌面端首次接入时用它做指纹固定（TOFU）。适合没有域名的内网中继。
* `cert:<证书>,<私钥>`：加载已有的 PEM 证书链与私钥。
* `off`：明文 HTTP，放在 Caddy / nginx 后面用。只有这种模式下才会读取 `--trusted-proxy` 命中来源
  发来的 `X-Forwarded-For` / `X-Forwarded-Proto` / `X-Forwarded-Host`。

中继**不内置 ACME**（Let's Encrypt 自动证书）。公网部署请把它放在 Caddy 后面用 `--tls off`，由
Caddy 申请和续期证书；这也是设计文档推荐的方式。

### 数据目录的权限

中继是无人值守的服务进程，没有 keyring：数据库里的控制台会话令牌、设备密钥的 SHA-256、argon2 密码
哈希与审计，以及 `--tls self-signed` 生成的私钥，全都只靠文件权限保护。因此每次启动（`serve` 与
`link` 都一样）中继会把

* `<data-dir>/` 与 `<data-dir>/tls/` 收紧为 `0700`；
* `<data-dir>/relay.db` 与 `<data-dir>/tls/key.pem` 收紧为 `0600`。

`cert.pem` 是公开的，不动；SQLite 的 `-wal` / `-shm` 边车文件由 `0700` 的目录挡住。收紧只会**去掉**
同组和其他用户的权限，不会放宽你自己设得更严的位（比如私钥留在 `0400`），已经正确的权限不会被重复
改写；旧版本升级上来的数据目录会在下一次启动时一并修好。文件系统不支持权限位时只打印一条告警，不
影响启动。Windows 上不做处理，文件按所在目录的 ACL 继承。

> 收紧之后只有**运行中继的那个用户**能读写数据目录。容器换 UID、改用别的服务账号，或者让备份进程去
> 读这个目录时，记得先 `chown -R`。

启动日志会打印实际使用的**绝对**路径 —— `--data-dir` 默认值 `relay-data` 是相对路径，systemd 单元
没有 `WorkingDirectory` 时会落到 `/relay-data`：

```
INFO termexo_relay::server: 中继数据目录 data_dir=/var/lib/termexo-relay
```

## 停止

Unix 上中继同时监听 **SIGTERM** 与 **SIGINT**：`docker stop`、`systemctl stop`、Kubernetes 驱逐发来
的都是 SIGTERM。收到之后它

1. 不再接受新的 HTTP 连接，给进行中的请求最多 5 秒；
2. 断开与上游中继的链接（如果配置了），让上游立刻回「设备离线」，而不是把新请求打进一个正在退出的
   进程。凭据不会被清除，重启后自动重连。

设备隧道是长连接，有设备在线时这个过程一般就是整整 5 秒，所以停止宽限期要留够：Docker 默认 10 秒、
systemd 默认 90 秒、Kubernetes 默认 30 秒都足够。日志里会写明是哪个信号停的它。

Windows 上只处理 Ctrl-C——中继的部署目标是 Linux，Windows 只用于开发。

## 设备访问策略

每台设备有一个 `access` 取值，决定「谁能到达它」：

| 取值 | 行为 |
| --- | --- |
| `public`（默认） | 任何拿到 `/d/<deviceId>/` 链接的人都能到达；能不能操作仍由桌面端的访问令牌决定 |
| `relay-login` | 浏览器必须先登录中继，且是该设备的**所有者**或**管理员**，中继才转发 |

`relay-login` 对该设备的**全部**请求生效——首页、静态资源和 `/ws` 升级一视同仁。未登录时中继回
302 到 `/console/login?next=<原路径>`，登录后自动跳回；已登录但无权时回 403 中文页面。

在控制台的「设备」页打开设备抽屉，勾选「访问前必须先登录中继」即可切换；也可以直接调接口：

```bash
curl -X PATCH https://relay.example.com/api/admin/devices/<deviceId> \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -b cookies.txt \
  -d '{"access":"relay-login"}'
```

设备的所有者也能改自己那台（`PATCH /api/devices/<deviceId>`）。经下游中继通告上来的设备在本中继
没有数据库行，改它的策略返回 404：它的策略由**它直连的那台中继**决定，本中继按 `public` 对待。

## 子域名模式

配置 `--subdomain-base relay.example.com` 后，每台设备多出一个入口：

```
https://<deviceId>.relay.example.com/        # 子域名形式，X-Termexo-Base 为 /
https://relay.example.com/d/<deviceId>/      # 路径形式，一直可用
```

* 两种入口**同时有效**，已经发出去的路径形式链接不会失效；
* 中继对外通告的地址（控制台的「访问地址」、桌面端面板的地址清单、通告给上游的地址）改用子域名形式；
* 控制台 `/console/*`、`/api/*` 和 `/tunnel` 仍然只在基础域名本身上提供，子域名上的一切都转发给设备；
* Host 匹配不区分大小写、忽略端口、只认**恰好一层**子域名，且这一层必须是合法的 deviceId；不匹配的
  Host 一律走普通路由。

需要**泛域名 DNS 记录**（`*.relay.example.com`）和**泛域名证书**：

* `--tls cert:` 由你自己准备证书；
* `--tls self-signed` 会把 `*.relay.example.com` 加进 SAN。已经生成过证书的数据目录不会自动重签，
  需要删掉 `<data-dir>/tls/` 再启动一次（桌面端固定过指纹的要重新固定）。

`access = relay-login` 的设备在子域名入口上会被 302 回路径形式：控制台会话 cookie 是 host-only 的，
不会发到设备子域名上，把它放宽到整个泛域名又会让每台设备都收到这个 cookie。

## 首次管理员密码

数据库里没有任何用户时，中继会创建 `admin` 账号并把一次性随机密码打印到终端——**只打印一次**：

```
────────────────────────────────────────────
控制台账号：admin
一次性密码：K7QD3MTR9WXF2HJN
请立即登录 /console/ 并修改密码，这条信息只显示一次。
────────────────────────────────────────────
```

忘记密码时重置（需要停止或不影响运行中的实例，直接读写同一个数据目录即可）：

```bash
termexo-relay admin reset-password --data-dir /var/lib/termexo-relay [--username admin]
```

重置会同时清掉该账号所有已登录的控制台会话。

## 签发接入码

登录控制台 `https://<中继>/console/` 后，在「接入码」页签发；也可以直接调接口：

```bash
curl -X POST https://relay.example.com/api/admin/enrollments \
  -H 'Content-Type: application/json' \
  -H 'X-Requested-With: termexo-console' \
  -b cookies.txt \
  -d '{"kind":"desktop","ttlMinutes":15,"note":"给同事"}'
```

返回的 `code` 形如 `ABCD-EFGH-JKLM`，**只在这一次响应里出现**（数据库只存它的 SHA-256）。默认
15 分钟有效，最长 24 小时，一次性使用。把它交给桌面端用户，在 Termexo 的「远程访问 → 通过中继
访问」里填入中继地址和接入码即可接入。`kind` 取 `desktop`（桌面端）或 `relay`（下游中继）。

也可以让用户用中继上的账号密码直接接入，此时设备归属该用户。

## 接入上游中继

一台中继可以再接到另一台中继上，本中继名下的设备在上游中继上也能访问。在上游签发一个 `relay`
类型的接入码，然后在本机执行：

```bash
termexo-relay link --data-dir /var/lib/termexo-relay \
  --upstream https://relay-a.example.com \
  --code ABCD-EFGH-JKLM \
  [--name 办公室中继] \
  [--certificate-fingerprint A1:B2:C3:…]
```

`link` 只换取凭据并写入配置，不启动服务；下次 `termexo-relay serve` 会自动建立这条链接。也可以在
控制台的「中继」页填同样三项。

`--certificate-fingerprint` **只有上游使用自签名证书时才需要**：把上游启动日志里打印的 SHA-256
指纹粘进来，本中继就只信任那一张证书。带不带冒号、大小写都可以，会规范化成小写无冒号后存储。上游
有受信证书或放在反代后面时留空即可。

## 放在 Caddy 后面（公网部署首选）

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:8443
}
```

子域名模式再加一条泛域名站点，证书用 DNS-01 申请（Caddy 需要装对应的 DNS 插件）：

```caddyfile
relay.example.com, *.relay.example.com {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
    reverse_proxy 127.0.0.1:8443
}
```

对应的中继启动参数：

```bash
termexo-relay serve --tls off --listen 127.0.0.1:8443 \
  --public-url https://relay.example.com \
  --trusted-proxy 127.0.0.1/32 \
  [--subdomain-base relay.example.com]
```

* `--public-url` 必须是浏览器看到的地址：中继用它生成所有对外地址，也用它决定会话 cookie 要不要
  带 `Secure`。
* `--trusted-proxy` 必须填 Caddy 的来源地址，否则中继会把所有浏览器都当成同一个来源（反代的出口
  IP），失败锁定会误伤。只有 `--tls off` 时这个参数才生效。
* Caddy 默认会转发 WebSocket 升级和 `X-Forwarded-For` / `X-Forwarded-Proto` / `X-Forwarded-Host`，
  不需要额外配置。

nginx 同理，注意补上转发头与升级头：

```nginx
location / {
    proxy_pass http://127.0.0.1:8443;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;
}
```

## 容器

镜像发布在 GitHub Container Registry，是一份同时包含 `linux/amd64` 与 `linux/arm64` 的 manifest
list，docker 会自动拉取匹配当前机器的那一个：

```bash
docker run -d --name termexo-relay \
  -p 8443:8443 \
  -v termexo-relay-data:/var/lib/termexo-relay \
  -e TERMEXO_RELAY_PUBLIC_URL=https://relay.example.com \
  ghcr.io/gemron/termexo-relay:0.9.0
```

可用标签：`0.9.0`（精确版本）、`0.9`（次版本线的最新）、`latest`（最新 tag）、`main`（主分支最新
提交，用于尝鲜，不建议生产用）。

镜像基于 `debian:bookworm-slim`，SQLite 已经编进二进制，运行时只额外带了 CA 证书。**没有**再单独出
一份 musl/alpine 镜像：静态二进制在 Releases 里已经有了，为它多维护一个 Dockerfile 不划算。

`docker stop` 发出的 SIGTERM 会直接送到中继进程——`ENTRYPOINT` 用的是 exec 形式，中继就是 PID 1
——中继收到后停止接受新连接、关闭隧道并退出，不用等到超时被 SIGKILL。

首次启动的管理员密码用 `docker logs termexo-relay` 查看。

自己构建镜像时，先构建控制台再把它的目录传进去，否则嵌进去的是占位页：

```bash
npm --prefix console install && npm --prefix console run build
docker build --build-arg CONSOLE_DIR=console/dist/relay-console/browser -t termexo-relay .
```

## 开发

```bash
cargo test
cargo clippy --all-targets
```

控制台是 `console/` 下的独立 Angular 工作区：

```bash
npm --prefix console install
npm --prefix console test -- --watch=false
npm --prefix console run build      # 产物 console/dist/relay-console/browser
```

产物由 `build.rs` 通过 `include_dir` 嵌进二进制；产物不存在时退回 `console-placeholder/`，因此
`cargo test` 不依赖前端构建。

### 与 Termexo 一起开发

`Cargo.toml` 把 `termexo-relay-protocol` 声明为 Termexo 仓库的 git 依赖。`.cargo/config.toml` 里有
一条 patch，让**相邻目录**的 Termexo 检出优先：两个仓库并排放时，改完协议不必先推送就能在这里编译。
只想按 git 版本构建（Docker 与全新克隆就是如此）就删掉那个文件。

### 持续集成与发布

| 工作流 | 触发 | 做什么 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR | Linux x64、macOS ARM64、Windows x64 三格跑 `cargo fmt --check`、`clippy -D warnings`、`cargo test --locked`；另一格跑控制台的测试、构建与 `prettier --check` |
| `.github/workflows/release.yml` | `v*` tag、手动 | 上表八个目标各在**自己架构的构建机**上编译打包，汇总 `SHA256SUMS`，创建 Release |
| `.github/workflows/docker.yml` | push main、`v*` tag、手动 | amd64 与 arm64 各在原生构建机上建镜像，按 digest 推送后合并成一份 manifest list 推到 ghcr.io |

都不交叉编译：`aws-lc-rs` 与 bundled SQLite 都要编 C，交叉工具链比多开一台构建机麻烦得多。控制台
只构建一次，再作为 artifact 分发给各个构建机，因此每份产物里的控制台是同一份。

两个前提：

* 各工作流在跑 cargo 之前会删掉 `.cargo/config.toml`（Docker 镜像靠 `.dockerignore` 排除它），
  因为构建机上没有相邻的 Termexo 检出，而 cargo 遇到指向不存在路径的 patch 会直接报错；
* `--locked` 要求 `Cargo.lock` 记录的是**git 来源**的 `termexo-relay-protocol`。当前提交里的
  `Cargo.lock` 是带着那条 patch 生成的，把它记成了路径依赖，所以协议 crate 推到 Termexo 的 `main`
  之后，需要在没有 patch 的情况下重新生成并提交一次 `Cargo.lock`。

## 已知限制

* **不内置 ACME**：签发证书需要一个公网可达的域名才能通过验证，本机无法测试。公网部署请放在 Caddy
  之类的反代后面用 `--tls off`，由它申请和续期；内网用 `--tls self-signed` 加指纹固定。
* 所有流量经过中继，没有直连；中继在自己这一跳终止 TLS，因此**运营者能看到经过它的终端内容**。
  自建时运营者就是你自己；接到别人运营的上游中继时要清楚这一点。
* 子域名模式需要泛域名 DNS 与证书；`--tls self-signed` 生成过的证书不会因为后来加了
  `--subdomain-base` 而自动重签。
* 一台桌面端只能接一台中继，多中继冗余尚未支持。
