# Credits

## 架构参考

这个插件的**开机时序架构**——「宿主半边用 `webserver/index-inject` 抢在文档解析阶段盖住首帧、
浏览器半边在模块求值那一刻挂载影片并同帧退役遮罩、bundle 层用 `cordis.patch.yml` 声明」——
参考并沿用了 [yannicksong0106/dsh-550c-boot](https://github.com/yannicksong0106/dsh-550c-boot)
（作者 Ziyang Song）的做法。该项目的宿主半边与浏览器半边的分工、以及它对 DSH 启动时序的实测结论
（启动卡 67 ms 出现、插件 bundle 338 ms 才执行），是本插件能盖住首帧的前提。

本插件与它没有代码依赖关系：`lib/index.js` 与 `lib/client.js` 都是为本插件重写的，
只有片头动画、配色和素材是 ICPC 自己的。

## 影片素材

`assets/icpc-intro.mp4`（5.0 s）与 `assets/icpc-neon.mp4`（6.0 s）由 ICPC 横版标识
`banner_clean.png`（5049×1076）**真实像素切片**逐帧渲染而成，没有转码、没有抽帧，
插件原样提供这两个文件。

## 商标

ICPC 名称与标识是 ICPC 基金会及其权利人的商标。本插件仅作展示用途，
与 ICPC 官方没有任何隶属或背书关系。
