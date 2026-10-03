# dsh-icpc-boot

[English](README.en.md) | [中文](README.md)

**给 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）的 Web 界面加一段 ICPC 标识开场影片。**
启动时全屏播放，播完自动退场；点画面或按 <kbd>Esc</kbd> 随时跳过；通用设置里可以换成霓虹款或直接关掉。

![标准片头：ICPC 几何标成形](docs/preview-intro.png)

![霓虹片头：辉光定格](docs/preview-neon.png)

## 特性

- 🎬 **两个档位**：标准片头 5 秒、霓虹片头 6 秒，一键切换或关闭
- ⏭️ **随时跳过**：点画面任意位置或按 `Esc`
- 🧱 **盖住 DSH 自己的启动卡**：首帧遮罩由宿主半边在文档解析阶段注入，
  `HARNESS / Loading plugins…` 不会露脸
- 🎞️ **原片原样**：两个 mp4 不经转码、不抽帧，插件直接把原文件当静态资源提供，支持 `Range`
- 📦 **零依赖、无构建**：`lib/*.js` 就是最终产物，没有打包步骤、没有运行时依赖

## 两个片头

| 模式 | 素材 | 时长 | 观感 |
| --- | --- | --- | --- |
| 标准片头 `intro` | `assets/icpc-intro.mp4` | 5.0 s | 黑场 → 中心火花 → ICPC 几何标（蓝/黄/红）逐块落位 → ICPC 字母去模糊上浮 → 说明文字渐显 → 斜向光带扫过 → 辉光定格 |
| 霓虹片头 `neon` | `assets/icpc-neon.mp4` | 6.0 s | 暗角背景 → 轮廓逐笔霓虹描绘 → 脉冲 → 实体 LOGO 按覆盖度逐像素显形 → 辉光定格 |
| 关闭 `off` | — | — | 不注入任何遮盖层，也不挂载影片 |

两个片头的**第 0 帧都是纯黑**（实测非近黑像素占比 `0.0000`），这是「遮罩 → 影片」能无缝交接的前提。

## 安装

插件是普通的 DSH profile bundle：一份 `package.json`（声明 `dsh.bundle.patch`）+ 一个
`cordis.patch.yml`（往 bundle 层 insert）+ 两个半边（`lib/index.js` 走宿主、`lib/client.js` 走浏览器）。

装完**必须重启 DSH**：bundle 层只在启动时装配，刷新页面不够。

### 普通 profile（`web` 等）

```sh
dsh plugin --profile web add /path/to/dsh-icpc-boot
```

或者手动改 profile 的 `package.json`（CLI 走的也是这条路）：

```jsonc
{
  "dependencies": { "dsh-icpc-boot": "link:/path/to/dsh-icpc-boot" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-icpc-boot"] } }
}
```

`link:` 在 Windows 上物化成 junction，在其它平台是符号链接。发布到 npm 之后也可以直接
`dsh plugin --profile web add dsh-icpc-boot`。

### desktop profile（Electron 桌面应用）

`dsh plugin --profile desktop …` 会被守卫挡下（该 profile 由 Electron 应用独占管理），
得手动改 profile 工程。完整步骤、为什么不跑 `pnpm install`、以及如何不启动应用就验证接线，
见 **[docs/DESKTOP-PROFILE.md](docs/DESKTOP-PROFILE.md)**。

### ⚠️ 和别的开屏插件抢屏

