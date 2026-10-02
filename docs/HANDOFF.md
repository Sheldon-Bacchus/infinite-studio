# 无限画布与无限片场长期交接

## 维护约定

本文件是固定交接入口，后续原地更新，不再用新增日期文件代替。两个仓库的 docs/HANDOFF.md 保存同一份联合交接内容；修改一份时同步另一份，再分别提交上传。旧日期交接和 completion-audit.md 作为历史证据保留。

每次任务结束更新：当前目标、实际完成、验证证据、已知阻塞、下一步、源码路径和远程分支。区分“已写代码”“测试通过”“真实使用验收通过”；不能把推送成功算作功能完成。不要写入Token、密钥或用户媒体。未重新检查的运行状态应标为上次核对结果。

## 用户目标与范围

保留并上传无限画布及无限片场的全部项目源码，核对既有要求是否完成；画布重点包括快捷打开、MCP本地素材工具和AutoDL导入。片场要求本机固定工作区、跨浏览器共享同一数据及完整创作流程。当前交接覆盖仓库规格、计划、TODO和验收文档；未记录的历史要求仍需补充，不能宣称所有要求已完成。

## 源码与Git入口

| 项目 | 本地路径 | GitHub保存入口 | 已核对的源码提交 |
| --- | --- | --- | --- |
| 无限画布 | E:/all-agent-workspace/infinite-canvas | https://github.com/Sheldon-Bacchus/infinite-canvas-suite/tree/local-source-2026-10-02 | d3a1b7f |
| 无限片场 | E:/all-agent-workspace/infinite-studio | https://github.com/Sheldon-Bacchus/infinite-studio/tree/main | 7b42244 |

以上提交是本次交接建立前的源码基线，后续提交以git log为准。画布本地main推送至personal远程的local-source-2026-10-02分支；origin仍指向basketikun上游且只有读取权限。不要误推上游，也不要覆盖私人仓库main的旧实现。片场使用origin/main。两个仓库本轮上传后已确认工作区干净；未来接手先重新运行git status。

## 无限画布：当前进度

基础画布、素材管理、图像/视频请求已有实现。前端 bun run test：19通过、0失败；bun run typecheck通过；bun run build通过，8586模块，存在分包体积/动态导入提示。这些结果不代表全部浏览器交互通过。

### 快捷打开

quick-launch.ps1与canvas-agent/quick-launch.ps1都已上传。支持Production、Development、Stop、Menu。

- Development：启动本地Vite，端口43871，打开脚本内固定canvasId。
- Production：打开https://canvas.best/canvas?mode=recent，并非本地构建站点。
- Agent：复用配置中的服务，或通过npx -y @basketikun/canvas-agent@latest启动上游npm包。

待修衔接：启动器未直接启动仓库内修改过的Agent，不能保证新增本地工具被加载。插件plugins/infinite-canvas/.mcp.json同样使用上游npm包。源码上传完整不等于这些入口已经运行本地定制代码。两个脚本当前内容重复，修改时保持一致。

### MCP本地工具

canvas-agent/src/canvas/local-assets.ts、schemas.ts、session.ts和server/mcp.ts已上传。包含local_assets_search、canvas_import_local_assets、canvas_create_attachment_nodes。搜索仅针对明确授权的本地目录；临时assetId仅本次Agent会话有效。素材导入使用带Token的本地二进制接口，创建图片/视频/音频节点，不自动进入“我的素材”。授权目录配置localAssetDirectories与用户本机连接配置留在本地。

前端本地导入5项测试通过，覆盖部分读取失败清理、授权撤销/超时及切换画布防止晚到写入。真实MCP调用和上述启动入口仍需联调。

### AutoDL

配置包：plugins/model-profiles/autodl-core-workflows/AutoDL-核心视频工作流.json；配置页选择“导入配置”。导入保留已有AutoDL Token及其他渠道，设置autodl协议，替换该渠道五项预设，默认minimax_h3_zm_u24。

