# 无限虾节点插件

基于 basketikun/infinite-canvas v0.19.0 的原生插件 SDK，源码与宿主分开。入口为 `src/index.tsx`。

当前提供原稿导入和分集预览、项目与分集保存、角色/场景/道具/声线资产、媒体版本关联、剧本与镜头编辑、镜头投放画布、产物包验证后提交，以及工作区 JSON 导入导出。重复投放更新同一个节点。

项目保存在浏览器 IndexedDB 的 `infinite-canvas-plugins` 数据库、`infinite-xia` 对象仓库。明确指定命名空间，避免宿主刷新时先恢复节点、后注册插件导致读错仓库。不同浏览器、端口及域名的数据各自独立。

## 本地使用

先在 `studio/plugins/canvas/sdk` 执行 `bun install`，然后在本目录执行：

```powershell
bun install
bun run build
```

构建会生成 `dist/infinite-xia.js` 并同步至宿主 `web/public/plugins/`。在 `studio/web` 执行 `bun install` 和 `bun run dev`，在“节点插件”中启用自动发现的“无限虾”，然后从“扩展节点”添加。新发现插件默认禁用。也可在节点插件管理中安装构建产物的 URL。

## 保存的旧版源码

`core/` 是已接入插件的纯业务模型、仓库、验证器和测试。`preserved/` 单独保留旧无限虾的页面、API、后端与设计文档，文件以 `.source` 后缀存档，不会参与构建或测试。

这次完成独立插件基础工作流；旧版完整页面、AI 自动编剧调用、媒体裁剪界面和 Go 服务没有迁入当前运行插件。保留源码不等于这些功能已经可用。没有复制其他旧片场小功能。

## 验证及许可

`bun run test`：68 项业务与存储测试通过；`bun run typecheck` 和 `bun run build` 通过。独立浏览器页面完成项目、两集、剧本、镜头、重复投放及刷新恢复验收。媒体文件、产物审核和 AI 联动尚未完成浏览器端全流程验收。

旧业务代码保留原 AGPL-3.0-or-later 和各文件声明。部分 DramaClaw 来源文件保留 Elastic-2.0 声明；不得将存档代码统一声明为宿主的 MIT 许可证。
