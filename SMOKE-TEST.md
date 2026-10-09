# 认证验证用的临时文件

这个文件由 `dsh-ghapp` 项目（把 gh-push 的认证从 PAT 换成 GitHub App）在第 4 步真推验证时创建，
用来确认「推送的提交者是 GitHub App 机器人」。验证完即从仓库删除，可以随时删掉。

- 用途：验证 App 安装令牌能真实写入仓库，且提交者 = raynon-local-pusher[bot]
- 不承载任何项目内容
