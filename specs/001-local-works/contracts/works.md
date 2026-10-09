# Works API 与写入契约

沿用可信入口代理、令牌、Host/Origin 与回环地址。新增 /api/local/works 路由，插件调用宿主受限 adapter；不接受任意磁盘路径。

- GET /api/local/works：目录已登记作品摘要，不隐式初始化。
- POST /api/local/works：创建 `{id?,title,operationId}`，operationId 必填且仓库内持久幂等；响应 `{work,committed:true,indexState}`。创建摘要保留请求中可空的 id 与规范化标题，服务随机生成的作品 ID 不进入请求摘要。初始提交保存实际 operationId、请求摘要及回执；沿已提交历史恢复创建映射，不依赖 SQLite。重复同内容返回已创建作品，同 operationId 不同内容拒绝。
- GET /api/local/works/{workId}：当前提交及引用记录。
- PUT /api/local/works/{workId}：提交 {baseRevision,operationId,changes}；冲突 409；响应 {workId,revision,commitId,operationId,committed,indexState}。
- POST /api/local/works/{workId}/media：流式原件上传与摘要登记；不接收客户指定物理路径。
- GET /api/local/works/{workId}/media/{fileId}：按登记定位，校验根与重解析点。
- POST .../migrations/preview、.../migrations/commit：来源包预览、源摘要、备份清单、映射和显式提交；只读旧来源。
- POST .../archive、.../restore：使用相同基准与幂等协议。
- GET .../export：固定已提交 revision 的完整 ZIP；缓存/令牌/staging 排除。
- POST /api/local/works/import/preview、.../import/commit：校验包并隔离发布，重复作品禁止直接覆盖。
- POST .../scan：启动/手动扫描 inbox 差异，采用操作产生新媒体版本。

提交阶段：排他服务锁→作品内串行→校验基准→暂存/同步→发布原件和变化记录→发布不可变提交→切换 work.json→回读→回执→索引。operationId 与回执在提交内记录，不只存 SQLite。锁丢失/占用/越界/未知版本拒绝写。确认提交后索引错误不可误报未提交。原件发布但未登记不是业务完成，恢复核对清单。

全量重建与作品创建/提交采用仓库维护读写锁协调；锁顺序为维护锁→作品锁→索引锁，重建从采集快照到索引事务完成均排除创建/提交，不能用旧投影覆盖并发提交。单作品重建纳入 Store 生命周期并恢复该作品完整已提交历史。存储根必须为非空绝对路径；SQLite 主文件及 journal/wal/shm 附属文件均拒绝重解析点。

ZIP 成熟库解析；拒绝 ..、绝对路径、重解析点、大小写重复项、摘要错误和未知版本。新增资源上限必须先获用户确认，不在实现中自行设经验值。
