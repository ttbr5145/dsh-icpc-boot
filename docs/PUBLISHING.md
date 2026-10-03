# 分发与发布

[← 回到 README](../README.md)

## 三条安装路径

| 路径 | 适合 | 命令 |
| --- | --- | --- |
| GitHub 直装 | 最终用户，不需要 npm 发布 | `dsh plugin --profile web add github:ttbr5145/dsh-icpc-boot` |
| 本地 `link:` | 开发本插件 | 手改 profile 的 `package.json`，见 README |
| npm | 发布之后 | `dsh plugin --profile web add dsh-icpc-boot` |

装完**必须重启 DSH**：bundle 层只在启动时装配，刷新页面不够。升级之后建议在新窗口里
<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> 硬刷新一次（DSH 给客户端 bundle 发了长缓存）。

`desktop` profile 走的是另一条路（CLI 被守卫挡住），见
[docs/DESKTOP-PROFILE.md](DESKTOP-PROFILE.md)。

## 发布到 npm

`package.json` 已经准备好：`publishConfig.access = "public"`、`license`、`repository` / `homepage` /
`bugs`。

```sh
npm pack --dry-run    # 先看清楚 tarball 里到底有什么
npm publish
```

**发布前务必确认 `assets/*.mp4` 在清单里** —— 两个 mp4 是插件的运行时素材，不是文档。它们在
`files` 字段里显式列出（`"assets"`），`lib/*.js` 之外没有别的东西是必需的。

## 提交到社区集市

`submission/` 是**准备好的上架元数据**，结构与
[dsh-550c-boot](https://github.com/yannicksong0106/dsh-550c-boot) 相同：

```
submission/data/community/dsh-icpc-boot.json              社区列表条目（双语名称与描述、分类）
submission/data/plugins/ttbr5145__dsh-icpc-boot.yml       集市条目（分类、双语描述、tarball 地址）
```

两份文件里的 `tarball:` / `release` 指向
`https://github.com/ttbr5145/dsh-icpc-boot/releases/latest/download/dsh-icpc-boot.tgz`
（资产名不带版本号，所以 `latest` 永远指向最新一版，不会烂掉）。**这个资产要先发一次 Release 才会存在**：

```sh
npm pack                      # 产出 dsh-icpc-boot-0.1.0.tgz
# 把它作为附件上传，并重命名/另存为 dsh-icpc-boot.tgz
```

## 发版清单

1. 改 `package.json` 的 `version`；
2. 在 [CHANGELOG.md](../CHANGELOG.md) 顶部加一条；
3. `npm test`（100 项，不需要装 DSH）；有条件再跑一次 `npm run e2e`（39 项）；
4. commit，打 tag `vX.Y.Z`，推 `main` 与 tag；
5. 在 GitHub 上发 Release，附上 `npm pack` 产出的 `dsh-icpc-boot.tgz`；
6. 需要的话再 `npm publish`。
