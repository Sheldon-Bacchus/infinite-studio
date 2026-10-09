# sudio Plugin

让 Codex / ZCode 可以打开并操作本仓库的无限片场（sudio）。

## 安装

### Codex（Windows PowerShell）

```powershell
Set-Location E:/all-agent-workspace/infinite-studio
codex plugin marketplace add "$PWD"
codex plugin add sudio@infinite-studio-local
```

### ZCode

- 打开 **Settings → Plugin Management → Discover**，点击右上角 **`+`** 添加 marketplace。
- 选择 **本仓库目录**（`plugins/infinite-canvas`）或本仓库根目录，即可发现 `sudio` 插件并安装。
- 或在 ZCode 界面直接以本地目录方式加载该插件目录。

安装后新建一个任务，然后输入：

```text
帮我打开并连接到无限片场
```
