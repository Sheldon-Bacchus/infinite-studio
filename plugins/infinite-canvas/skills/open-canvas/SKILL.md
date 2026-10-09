---
name: open-canvas
description: 打开本仓库的无限片场（sudio）并自动连接本地 Agent。用户要求打开、启动、进入或使用无限片场时使用。
---

# 打开无限片场

只使用本仓库的本地前端和 Agent。

1. 若 `studio/web` 尚未运行，在仓库根目录执行：

```powershell
Set-Location E:/all-agent-workspace/infinite-studio/studio/web
npm run dev -- --host 127.0.0.1 --port 43863 --strictPort
```

已有前端服务时直接复用，不重复启动。

2. 启动本地 Agent：

```powershell
powershell.exe -NoProfile -File E:/all-agent-workspace/infinite-studio/canvas-agent/start-local.ps1
```

从启动日志复制 `片场自动连接地址`，直接在 Codex 浏览器打开。该地址已经带有 `agentUrl` 和 `agentToken`，正常流程无需手填 Token。

MCP-only 模式使用：

```powershell
powershell.exe -NoProfile -File E:/all-agent-workspace/infinite-studio/canvas-agent/start-local.ps1 -Mcp
```

MCP-only 进程只提供工具协议，不启动网页 HTTP 服务；网页连接仍需普通 Agent。

打开模式默认使用 `mode=new`。用户明确指定时使用 `mode=choose` 或 `mode=recent`；保留启动日志自动连接地址中的模式语义。
