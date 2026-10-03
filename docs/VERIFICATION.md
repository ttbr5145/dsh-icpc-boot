# 验证

[← 回到 README](../README.md)

## 命令

```sh
npm run check     # 两个半边的语法检查（node --check）
npm run verify    # 100 项：合成环境（替身 loader + 真 Chrome + 真 mp4）
npm test          # check + verify，不需要装 DSH —— CI 跑的就是这个
npm run e2e       # 39 项：真实 DSH web 应用，零 stub
npm run test:all  # 全部 139 项
```

浏览器阶段需要 `puppeteer-core`：先在本包 `node_modules` 里找，再在已安装的 DSH profile 里找
（默认 `~/.dsh/profiles/desktop`，可用 `DSH_PROFILE_MODULES` 覆盖）。Chrome 用 `CHROME_PATH` 指定，
否则按常见安装位置探测（Windows 的 Chrome / Edge、Linux 的 `google-chrome` / `chromium`、macOS 的
Chrome）；**一个都没找到就直接失败**（`no Chrome/Edge binary found`），不会假装通过 ——
GitHub 的 `ubuntu-latest` runner 自带 Chrome，所以 CI 跑得动这一阶段。

`lib/*.js` 既是源码又是产物，没有构建步骤，所以这里也没有「构建幂等性」可校验。

## 一、合成套件 `scripts/verify.mjs`（100 项）

对着**真实产物**跑断言，分两阶段。

### `[1/2] host half`

用替身 `ctx` 收集注入行与路由，再用真 HTTP server 压测素材：

| 组 | 断言 |
| --- | --- |
| 注入行 | 一条 `style`、一条 `script`（`placement: head`）、一条 `global`；CSS 里有 `dshicpc-first`、`z-index: 2147483000`；脚本里读 `localStorage`、`mode==="off"` 直接返回、暴露 `__dshIcpcFirstFrame`、带 `window.setTimeout(end,8000)` |
| 路由注册 | 恰好三条，且**每条都包在 `ctx.effect` 里**（拆解得住，不然热重载会重复注册） |
| `meta.json` | `200`、`ok: true`、三个模式、`defaultMode: "intro"`、键名、两个 clip；`POST` → `405` |
| 素材 | `200`、`content-type: video/mp4`、`accept-ranges: bytes`、`content-length` 与磁盘一致、**逐字节等于磁盘上的文件**、是合法 ISO-BMFF（`ftyp`）、且 `moov` 在 `mdat` 之前（faststart） |
| `HEAD` | `200`、保留 `content-length`、**不带 body** |
| 闭区间 `bytes=0-99` | `206` + `content-range: bytes 0-99/<total>` + 字节逐位相符 |
| 开区间 `bytes=1000-` | `206` + 到文件末尾 + 字节逐位相符 |
| 后缀区间 `bytes=-512` | `206` + 最后 512 字节逐位相符 |
| 越界 `bytes=99999999-` | `416` + `content-range: bytes */<total>` |
| 错误方法 `PUT` | `405` |

### `[2/2] browser（real Chrome + real client bundle + real mp4 over http）`

把插件自己产出的注入行摆进一个空白页，用真 Chrome 加载真 `lib/client.js`，素材走真 HTTP 路由：

| 组 | 断言 |
| --- | --- |
| 首帧先于一切 | 页面脚本一跑（早于任何客户端插件代码）遮罩类就在 `<html>` 上，握手全局已存在 |
| 默认档播放 | 遮罩被撤、stage 以 shadow DOM 挂载、`video` 达 `readyState >= 1`、`1920x1080`、`duration 5`、无 media error、`currentTime` 实时推进 |
| 自然结束 | 播完退场，`html` 上的遮罩类与元素都不残留 |
| 霓虹档 | `__dshIcpcPreview('neon')` 真的换片源、换暗角背景，`duration 6` |
| `Esc` / 点击跳过 | 两条路径各自都能在影片中途退场 |
| `off` | 既无遮罩类、无握手副作用、也不挂 stage |
| 偏好持久化 | 写成 `neon` 后跨刷新生效 |
| 像素证据 | 见下表 |
| 素材 404 | **退场逻辑仍然成立、不留残层**（专门造一个坏路由来打这条） |

像素采样的意义：本项目的开发机没有可用的视觉模型，验证不能靠「看截图」。所以直接把影片**精确定位
到指定时间点**再采样像素，证明屏幕上确实是 ICPC 动画本身，而不是一块黑屏或一帧卡住的画面：