五项：minimax_h3_zm_u24、minimax_h3_image_audio_to_video_v2_15s、minimax_h3_image_audio_to_video、minimax_h3_lightx2v、wan2.2animate-v4-motion_retargeting。

升级画质版支持1–15秒、最多9张图与3段音频、480p/768p，要求提示词和参考图。已有任务提交、轮询、媒体转换、节点任务恢复代码。11项AutoDL mock测试通过；不证明升级画质真实生成通过。已有节点可能保留旧模型，导入配置不会自动改写全部节点。首尾帧工作流只有一张参考图时复用为首尾帧的行为需核对预期。真实CORS、Token权限、结果下载及刷新恢复待验收；没有提交收费生成，下一步收费调用须由用户明确授权。

### 其他待办

Claude CLI迁移Agent SDK、工具队列、Skill网络安装、资源文件管理和受控记忆仍未完成；UI与历史持久化等完整清单见docs/content/docs/progress/pending-test.zh-CN.mdx。

## 无限片场：当前进度

处于基底迁移与工作区实现阶段，尚未达到统一、完整可用的产品验收状态。

- 新前端studio/web为Vite/React Router，实验端口43863。router尚无/xiaji路由。
- 旧工作台start-studio.ps1恢复.recovery/studio，来自历史提交7b42105；前端43862/xiaji，旧API8086。恢复入口与新入口独立，未统一。
- start-studio.ps1启动旧Go服务；新的workspace-service不能凭同一端口名称视作已经启动或接通。不要同时抢占8086。
- workspace-service及前端已有CAS提交、媒体fileId、ZIP v3导入、保存状态和MCP操作回执初版。
- 片场前端14项测试通过；无限虾插件68项测试通过。插件preserved内保留旧界面/服务，未全部移植；媒体上传、制品评审和AI集成仍待浏览器验收。

### 明确阻塞

前端bun run typecheck失败，6处诊断：model-script-editor.tsx的Modal content样式类型；canvas-generation-helpers.ts重复fileId；commit-queue.ts phase类型收窄比较；video/index.tsx使用GeneratedVideo.fileId但类型缺字段；CanvasStore和AssetStore持久化状态类型不匹配。

workspace-service运行go mod tidy补齐go.sum后，go test ./...仍编译失败：internal/workspace/files.go:154与backup.go:331重复定义hashFile。补齐依赖清单已提交；不能写成后端测试通过。片场构建未运行。

### 数据与验收边界

本机数据根E:/all-agent-workspace/infinite-studio-data位于仓库外；上次核对有workspace.sqlite和files目录，缺workspace.json。不能自动初始化或把旧库直接当新工作区，不能用空项目冒充恢复。旧未提交数据库/原件不保证找回。

跨Edge/Chrome/Codex共享、刷新与重启、真实并发冲突、离线草稿、媒体原件恢复、MCP持久回执、备份哈希与隔离恢复尚未完成运行验收。验收详情见docs/local-workspace-verification.md，规格见docs/local-workspace-plan.md，恢复说明见docs/studio-recovery.md。

## 下一步顺序

1. 画布先修快捷启动与MCP入口，使其加载仓库内定制Agent；验证搜索本地素材、三类媒体导入及附件节点。
2. 片场先处理6处前端类型诊断与Go重复函数，再重跑相关测试和构建。
3. 使用隔离测试数据验证工作区，不迁移或覆盖用户数据库；核对启动服务与前端实际请求目标。
4. 统一旧工作台和Vite入口，再验收跨浏览器、刷新重启、冲突、媒体、ZIP及备份恢复。
5. 经明确授权后验收AutoDL真实生成与任务恢复；补齐其余Agent、Skill与旧创作功能。

## 接手检查

先读项目AGENTS.md、本文件及对应规格。检查Git根目录、工作区变更、远程分支、监听服务和实际配置，保留用户现有改动。不要关闭用户浏览器或替换当前画布内容；验收使用独立页面。源码/文档/脚本已上传，.gitignore排除的密钥、数据库、node_modules、构建产物与.recovery缓存不在GitHub。
