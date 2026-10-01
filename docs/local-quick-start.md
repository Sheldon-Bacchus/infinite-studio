# 无限片场本地启动

## 快速启动

### 第一次启动

1. 确认 Windows 已安装 Go、Node.js 和 Bun。
2. 双击桌面 `无限片场\启动无限片场.cmd`，或在仓库根目录运行下面命令：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1
```

3. 等命令窗口显示“无限片场已就绪”，浏览器会打开虾料工作区。
4. 以后再次使用桌面快捷方式即可。启动器只在依赖目录缺失时安装前端依赖。

如果本仓库的启动器已经运行服务，会复用它。端口若响应的是其他启动方式或其他项目，脚本会报错提醒，不会误连、结束或替换进程。

## 本项目地址和数据

- 虾料/片场工作区：`http://127.0.0.1:43862/xiaji`
- API 健康检查：`http://127.0.0.1:8086/api/health`
- SQLite：本仓库的 `data/infinite-canvas.db`
- 媒体和文件：`data/files/`
- 启动日志：`data/logs/quick-start/`
- 该启动器只运行无限片场网页和 API，不启动 Codex Agent、MCP 或 Bridge。
- Infinite Canvas 源码快照位于同一仓库的 `implementations/infinite-canvas/`，保留独立运行入口；本启动器只运行根目录的 Infinite Studio，不会读写快照自身的数据目录。
- 请使用根目录的 `start-local.ps1`；各来源快照中的旧启动脚本不控制根应用。

## 待机与手动停止

关闭浏览器不会停止网页或 API；服务会在后台待机。只有需要释放端口时才手动执行下面命令：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1 -Action Stop
```

也可从桌面启动入口传入 `-Action Stop`。启动和停止都由同一个 `start-local.ps1` 管理；停止操作只结束由本仓库记录的服务进程。

桌面启动说明位于“无限片场”桌面目录的 `启动说明.txt`。

## 首次运行要求

- Go
- Node.js 与 Bun
- 如果 `web/node_modules` 不存在，启动脚本会在 `web/` 中执行 `bun install --frozen-lockfile`。
- Go 依赖由 `go run .` 按 `go.mod` 获取。
