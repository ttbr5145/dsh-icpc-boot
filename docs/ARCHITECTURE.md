# 工程结构与时序

[← 回到 README](../README.md)

## 目录结构

```
lib/index.js             宿主半边：注入首帧遮罩 + 三条素材路由（ESM，手写）
lib/client.js            浏览器半边：挂载 / 退场 / 设置行（__ModuleLoader__ 包，手写）
cordis.patch.yml         bundle 补丁：insert id=icpc-boot → name=dsh-icpc-boot
assets/icpc-intro.mp4    标准片头原文件（294 341 B）
assets/icpc-neon.mp4     霓虹片头原文件（448 674 B）
scripts/verify.mjs       合成套件（100 项）
scripts/e2e.mjs          真实应用套件（39 项），自建一次性 profile
docs/                    预览图、本文件、验证说明、desktop profile 手动安装说明
screenshots.json         对外预览图清单
```

## 为什么与 dsh-550c-boot 的结构不同：素材原样提供，不「提取」

[dsh-550c-boot](https://github.com/yannicksong0106/dsh-550c-boot) 的动画来自一个独立 HTML 页面，
所以它必须 `scripts/extract.mjs` 把样式表 / DOM / 脚本机械搬运进 `src/`，再由 `scripts/build.mjs`
拼成 `lib/client.js`；它也因此需要「构建产物提交进仓库 + CI 校验源码与产物同步」这一整套纪律。

本插件的素材本来就是**成品 mp4**，所以走的是最短的一条路：

- 两个文件原样提供，**不转码、不抽帧、不重写**，`lib/*.js` 直接就是最终产物；
- 因此没有 `src/`、没有构建脚本、没有产物同步校验，`npm run check` 只是 `node --check` 两个文件；
- 代价是浏览器要自己解码 mp4，收益是屏幕上放的就是作者交付的那一版动画。

### 遮罩为什么不是「影片首帧的截图」

抽首帧需要 ffmpeg，本项目刻意不依赖它。两个片头的第 0 帧本来就是纯黑（实测非近黑像素占比
`0.0000`），所以遮罩直接用影片自己的底色：

| 模式 | 遮罩背景 | 理由 |
| --- | --- | --- |
| `intro` | `#000` | 影片第 0 帧纯黑，交接无接缝 |
| `neon` | `radial-gradient(ellipse 72.9% 74.1% at 50% 46.3%, #0a122c 0%, #050916 25%, #020308 50%, #000 75%)` | 复刻影片自己的暗角，让遮罩、解码前的 `<video>` 表面与第一帧解码结果三者一致 |

换成首帧非黑的素材，就得回到抽帧或手工调色，见 README 的「已知限制」。

## 启动时序与挂载策略

DSH 自己有一张开机卡片（`[data-dsh-boot]`，`HARNESS / Loading plugins…`），由 shell 内核绘制，
按插件加载进度更新，全部加载完才移除。而客户端插件要被下载、求值、再走 cordis 装配 —— 实测遮罩
**在导航后约 200–340 ms 才有机会被客户端代码撤下**（`scripts/e2e.mjs` 记录的 `coverRetiredAt`，
同一套件在冷 / 暖缓存下分别测得 340 ms 与 201–251 ms），这与「内核先画卡片」的量级完全对得上。

也就是说：**只靠客户端半边，卡片一定会露脸。**

### 首帧交给宿主半边

能早于 shell 的只有**被送出的那份文档**本身。DSH 正好留了这个口子：`webserver/index-inject` 收集
一张 index 注入行表，Web 载体把它渲染进 index.html（紧跟 `<head>`，早于 shell 的 module script）。

于是 [`lib/index.js`](../lib/index.js) 推三行：

| 行 | 内容 | 作用 |
| --- | --- | --- |
| `style` | `html.dshicpc-first{background:#000}` + `html.dshicpc-first::before{content:"";position:fixed;inset:0;background:…;z-index:2147483000;pointer-events:none}` | 盖住全屏，且不拦点击 |
| `script`（`placement: head`） | `FIRST_FRAME_SCRIPT` | 见下 |
| `global` | `__dshIcpcBootVersion = <package.json version>` | 让控制台能直接读到插件版本 |

`FIRST_FRAME_SCRIPT` 是同步的、必须在文档还在解析时就跑完，所以它只做三件事：

1. 读 `localStorage["dsh-icpc-boot:mode"]`；`off` 档**直接 return**，连一张黑屏都不会出现，
   `neon` 档给 `<html>` 打上 `data-dsh-icpc-mode="neon"` 以切到暗角背景；
2. 给 `document.documentElement` 加 `dshicpc-first` 类 —— 遮罩这一刻就在屏幕上了；
3. 把 `window.__dshIcpcFirstFrame = { end, mode }` 挂出去，作为与浏览器半边的握手。

### 首帧自己的兜底

首帧不会赖着不走（脚本每行都有原因，见 [`lib/index.js`](../lib/index.js) 的注释）：

| 路径 | 触发条件 |
| --- | --- |
| `end()` 被浏览器半边调用 | 正常交接：影片一进 DOM 就撤 |
| 卡片消失 | `[data-dsh-boot]` 查询为 `null`，且此前见过卡片 → 应用已挂载 |
| 卡片丢掉 spinner | `[data-dsh-boot-spinner]` 为 `null` → shell 进了自己的失败态，页面必须可读 |
| 绝对上限 | `window.setTimeout(end, 8000)`（`FIRST_FRAME_MAX_MS`） |

客户端挂了、别的插件把 shell 弄挂了，页面都还是能看能点的。

### 浏览器半边的两段式退场

[`lib/client.js`](../lib/client.js) 在**模块求值的那一刻**就挂载影片，而不是等 cordis 调 `apply` ——
`apply` 只留给设置行注册与 `ctx.effect` 拆解。影片一进 DOM 就调用 `__dshIcpcFirstFrame.end()`，
两者在**同一个任务、同一帧**完成，所以交接不可见。

片头结束（或跳过）后不是整屏一次性淡出，而是 `FADE_MS = 460 ms` 的 `opacity` 过渡，
过渡结束的定时器同时负责把元素从 DOM 里摘掉。

## 两条半边的交接约定

改一边必须改另一边，两边注释里都写了：

| 约定 | 值 | 作用 |
| --- | --- | --- |
| 偏好键 | `localStorage["dsh-icpc-boot:mode"]` | 注入脚本自己就读它，`off` 档在解析期就决定不作画 |
| 首帧全局 | `window.__dshIcpcFirstFrame.end()` | 浏览器半边撤掉遮罩的唯一正常入口 |
| 版本全局 | `window.__dshIcpcBootVersion` | 与 `package.json` 的 `version` 同源 |
| 调试全局 | `window.__dshIcpcBoot` / `window.__dshIcpcPreview` | `readMode` / `writeMode` / `stop` / 立刻重播 |

## 退场的看门狗（浏览器半边）

元数据到手后按 `duration + 2500 ms` 兜底（`WATCHDOG_SLACK_MS`，标准片头即 7.5 s、霓虹 8.5 s），
元数据一直拿不到则 `WATCHDOG_IDLE_MS = 9000 ms` 兜底；`ended`、`error`、`autoplay` 被拒、点击、
<kbd>Esc</kbd> 都会退场 —— **任何情况下都不会把遮罩留在屏幕上**，合成套件里连「素材 404」这一条
都有专门断言。

## 素材路由与 Range 语义

宿主半边用 `ctx.inject(['webServer'], …)` 注册三条 `exact` 路由（可选注入，没有 HTTP 载体的
profile 仍能拿到开屏层）：

| 路由 | 内容 |
| --- | --- |
| `GET /dsh-icpc-boot/meta.json` | 版本、模式清单、默认模式、localStorage 键名、片头清单（`{mode, path, type}`） |
| `GET /dsh-icpc-boot/assets/icpc-intro.mp4` | 标准片头 |
| `GET /dsh-icpc-boot/assets/icpc-neon.mp4` | 霓虹片头 |

影片一定要支持 `Range`：浏览器发现响应带 `accept-ranges: bytes` 就会带 `Range` 头来取，
否则拖动进度条和边下边播都会退化。实现过的语义（每条都有断言）：

| 情况 | 响应 |
| --- | --- |
| 整体 `GET` | `200` + `content-length` + `accept-ranges: bytes` + 整个文件 |
| `HEAD` | `200` + 同样的头，**不带 body** |
| 闭区间 `bytes=100-199` | `206` + `content-range: bytes 100-199/<total>` |
| 开区间 `bytes=100-` | `206` + 从 100 到末尾 |
| 后缀区间 `bytes=-100` | `206` + 最后 100 字节 |
| 语法合法但越界 | `416` + `content-range: bytes */<total>` |
| 非 `GET/HEAD` | `405`（`meta.json` 与素材都一样） |
| 其它路径 | 不由本插件处理 —— 三条路由都是 `exact` 注册，不抢别的路径 |

文件读一次就常驻内存（`assetCache`）——最大的一个不到半兆，磁盘再读一遍没有意义。
