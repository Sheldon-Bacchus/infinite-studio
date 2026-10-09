# 片场视频下载适配结论

用户反馈现有视频下载一直正常。源码 project.tsx downloadNodeImage 当前调用 saveAs(node.metadata.content, filename)，FileSaver负责URL保存。来源上游video-download改为必须fetch读取Blob，曾在远程签名地址跨域失败，仅开启代理后真实保存通过。因此模块缺失不等于片场下载坏了，不能按上游问题直接判断片场失败。

片场媒体上传走uploadMediaFile，本地模式已有fileId/storageKey=file:ID、/api/files同源原件，getMediaBlob可读取工作区原件；这一条件与上游仅浏览器Blob/远程URL不同。

适配要求：真实本地fileId/storageKey优先Blob保存（不修改媒体）；没有本地原件时保留现有URL saveAs路径。不强制远程fetch、不自动开启代理、不改写签名地址、不增加自动收费生成。捕获明确可观察的读取错误，提示原因及用户显式打开原地址，不把打开原页说成下载成功。FileSaver返回void不能证明落盘，不能添加虚假的“下载成功”通知。远程URL路径静默失败的观测局限如实记录。

用户端验收需分别检查本地原件、普通远程视频、签名URL。当前只做静态分析，未下载新文件、未调用生成API。
