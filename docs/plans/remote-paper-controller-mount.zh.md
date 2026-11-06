# 远程 Paper 控制卷的子挂载点

2026-11-06 实机部署发现：remote overlay 将控制卷只读挂载在 Paper profile 的 service root，
再把宿主机的运行目录读写挂载到其 paper 子目录。控制卷初始只有 service/profile 文件，没有 paper
子目录；Linux Docker 29.9.3 因为无法在只读父挂载中创建子挂载点而拒绝启动 Paper 容器，
错误为 `mkdirat srv/trade/dolt/paper: read-only file system`。

复用现有权限与目录布局，在 mirror 写入控制文件时创建空 paper 子目录。它只是 Docker 的挂载点，
运行原件仍在原定宿主机运行目录，不新增存储事实或账本字段。手工在控制卷创建同名空目录可完成
一次部署；代码初始化使后续空卷部署和启动都具备所需目录。回归检查 mirror 输出的控制卷目录契约，
实机继续验证只读父卷与可写运行目录的组合可启动。
