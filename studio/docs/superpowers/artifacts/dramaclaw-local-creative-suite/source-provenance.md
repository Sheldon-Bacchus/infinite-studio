# DramaClaw 来源版本核验

状态：可确认本地 DramaClaw 前端副本以官方 `v2.0.5` 为基线；其中存在本地改动文件，不能宣称整份副本是未经改动的 tag 快照。后续纳入移植闭包的文件必须追加逐文件比较和改动归属审查。

## 已核实版本

- 上游仓库：[dramaclaw/dramaclaw](https://github.com/dramaclaw/dramaclaw)
- 上游标签：[v2.0.5](https://github.com/dramaclaw/dramaclaw/releases/tag/v2.0.5)
- 完整提交：[`a09248410343158ba227ec40b5a4dbc1ba4b1444`](https://github.com/dramaclaw/dramaclaw/commit/a09248410343158ba227ec40b5a4dbc1ba4b1444)
- 目标工作区副本：`integrations/dramaclaw/`
- 官方发布页将 v2.0.5 指向提交 `a092484`；官方仓库只读检出该标签后，`git rev-parse HEAD` 得到上面的完整 SHA。

## 证据和边界

1. `integrations/dramaclaw/.git` 是 linked-worktree 指针，目标 `E:/all-agent-workspace/agy-projects/dramaclaw/.git/worktrees/dramaclaw-autodl-h3-review` 不存在，所以不能从该指针读取 HEAD。
2. 工作区另两个 DramaClaw checkout 的 `.git/HEAD` 都指向无效 ref `refs/heads/.invalid`，对象 pack 也不完整；它们的配置只作辅助线索，不能单独证明副本版本。
3. 从官方 GitHub 仓库只读检出 `v2.0.5`，确认标签指向完整 SHA `a09248410343158ba227ec40b5a4dbc1ba4b1444`。截至 2026-09-24 UTC 查询，官方 `main` tip 为 `f51c2e44d01d8cac9b3b8214bcc8de3178df7d09`；这是时间限定的远端观测，不作为本地副本来源推断。
4. 对 `integrations/dramaclaw/frontend/src/` 的 1,199 个文件按类型比较：1,198 个文本文件先将 CRLF 和孤立 CR 统一成 LF，其中 1,180 个与官方 v2.0.5 文本相同、18 个不同、0 个同路径缺失；1 个二进制 GIF（`assets/icons/two-finger-pan.gif`）原始 SHA-256 为 `52d18a1dc24a9f3f286a936031fe4b99b3f24a54b5744eaa2973f4379ccb730a`，与官方文件相同。合计 1,181 个相同、18 个不同、0 个缺失。文本比较不是 Git blob ID 比较。
5. 本文件下列 49 个核心路由、虾塘组件和 query 文件全部与 v2.0.5 文本相同（换行归一化），0 个不同。Repomix MCP 的实际依赖闭包输出包含 74 个文件，其中 39 个与上述核心清单重合，另有 35 个补充调用点文件；补充文件中 33 个文本相同、2 个不同、0 个缺失。不同文件是 `frontend/src/api/ops.ts` 和 `frontend/src/components/episode/beat-workbench/render-section.tsx`，两者需先做差异/改动归属审查，不能当作未经改动的上游文件复制。35 个文件的完整清单见下文。
6. 全部 18 个与 v2.0.5 不同的文件如下。目前只能确认副本内容发生变化，不能仅凭工作区副本判断改动者/动机，也不能将其归到某个上游 commit：

   - `frontend/src/api/ops.ts`
   - `frontend/src/api/skills.ts`
   - `frontend/src/components/themed-toaster.tsx`
   - `frontend/src/components/episode/beat-workbench/render-section.tsx`
   - `frontend/src/components/settings/settings-dialog.tsx`
   - `frontend/src/features/canvas/domain/canvasNodes.ts`
   - `frontend/src/features/canvas/nodes/ImageGenNode.tsx`
   - `frontend/src/features/canvas/nodes/SkillNode.tsx`
   - `frontend/src/features/canvas/nodes/VideoNode.tsx`
   - `frontend/src/features/canvas/nodes/VideoOperationsPanel.tsx`
   - `frontend/src/features/canvas/nodes/shared/videoModelCapabilities.ts`
   - `frontend/src/features/freezone/context/currentBeatContext.ts`
   - `frontend/src/lib/api-errors.ts`
   - `frontend/src/lib/queries/model-gateway.ts`
   - `frontend/src/stores/settingsStore.ts`
   - `frontend/src/__tests__/api/client.test.ts`
   - `frontend/src/__tests__/components/episode/beat-workbench/render-section.test.tsx`
   - `frontend/src/__tests__/features/freezone/current-beat-context.test.ts`

7. 精确结论是“官方 v2.0.5 文本基线 + 1 个相同的二进制 GIF + 18 个未归属本地文本差异”；不是“本地仓库 HEAD 已恢复”，也不是“所有副本文件来自 v2.0.5”。已列出的 49 个核心文件和 35 个补充调用闭包文件共 84 个不同路径，其中 82 个文本匹配 tag、2 个文本不同；其余副本路径只有全量文件比较结果，不能自动推定为页面复用范围内的上游原样文件。

复查方法：对两份 checkout 中每个同路径文本文件读取内容，将 `CRLF` 和孤立 `CR` 统一成 `LF` 后逐字比较；二进制 GIF 对原始字节计算 SHA-256。若另做 Git blob 级复核，应先对目标文本做相同换行归一化，再用 `git hash-object --stdin`，不能拿未经归一化的 Windows 工作区 blob hash 与 LF checkout 比较。比较输出由文件内容生成，没有启动源项目、服务或测试。

## 已比对文件清单（49）

### 路由（12）

- `frontend/src/routes/_app/projects.$project/characters.lazy.tsx`
- `frontend/src/routes/_app/projects.$project/ingest.tsx`
- `frontend/src/routes/_app/projects.$project/episodes.tsx`
- `frontend/src/routes/_app/projects.$project/episodes.$episode/index.lazy.tsx`
- `frontend/src/routes/_app/projects.$project/episodes.$episode/overview.lazy.tsx`
- `frontend/src/routes/_app/projects.$project/episodes.$episode/script.lazy.tsx`
- `frontend/src/routes/_app/projects.$project/episodes.$episode/beats.lazy.tsx`
- `frontend/src/routes/_app/projects.$project/episodes.$episode/audio.lazy.tsx`
- `frontend/src/routes/_app/projects.$project/episodes.$episode/video.lazy.tsx`
- `frontend/src/routes/_app/projects.$project/episodes.$episode/compose.lazy.tsx`
- `frontend/src/routes/_app/projects.$project/episodes.$episode/sketches.lazy.tsx`
- `frontend/src/routes/_app/projects.$project/freezone.lazy.tsx`

### 虾塘控件（13）

- `frontend/src/components/assets/scenes-panel.tsx`
- `frontend/src/components/assets/props-panel.tsx`
- `frontend/src/components/assets/character-voice-panel.tsx`
- `frontend/src/components/assets/narrator-voice-panel.tsx`
- `frontend/src/components/assets/character-image-source-select.tsx`
- `frontend/src/components/assets/asset-beat-references.tsx`
- `frontend/src/components/assets/asset-search-box.tsx`
- `frontend/src/components/assets/character-search.tsx`
- `frontend/src/components/assets/character-stats-strip.tsx`
- `frontend/src/components/assets/scene-asset-card.tsx`
- `frontend/src/components/assets/prop-asset-card.tsx`
- `frontend/src/components/assets/scene-environment-prompt.tsx`
- `frontend/src/components/assets/project-style-chip.tsx`

### 虾面来源组件（7）

- `frontend/src/features/freezone/FreezoneShell.tsx`
- `frontend/src/features/freezone/AssetLibraryPanel.tsx`
- `frontend/src/features/freezone/AssetLibraryBrowser.tsx`
- `frontend/src/features/freezone/CanvasesTab.tsx`
- `frontend/src/features/freezone/CanvasOutlineList.tsx`
- `frontend/src/features/freezone/capabilities/capabilityRegistry.ts`
- `frontend/src/features/freezone/context/beatContextProjection.ts`

### Query/service 定义（17）

- `frontend/src/lib/queries/ingest.ts`
- `frontend/src/lib/queries/projects.ts`
- `frontend/src/lib/queries/characters.ts`
- `frontend/src/lib/queries/scenes.ts`
- `frontend/src/lib/queries/props.ts`
- `frontend/src/lib/queries/episodes.ts`
- `frontend/src/lib/queries/scripts.ts`
- `frontend/src/lib/queries/sketches.ts`
- `frontend/src/lib/queries/sketch-settings.ts`
- `frontend/src/lib/queries/video.ts`
- `frontend/src/lib/queries/audio.ts`
- `frontend/src/lib/queries/tasks.ts`
- `frontend/src/lib/queries/generation-credit-cost.ts`
- `frontend/src/lib/queries/asset-references.ts`
- `frontend/src/lib/queries/character-image-selection.ts`
- `frontend/src/lib/queries/freezone.ts`
- `frontend/src/lib/queries/product-surfaces.ts`

## Repomix 调用闭包补充文件清单（35）

以下清单由本次 Repomix MCP 的 74 个实际文件输出扣除与 49 项核心清单重合的 39 项得到；逐项与 v2.0.5 比较后 33 项文本相同，2 项文本不同（标注“本地差异”），没有同路径缺失。此清单用于核实 source-call-map 中的补充调用闭包，不代表全部文件都应移植。

- `frontend/src/api/ops.ts`（本地差异）
- `frontend/src/api/push.ts`
- `frontend/src/components/episode/beat-workbench/action-panel.tsx`
- `frontend/src/components/episode/beat-workbench/audio-pane.tsx`
- `frontend/src/components/episode/beat-workbench/batch-bar.tsx`
- `frontend/src/components/episode/beat-workbench/batch-panel.tsx`
- `frontend/src/components/episode/beat-workbench/beat-card-grid.tsx`
- `frontend/src/components/episode/beat-workbench/beat-card.tsx`
- `frontend/src/components/episode/beat-workbench/beat-list.tsx`
- `frontend/src/components/episode/beat-workbench/gallery/pipeline-summary.tsx`
- `frontend/src/components/episode/beat-workbench/insert-manual-shot-dialog.tsx`
- `frontend/src/components/episode/beat-workbench/mention-textarea.tsx`
- `frontend/src/components/episode/beat-workbench/narrator-voice-panel.tsx`
- `frontend/src/components/episode/beat-workbench/render-grid-gallery.tsx`
- `frontend/src/components/episode/beat-workbench/render-plan-dialog.tsx`
- `frontend/src/components/episode/beat-workbench/render-section.tsx`（本地差异）
- `frontend/src/components/episode/beat-workbench/render-settings-controls.tsx`
- `frontend/src/components/episode/beat-workbench/single-beat-panel.tsx`
- `frontend/src/components/episode/beat-workbench/sketch-crop-dialog.tsx`
- `frontend/src/components/episode/beat-workbench/sketch-grid-gallery.tsx`
- `frontend/src/components/episode/beat-workbench/sketch-pose-editor-dialog.tsx`
- `frontend/src/components/episode/beat-workbench/sketch-section.tsx`
- `frontend/src/components/episode/beat-workbench/sketch-settings-controls.tsx`
- `frontend/src/components/episode/beat-workbench/sketch-studio-actions.tsx`
- `frontend/src/components/episode/beat-workbench/text-pane.tsx`
- `frontend/src/components/episode/beat-workbench/verify-chip.tsx`
- `frontend/src/components/episode/beat-workbench/video-pane.tsx`
- `frontend/src/components/episode/beat-workbench/view-toggles.tsx`
- `frontend/src/features/freezone/CanvasDebugPanel.tsx`
- `frontend/src/features/freezone/commit/BatchCommitDialog.tsx`
- `frontend/src/features/freezone/commit/CommitDialog.tsx`
- `frontend/src/features/freezone/context/contextOperations.tsx`
- `frontend/src/features/freezone/context/NodeContextBadges.tsx`
- `frontend/src/lib/queries/render-plan.ts`
- `frontend/src/lib/queries/render-settings.ts`

## 许可状态单独处理

版本匹配不等于许可已批准。上游前端声明 Elastic-2.0，目标 Infinite Canvas 声明 GNU AGPL-3.0；本核验不作兼容性结论。移植前仍需逐文件记录 SPDX/REUSE/NOTICE 证据、依赖和字体/图片等第三方资产许可，并由仓库维护者审阅。`public/fonts` 许可未确认前不复制；REUSE.toml 标出的 worker、wrangler、workflow、`.env` 类文件不进入复用闭包。
