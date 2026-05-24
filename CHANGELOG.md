# Changelog

本文档记录 Hanako 所有值得关注的变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- LLM 用量日志持久化及查询工具（`llm_usage` 事件订阅 + 日/周/月统计）
- OneBot / QQ 适配器流式能力支持
- Owner 会话 prompt 冻结窗口，复用系统提示缓存以降低 token 消耗

### Fixed
- Ctrl+C 后 server 进程未正确关闭
- `llm_usage` 事件未正确加入分类导致的统计遗漏

## [0.235.0] - 2026-05-20

### Added
- 外观状态（appearance status）支持

### Fixed
- 聊天引用高亮在输入框聚焦时消失
- 侧边栏更新通知

## [0.233.4] - 2026-05-18

### Fixed
- issue 修复批次处理

## [0.233.0] - 2026-05-17

### Added
- 会话搜索功能
- 归档设置入口
- Agent 可直接修改设置

## [0.231.13] - 2026-05-14

### Fixed
- 回复后输入框焦点恢复
- 长会话历史分页水合