任何同样「在首帧盖一层」的插件（例如 [dsh-550c-boot](https://github.com/yannicksong0106/dsh-550c-boot)）
都会和本插件抢屏，两者只能启用其一：把其中一个从 `dsh.profile.bundles` 里移掉，
或在 profile 的 `cordis.patch.yml` 里给它加 `disabled: true`。

## 使用

设置 → **通用** → 「ICPC 开屏动画」：下拉选 **标准片头 / 霓虹片头 / 关闭**，
右侧「预览」按钮可以立刻重播当前选中的片头。

偏好存在浏览器 `localStorage` 的 `dsh-icpc-boot:mode` 键；`off` 时插件完全不碰 DOM。

调试入口（浏览器控制台）：

```js
__dshIcpcBoot.readMode()      // 当前偏好
__dshIcpcBoot.writeMode('neon')
__dshIcpcPreview('intro')     // 立刻重播，返回 stop 函数
__dshIcpcBoot.stop()          // 立刻退场
```

## 实现要点

两个半边，各自负责首帧的不同阶段 —— 这是本插件最关键的设计约束：

- **宿主半边**（`lib/index.js`）在 shell 之前注入一段样式和一段**同步**脚本，用
  `html.dshicpc-first::before` 铺一层与影片首帧同色的纯黑/径向渐变遮罩（`z-index: 2147483000`），
  把 DSH 自己的启动卡盖住。时间尺度决定了这一层只能靠 `webserver/index-inject`：DSH 的开机卡片由
  shell 内核在插件加载完成之前就画出来了，而实测**遮罩要等到导航后约 200–340 ms 才有机会被客户端
  代码撤下**（`scripts/e2e.mjs` 记录的 `coverRetiredAt`），等不了客户端代码。
- **浏览器半边**（`lib/client.js`）在**模块求值期**就挂载影片（早于 cordis 调 `apply`），
  影片一进 DOM 就撤掉遮罩（`__dshIcpcFirstFrame.end()`），`apply` 只留给设置行注册和拆解。
- 影片由宿主注册的三条 exact 路由提供，`Range` 请求真的实现了（浏览器可以边下边播 / 拖动进度）：

  | 路由 | 内容 |
  | --- | --- |
  | `GET /dsh-icpc-boot/meta.json` | 版本、模式列表、默认模式、localStorage 键名、片头清单 |
  | `GET /dsh-icpc-boot/assets/icpc-intro.mp4` | 标准片头（294 341 B） |
  | `GET /dsh-icpc-boot/assets/icpc-neon.mp4` | 霓虹片头（448 674 B） |

  非法 `Range` 返回 `416` + `content-range: bytes */<total>`，非 `GET/HEAD` 返回 `405`，
  `HEAD` 保留 `content-length` 但不带 body。
- **看门狗**：元数据到手后按 `duration + 2.5 s` 兜底退场，元数据一直拿不到则 9 s 兜底；
  `error`、`autoplay` 被拒、播完都会退场 —— **任何情况下都不会把遮罩留在屏幕上**。

## 仓库结构

```
lib/index.js        宿主半边：注入首帧遮罩 + 三条素材路由（ESM，手写）
lib/client.js       浏览器半边：挂载 / 退场 / 设置行（__ModuleLoader__ 包，手写）
cordis.patch.yml    bundle 层：insert id=icpc-boot → name=dsh-icpc-boot
assets/*.mp4        两个片头原文件
docs/               预览图 + 工程结构 + 验证说明 + desktop profile 手动安装说明
screenshots.json    对外预览图清单
submission/data/    准备上架社区集市的双语元数据
scripts/verify.mjs  合成套件（100 项）
scripts/e2e.mjs     真实应用套件（39 项），自建一次性 profile
```

和 [dsh-550c-boot](https://github.com/yannicksong0106/dsh-550c-boot) 的差别：它的动画来自一个独立
HTML 页面，所以需要 `src/` + 提取 / 构建脚本；本插件的素材是成品 mp4，`lib/*.js` 直接就是最终产物，
没有 `src/`、没有构建步骤。原因写在 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 自检

两套互相独立的检查，共 **139 项断言**：

```sh
npm run check     # 两个半边的语法检查
npm run verify    # 100 项：合成环境（替身 loader + 真 Chrome + 真 mp4）
npm test          # check + verify，不需要装 DSH，CI 跑的就是这个
npm run e2e       # 39 项：真实 DSH web 应用，零 stub
npm run test:all  # 全部 139 项
```

浏览器阶段需要 `puppeteer-core`：先在本包 `node_modules` 里找，再在已安装的 DSH profile 里找
（默认 `~/.dsh/profiles/desktop`，可用 `DSH_PROFILE_MODULES` 覆盖）。Chrome 用
`CHROME_PATH` 指定，或自动探测常见安装位置。

### 一、合成套件 `scripts/verify.mjs`（100 项）

对着**真实产物**跑断言，分两阶段：

1. **宿主半边** —— 用替身 `ctx` 收集注入行与路由，再用真 HTTP server 压测素材：
   整体 / `HEAD` / 闭区间 / 开区间 / 后缀区间 / 不可满足区间 / 错误方法，并逐字节比对磁盘上的文件。
2. **浏览器** —— 真 Chrome 加载注入行 + 真 `lib/client.js` + 真 mp4：
   断言遮罩在客户端代码跑之前就已就位、影片真的在解码并推进、遮罩被撤、`Esc` 与点击都能跳过、
   `off` 模式既无遮罩也无影片、霓虹偏好跨刷新生效、**素材 404 时遮罩仍会被撤且不留残层**。

第二阶段还会把影片**精确定位到指定时间点**再采样像素，用来证明屏幕上确实是 ICPC 动画本身，
而不是一块黑屏或一帧卡住的画面（本项目的开发机没有可用的视觉模型，所以验证不靠「看」截图）：

| 采样点 | `lit`（非近黑像素占比） | `saturated`（带色像素占比） | 结论 |
| --- | --- | --- | --- |
| intro `t=0` | 0.0000 | 0.0000 | 首帧纯黑 → 遮罩交接不可见 |
| intro `t=3.6` | 0.0605 | 0.0476 | 已是彩色线稿（带色/非黑 = 79%） |
| neon `t=5.4` | 0.1769 | 0.0904 | 比标准片头更亮（亮度 13.6 vs 8.4） |

跑完会把三张截图写进 `docs/`（就是本页顶部那几张，外加一张记录纯黑首帧的
[`docs/preview-first-frame.png`](docs/preview-first-frame.png)）。

### 二、真实应用套件 `scripts/e2e.mjs`（39 项）

合成套件再全，也证明不了四件事：DSH 是否真的发现这个 bundle、是否真的应用了 `cordis.patch.yml`、
是否真的在自己的 web server 上挂出那三条路由、是否真的用自己的 `__ModuleLoader__` 求值浏览器半边。
`scripts/e2e.mjs` 用**真实 DSH** 回答这四件事。

它先在临时目录搭一个一次性 `DSH_HOME`，里面只有一个 profile，bundle 列表是
`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + `dsh-icpc-boot`；用 junction 借用已安装的包树
并把本包 link 进去，**不安装、不联网**；然后 `dsh <profile> --port 0 --no-open` 启动真应用，
从启动行里抓出带 token 的 URL，用真 Chrome 连上去；跑完自动收进程、删临时 home。
**你正在用的 profile、存储和会话完全不被触碰**，所以可以随时重跑。

```sh
npm run e2e
DSH_E2E_URL=http://127.0.0.1:19387/?token=… node scripts/e2e.mjs   # 直连已启动的实例
ICPC_E2E_KEEP=1 npm run e2e                                        # 保留临时 home 供排查
```

实测 `39/39 end-to-end checks passed`，采样数字与合成套件**逐位一致**，`pageerror` 与 console error
均为 0。最有说服力的一条：遮罩在**导航后约 200–340 ms** 就被浏览器半边撤掉，远早于任何兜底
（首帧脚本 8 s、影片看门狗 7.5 / 8.5 s、无元数据 9 s）—— 说明这次交接是产品逻辑干成的，不是超时蒙对的。

### 逐条明细

上面两节的完整断言清单（每一组的每一条）、以及这套件**证明不了什么**，见
**[docs/VERIFICATION.md](docs/VERIFICATION.md)**。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 目录结构、素材为什么不重写、启动时序与首帧注入、Range 语义、看门狗 |
| [docs/VERIFICATION.md](docs/VERIFICATION.md) | 两套件逐条明细、采样数字、真实应用套件的隔离做法与边界 |
| [docs/DESKTOP-PROFILE.md](docs/DESKTOP-PROFILE.md) | desktop profile 手动安装、为什么不跑 `pnpm install`、接线自检 |
| [docs/PUBLISHING.md](docs/PUBLISHING.md) | 三条安装路径、npm 发布、社区集市上架、发版清单 |

## 已知限制

- 遮罩背景是**纯黑 / 径向渐变**，不是影片首帧的截图（抽帧需要 ffmpeg，本项目没有依赖它）。
  两个片头首帧本来就都是纯黑，所以肉眼无差别；换成首帧非黑的素材就需要另想办法。
- 未设置 Desktop 标题栏同色 token（`--dsw-specific-sidebar-fill` 等），
  Windows 系统标题栏在开屏瞬间颜色不同步。
- `scripts/e2e.mjs` 跑在一次性隔离 profile 上，不是跑在装了一堆第三方插件的真实 profile 上。

## 许可

MIT，见 [LICENSE](LICENSE)。ICPC 名称与标识是 ICPC 基金会及其权利人的商标，
本插件仅作展示用途、与 ICPC 官方无隶属关系。

架构参考与素材来源见 [CREDITS.md](CREDITS.md)。
