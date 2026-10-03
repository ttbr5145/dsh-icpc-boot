# 手动装进 desktop profile

DSH 的 Electron 桌面应用把 `desktop` profile 完全收归自己管理：

```
$ dsh --profile desktop --dump-config
error: profile "desktop" is managed exclusively by the Electron application
```

所以**不能用命令行装**（`dsh plugin --profile desktop …` 会被守卫挡下；市场走的是应用内部通道）。
要手动装，就得直接改 profile 工程。以下路径按 `DSH_HOME`（默认 `C:\Users\<你>\.dsh`）展开。

## 步骤

1. **备份** `profiles\desktop\package.json`。

2. 在它的 `dependencies` 里加一行：

   ```json
   "dsh-icpc-boot": "link:D:/AI/icpc开屏插件/dsh-icpc-boot"
   ```

   `link:` 指向本仓库的绝对路径。用正斜杠可以避免 JSON 里的反斜杠转义。

3. 在同一个文件的 `dsh.profile.bundles` 数组里加一项 `"dsh-icpc-boot"`。
   **顺序有意义**：bundle 层在启动时按这个顺序装配，插件只能看到排在它前面的东西。

4. 让 `profiles\desktop\node_modules\dsh-icpc-boot` 指向本仓库。

   在 Windows 上，pnpm 处理 `link:` 依赖的方式就是建 junction，所以直接建一个同构的即可，
   **不必跑包管理器**：

   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-icpc-boot" `
     -Target "D:\AI\icpc开屏插件\dsh-icpc-boot"
   ```

5. **重启 DSH。** bundle 层只在启动时装配，刷新页面不会让它生效。

## 为什么不直接跑 `pnpm install`

改动 `package.json` 之后，`pnpm-lock.yaml` 就领先/落后了。这不影响使用：
DSH 市场的安装实现用的是 `pnpm install --no-frozen-lockfile`
（`dshmarket/lib/install.js`），下次市场安装会自动把 `link:` 依赖补进 lockfile。

反过来说，`pnpm install` 在这个 profile 上**有风险**：市场自带一层镜像源供应链检查
（`dshmarket/lib/pnpm-compat.js`），只要 lockfile 里存在缺 `integrity` 的 tarball 条目、
或 tarball 地址与 registry 元数据不一致，pnpm 11 会拒绝**该 profile 的所有安装/卸载操作**——
一次失败的安装会把你卡住。手动建 junction 完全绕开了这条路径。

## 验证接线是否正确

不用启动应用，用 Node 的解析规则直接问：

```powershell
node -e "const {createRequire}=require('module');const r=createRequire(process.env.USERPROFILE+'/.dsh/profiles/desktop/package.json');console.log(r.resolve('dsh-icpc-boot'));console.log(r.resolve('dsh-icpc-boot/client'))"
```

两行都应该落到本仓库的 `lib/index.js` 与 `lib/client.js`。

## 本机部署记录（2026-10-03）

这台机器上的实际改动，与上面等价：

| 位置 | 改动 | 备份 |
| --- | --- | --- |
| `%USERPROFILE%\.dsh\profiles\desktop\package.json` | `dependencies` 加 `link:`、`dsh.profile.bundles` 加 `dsh-icpc-boot` | `package.json.icpc-boot-backup` |
| `…\profiles\desktop\node_modules\dsh-icpc-boot` | junction → `D:\AI\icpc开屏插件\dsh-icpc-boot` | — |

`dsh-550c-boot` 保持安装、由用户在 `cordis.patch.yml` 里 `disabled: true` 停用，
**没有卸载**。两个插件都会抢首帧，不能同时启用。

## 与 dsh-550c-boot 抢屏

两个插件的做法一样：在第一帧盖一层遮罩。同时启用会互相抢屏（谁后装配谁在上），
所以要么在 profile 的 `cordis.patch.yml` 里给其中一个加 `disabled: true`，
要么把它从 `dsh.profile.bundles` 里移掉。
