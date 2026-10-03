# Changelog

## 0.1.0

首个版本。

- 宿主半边：`webserver/index-inject` 注入首帧遮罩（纯色 / 径向渐变）+ 同步退场脚本，
  并注册三条 exact 路由提供两个 mp4 与 `meta.json`。
- 素材路由支持 `Range` 请求（闭区间 / 开区间 / 后缀区间），不可满足区间返回 `416`，
  非 `GET/HEAD` 返回 `405`，`HEAD` 不带 body。
- 浏览器半边：模块求值期即挂载影片并撤掉遮罩，影片结束 / 出错 / 点按 / <kbd>Esc</kbd> 都能退场，
  并有 `duration + 2.5 s` 与 9 s 两档看门狗兜底。
- 设置 → 通用 新增「ICPC 开屏动画」行：标准片头 / 霓虹片头 / 关闭，外加「预览」按钮。
- 偏好存 `localStorage["dsh-icpc-boot:mode"]`，`off` 时不注入遮罩也不挂载影片。
- `node scripts/verify.mjs`：在合成环境里对着真实产物跑 100 项断言（宿主路由 + 真 Chrome 播放 +
  精确定位采样像素），并把三张预览图写进 `docs/`。Chrome 自动探测（含 Linux / macOS），
  可用 `CHROME_PATH` 指定；`puppeteer-core` 从本包或已安装的 DSH profile 解析。
- `node scripts/e2e.mjs`：在**真实 DSH web 应用**上跑 39 项断言，零 stub。脚本自建一个临时目录下的
  一次性 `DSH_HOME` 与 profile（junction 借用已装包树，不安装不联网），
  启动 `dsh <profile> --port 0 --no-open` 后从启动行抓取带 token 的 URL，
  跑完自动收进程、删临时 home，不触碰用户自己的 profile。
  实测 `39/39`，采样数字与合成套件逐位一致。
- 脚本分三档：`npm test`（`check` + `verify`，不需要装 DSH）、`npm run e2e`、
  `npm run test:all`（139 项）。
- 零运行时依赖，无构建步骤。
