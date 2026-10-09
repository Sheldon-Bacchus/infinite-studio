# Research

- 已核对插件 storage/workspace 与宿主 use-asset-store，二者来源分开；插件含 audio 而宿主缺少。
- 已核对 workspace-service records.go：baseRevision CAS 与 operationId/digest 幂等可复用语义，不复用数据库权威实现。
- http.go/main.go 已有 token/Host/Origin/loopback；vite.config.ts 由服务端代理注入凭证，不把 token 下发插件或作品。
- 原件 files/<fileId> 保存 SHA256，但没有作品内按哈希统一去重；迁移按真实字节重算。
- 锁采用 Windows 持续持有的排他句柄，崩溃释放；锁文件不以存在判活。文件原子替换采用 Windows 支持原语，目标存在不靠 os.Rename 假设覆盖。
- 不可变对象记录先发布，再发布提交清单，最后替换 work.json；孤立未提交记录不作为当前作品。Windows rename/replace 占用错误保留原件与旧指针。
- Windows 路径预算是待实施预检，不静默加入 240 等经验上限；传统 MAX_PATH 环境需按最终根和 ID 格式验证。
- 现有 agv-works 只有文件列表取证，不是全量迁移输入；浏览器数据必须由原来源导出原件。
- 指定 DeepSeek endpoint 10100 只读 GET models 返回连接拒绝；未启动执行会话，无 provider usage 或成本数据。

官方资料：https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation 与 https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew 。