| 采样点 | `lit`（非近黑像素占比） | `saturated`（带色像素占比） | 结论 |
| --- | --- | --- | --- |
| intro `t=0` | 0.0000 | 0.0000 | 第 0 帧纯黑 → 遮罩交接不可见 |
| intro `t=3.6` | 0.0605 | 0.0476 | 已是彩色线稿（非黑像素里 79% 带色） |
| neon `t=5.4` | 0.1769 | 0.0904 | 比标准片头更亮（平均亮度 13.6 vs 8.4） |

跑完会把三张截图写进 `docs/`：`preview-first-frame.png`（t=0 的纯黑首帧）、`preview-intro.png`、
`preview-neon.png`。CI **不**校验这三张图与代码同步：截图依赖 `currentTime > 3.4` 的等待，
在慢机器上会间歇性对不上，把它当门只会制造假失败。

## 二、真实应用套件 `scripts/e2e.mjs`（39 项）

合成套件再全，也证明不了四件事：DSH 是否真的发现这个 bundle、是否真的应用了 `cordis.patch.yml`、
是否真的在自己的 web server 上挂出那三条路由、是否真的用自己的 `__ModuleLoader__` 求值浏览器半边。
这个脚本用**真实 DSH** 回答这四件事，零 stub。

### 它怎么做到不打扰正在运行的 DSH

1. 在临时目录（`%TEMP%\dsh-icpc-boot-e2e`，可用 `ICPC_E2E_HOME` 覆盖）搭建一个一次性 `DSH_HOME`，
   里面只有一个 profile，bundle 列表是 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` +
   `dsh-icpc-boot`；
2. 用 junction 把已安装的包树（`~/.dsh/profiles/node_modules`）借进来，再把本包 link 进去 ——
   **不安装、不联网**；
3. `spawn(dsh, [profile, '--port', '0', '--no-open'])` 启动真应用，`--port 0` 让内核挑空闲端口，
   从启动行里用正则抓出带 token 的 URL（裸访问返回 `401 dsh web authentication required`）；
4. 真 Chrome 连上去跑检查；退出时 `taskkill /PID <pid> /T /F` 收进程、删掉临时 home。

**你正在用的 profile、存储和会话完全不被触碰**，所以随时可以重跑。

```sh
npm run e2e
DSH_E2E_URL=http://127.0.0.1:19387/?token=… node scripts/e2e.mjs   # 直连已启动的实例
ICPC_E2E_KEEP=1 npm run e2e                                        # 保留临时 home 供排查
DSH_BIN=/path/to/dsh npm run e2e                                   # 指定 dsh 可执行文件
```

### 三组检查

| 组 | 断言 |
| --- | --- |
| `[1/3]` 宿主路由 | `meta.json` 真的在 DSH 的 web server 上：`200`、`content-type`、`content-length` 与磁盘一致、`accept-ranges: bytes`、`Range` → `206` + `bytes 100-199/<total>` |
| `[2/3]` 真应用里的开屏时序 | `window.__ModuleLoader__` 存在；注入行真的进了文档（`style` / `script` 标签都在）；`__dshIcpcFirstFrame` 与 `__dshIcpcBootVersion` 到位；遮罩在客户端代码之前就位；stage 以 shadow DOM + `video` 挂载，`1920x1080` / `duration 5` / 无 media error；`currentTime` 真在推进；**遮罩不是被 8 s 兜底撤掉的**（实测 `coverRetiredAt` 是导航后几百毫秒）；`pageerror` 与 console error 均为 0 |
| `[3/3]` 跳过 / `off` / 第二个片头 | `Esc` 能跳过；`off` 档既不注入遮罩类也不挂 stage；霓虹偏好跨刷新生效 |

### 实测结果

`39/39 end-to-end checks passed`，采样数字与合成套件**逐位一致**。最有说服力的一条是第 2 组里的
时序断言：遮罩在**导航后约 200–340 ms** 就被浏览器半边撤掉（同一套件在不同缓存状态下分别测得
340 ms 与 201–251 ms），远早于任何兜底超时 —— 说明这次交接是产品逻辑干成的，不是超时蒙对的。

## 这套件证明不了什么

- 它跑在**一次性隔离 profile** 上，不是跑在装了一堆第三方插件的真实 profile 上；插件之间的
  `index-inject` 抢屏（例如与 dsh-550c-boot 同时启用）不在这套件的覆盖范围内。
- 它只用真 Chrome（以及 CI 上 runner 自带的浏览器）验证，不覆盖其它浏览器。
- 像素采样证的是「画面在动、在变亮、在带色」，不是「动画好看」。
