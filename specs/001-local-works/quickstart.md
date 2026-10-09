# Quickstart 与验收

当前无代码执行，不运行本文件中的命令。DeepSeek 路由恢复后按 tasks 分批实现，用户按项目约定运行验证。

后续命令（实施后用户授权时）：workspace-service 内 go test ./internal/works/...；插件目录 bun run test；studio/web 按已有 package.json 对应 test 命令。不要自动执行 build/typecheck。

隔离临时目录验收：保存重启、第二服务锁、两个客户端冲突、各提交阶段中断、哈希复用、未知 schema、ZIP 路径与摘要、迁移重复/失败、归档恢复、索引重建。真实数据迁移另需原来源导出和备份预览，不能拿规范空作品假装恢复完成。
