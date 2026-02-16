# 解CTF题目过程

- 白盒？下载附件 -> 本地搭建环境 -> 基本的扫描 npm audit... -> 审计源码 -> 发现漏洞？编写PoC尝试利用 or 需要更多知识 -> 派发任务给subAgent补充知识（来源：1. 相关lib官方文档 2. 其他网络来源 3. 本地知识库（包含lib源码，视情况进行进一步审计））-> 循环 -> 可选：派发任务给BackGroundFuzzAgent，检查是否能fuzz出意外发现
- 黑/灰盒？基本扫描 -> 收集信息 -> 信息不足？autoFuzz/补充知识

## workspace

workspace 是计算机和 LLM 交互的接口

提供一个可持久化的状态管理，可以存储subAgent的结果、核心发现、知识...

提供一个独立目录供 Agent 操作 (File IO, shell)

workspace 的信息应当可以以自选组合的方式组成 LLM 上下文的一部分。例如，目录结构作为持久伴随的上下文，省去一般 Agent 对 ls 的 toolcall
