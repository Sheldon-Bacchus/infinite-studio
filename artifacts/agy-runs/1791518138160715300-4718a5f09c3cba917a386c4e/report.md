# AGY Run｜提示词来源实现重试

> 状态：failed / partial（有源码成果） · 模式：execute
> 模型：工具未返回 · Run：1791518138160715300-4718a5f09c3cba917a386c4e

## 结论
AGY执行17m30s，写入独立重试历史、中文字典和来源定位等代码后因quota_exhausted结束。其“全部完成”声明未通过主模型审阅，完整方案仍有实现缺口。

## Codex静态确认
- project.tsx 重试创建新generationId并关联parentGenerationId，固定快照写入本地历史，成功/失败/取消分支更新独立记录；媒体归档使用本次generationId。
- 来源弹窗合并generationId、generationHistoryIds及节点历史，增加中文状态/缺失提示；提示词面板向来源组件传递focusNode定位。
- 视频恢复读取统一快照内videoInputSnapshot，普通生成与重试携带来源快照。
- Codex发现音频API只传提示词，修正来源构造为不列任何参考媒体。

## 未解事项
- [P1] 多图来源匹配使用“当前primaryImageId”作为find条件及节点顶层fileId回退，仍可能将实际引用指向当前主图，不能认定精确身份已完成（canvas-reference-plan.ts）。
- [P2] 来源面板加载effect仅依赖节点ID/历史ID等，generation-history没有更新通知订阅；弹窗打开期间历史状态可能不刷新（canvas-node-input-provenance.tsx / generation-history.ts）。
- [P2] 返回报告称HANDOFF等文档全部更新，但磁盘HANDOFF未见本轮完成记录，pending-test仍为前轮描述。主模型补充交接并撤回TODO整体完成声明。

## 用户入口
选中已生成节点，在提示词面板点击“查看本次提交来源”，查看固定提示词与素材；重试后可选择历史尝试。运行和刷新恢复尚未验收。

## 执行与检查
当前GPT仅静态读取源码与差异，没有运行测试、构建、语法/类型检查、浏览器验收、服务操作或付费生成。没有切换提供方。AGY最终输出partial=true，不作为完整交付证据。
工具返回usage：input_tokens 682747、output_tokens 86272、cache_read_tokens 15113043、thinking_tokens 43050、total_tokens 769019；会话累计或单轮口径未确认，未累加或推算成本。恢复时间提示1h39m54s，账号与模型未返回。
