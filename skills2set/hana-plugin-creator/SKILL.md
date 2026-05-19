---
name: hana-plugin-creator
description: 创建 Hana 插件脚手架，并引导用户完成初级或开发者级别的插件规划、能力检查、清单设置、运行时工具、iframe UI、SDK 模板和可安装的插件目录。当 Hanako/Codex 需要解释 Hana 插件可以做什么、帮助用户描述插件想法、检查 SDK 是否支持该想法或使用 @hana/plugin-runtime、@hana/plugin-sdk 和 @hana/plugin-components 生成/更新 Hana 插件时使用。
metadata:
  default-enabled: false
---

# Hana 插件创建器

此技能用于 Hana 应用插件，不用于 Codex `.codex-plugin` 包。

## 初次接触

初次使用时，提供地图而非百科。解释 Hana 插件可以添加什么，询问用户想要构建什么，并邀请后续问题。仅在用户要求或所选脚手架需要后才展开细节。

按以下方式选择用户模式：

- 如果用户明确说自己是新手、非技术人员或想要指导，使用初级模式。
- 如果用户明确要求 SDK/API/构建细节或给出代码级要求，使用开发者模式。
- 如果记忆不可用、被禁用或不确定，询问：`你想我用哪种方式帮你创建插件？A. 边讲边做 B. 开发者模式`

初级模式语调：鼓励性、具体且有指导。说明用户可以用平白的语言描述功能，Hanako 会帮助将其转变为插件计划和脚手架，Hanako 可以在任何步骤回答问题。提出以下问题：

1. 你希望 Hanako 多一个什么能力？
2. 这个能力是让 Agent 自动调用，还是让你点界面使用？
3. 它需要界面、文件、联网、外部平台、账号权限吗？

开发者模式语调：简洁且协作性。以能力表面开始，然后要求目标贡献和集成边界。

交付插件后，用有根据的产品价值来鼓励。说出插件有帮助的真实情况，例如减少重复步骤、在 Hana 中提供外部服务、将手动工作流转变为 Agent 可调用的工具，或为重复任务提供稳定的 UI。使用自然措辞，如 `这个想法挺实用，适合把每周重复整理的步骤固定下来` 或 `这个方向比较适合做成工具型插件，因为 Agent 可以在对话里直接调用`。避免夸大其词的赞美，如 `你的设想太棒了`。

## 能力地图

Hana 插件可以提供：

- Agent 可调用的工具和斜杠风格的操作。
- 指导模型行为的技能、Agent 和知识。
- 使用 Hana 主题和主机功能的 iframe 页面、小部件和卡片。
- 用于完全访问集成的生命周期和 EventBus 处理器。
- 提供商贡献，用于聊天和媒体能力，包括由 HTTP、OAuth HTTP、本地 CLI、浏览器 CLI 或插件运行时支持的图像/视频/语音提供商。
- 应用具有明确扩展点的扩展风格集成。
- SessionFile 支持的文件和媒体输出。

Hana 提供安装/启用/重载、按 Agent 的技能切换、清单能力检查、iframe 主机消息、主题令牌、toast/剪贴板/外部主机 API、EventBus、数据目录和 SDK 包。

当前边界：iframe UI 是稳定的扩展表面。本机渲染器组件和代码沙盒还不是默认路径。如果请求依赖这些，请解释差距并提议最接近的受支持形式。

## 工作流

1. 找到 Hana 仓库根。如果当前工作区包含 `PLUGIN_SDK.md`、`PLUGINS.md` 和 `packages/plugin-runtime`，则优先选择。
2. 在更改插件代码之前，读取 `.docs/PLUGIN-DEVELOPMENT.md`、`PLUGIN_SDK.md` 和 `PLUGINS.md` 的相关部分。对于 React UI，还要读取 `packages/plugin-sdk/README.md` 和 `packages/plugin-components/README.md`。
3. 选择一个模板：
   - `direct`：无 npm install、无构建步骤，最适合初学者的第一个可运行插件。
   - `guided-react`：React/Vite/SDK 启动器，具有共享 Hana 组件和更温和的 README。
   - `professional-react`：React/Vite/SDK 启动器，适合期望包脚本和类型化 UI 代码的开发者。
4. 选择贡献类型：
   - `tool`：受限插件，具有 `tools/*.js`。
   - `ui`：具有 iframe 页面/小部件的完全访问。
   - `full`：工具、生命周期/EventBus 条目和 iframe UI。
   - `provider`：在 `providers/*.js` 下具有完全访问提供商声明。
5. 选择目标位置：
   - 与 Hana 一起发布的内置插件：`plugins/<plugin-id>`。
   - 示例或模板插件：`examples/plugins/<plugin-id>`。
   - 用户安装的插件：由 `/api/plugins/settings` 或 `${HANA_HOME}/plugins` 报告的目录。
6. 使用捆绑脚本生成脚手架，然后根据用户的要求调整名称、描述、工具、路由、能力和 UI。
7. 在可用时使用插件开发循环：
   - 确认用户已启用设置 -> 插件 -> "允许 Agent 插件开发工具"；
   - 使用 `plugin.dev.install` 安装源；
   - 编辑后使用 `plugin.dev.reload` 重载；
   - 保存返回的 `devRunId` 并在可用时将其传递给生命周期控制；
   - 仅通过 `plugin.dev.enable`、`plugin.dev.disable`、`plugin.dev.reset` 和 `plugin.dev.uninstall` 启用、禁用、重置或卸载；
   - 检查 `plugin.dev.diagnostics`；
   - 使用 `plugin.dev.invokeTool` 对工具进行烟雾测试；
   - 使用 `plugin.dev.listSurfaces` 列出 UI 表面；
   - 使用 `plugin.dev.runScenario` 运行 `manifest.dev.scenarios`。
8. 对于 UI 调试，优先进行元素优先检查：在屏幕截图之前读取可访问元素、角色、标签、文本和稳定定位器。使用屏幕截图处理视觉打磨、剪裁、主题拟合或备用方案。
9. 如果用户想要发布，请选择一个渠道：
   - 本地调试：保持源代码本地，通过开发循环安装；
   - 人工评审包：创建 zip、README、清单、屏幕截图和 sha256 用于电子邮件/组/问题评审；
   - 官方 OH-Plugins 发布：准备目录条目和发布 zip，然后在任何远程推送前运行 privacy-push。
10. 运行专注验证。编辑此技能时，至少验证技能并针对临时目录运行脚手架脚本。

## 脚手架命令

初级启动器：

```bash
python3 skills2set/hana-plugin-creator/scripts/create_hana_plugin.py "My Plugin" --path examples/plugins --audience beginner --template direct
```

开发者 React 启动器：

```bash
python3 skills2set/hana-plugin-creator/scripts/create_hana_plugin.py "My Plugin" --path examples/plugins --audience developer --template professional-react --sdk-mode workspace
```

有用的选项：

- `--kind tool`：具有静态 `tools/create-note.js` 的受限插件。
- `--kind ui`：具有 `page` 和 `widget` iframe UI 的完全访问插件。
- `--kind full`：工具、生命周期/EventBus 条目和 iframe UI。
- `--kind provider`：具有媒体能力提供商声明的完全访问提供商贡献。
- `--sdk-mode workspace`：使用仓库本地 SDK 包。
- `--sdk-mode bundled`：将 SDK tarball 从此技能复制到生成的插件中。
- `--dev-scenario`：添加首阶段 `manifest.dev.scenarios` 烟雾测试。
- `--force`：仅当用户明确想要覆盖时替换现有生成的目录。

提供商贡献启动器：

```bash
python3 skills2set/hana-plugin-creator/scripts/create_hana_plugin.py "Jimeng Provider" --path examples/plugins --kind provider --audience developer
```

## SDK 规则

- 静态 `tools/*.js` 必须导出 `name`、`description`、`parameters` 和 `execute`。
- React 模板可以使用 `@hana/plugin-runtime`、`@hana/plugin-sdk` 和 `@hana/plugin-components`。
- 开发权限不是清单许可。Hana 从 `${HANA_HOME}/plugins-dev/` 下的记忆的开发安装槽授予它，Agent 开发工具在用户启用开发工具设置之前是隐藏的。
- 返回给用户的本地文件必须通过 `toolCtx.stageFile({ sessionPath, filePath, label })`，然后是媒体详情。不要手工构建本地 `MEDIA:` 或 `file://` 输出。
- 页面和小部件贡献需要 `"trust": "full-access"` 和路由支持的 iframe UI。
- 仅声明实际使用的 iframe 主机能力。
- EventBus 处理器应为不属于它们的有效负载返回 `HANA_BUS_SKIP`。
- 保持 iframe UI 自包含。不要从 `desktop/src/react` 导入渲染器内部。
- 提供商声明位于 `providers/*.js` 中，需要 `"trust": "full-access"`。
- 将 `capabilities.chat` 与 `capabilities.media.*` 分开。仅媒体提供商必须设置 `chat.projection = "none"`，以便它们永远不会出现在聊天模型选择器中。
- CLI 支持的提供商必须声明 `runtime.kind = "local-cli"` 或 `"browser-cli"`，具有结构化参数绑定和输出契约。不要构建 shell 命令字符串。

## 市场规则

- 市场元数据位于 `OH-Plugins` 仓库中，而不在 `project-hana` 内部。
- 官方源插件可能位于 `OH-Plugins/official-plugins/<plugin-id>/` 中，具有匹配的 `plugins/<plugin-id>.yaml`。
- 每个市场条目需要一个 README 源：`readme`、`readmePath` 或 `readmeUrl`。仅对本地文件市场使用 `readmePath`；对于 URL 市场使用内联 `readme` 或 HTTPS `readmeUrl`。
- 一旦插件有多个发布线，优先使用 `versions[]`。每个版本项声明 `version`、`compatibility.minAppVersion` 和其自己的 `distribution`。
- 对于单个发布，根 `version`、`compatibility` 和 `distribution` 保持有效；Hana 将它们规范化为单个版本条目。
- Hana 选择与当前应用兼容的最高 SemVer 版本，并向 UI 公开更新、重新安装、不兼容和降级状态。
- 如果选定的兼容版本低于安装的版本，安装需要使用 `allowDowngrade: true` 的明确降级确认。
- 发布安装在替换前备份，新插件加载失败时回滚。
- 本地文件市场可以安装 `distribution.kind = "source"` 条目，因为路径在磁盘上解析。
- URL 市场浏览条目、显示 README 内容并通过下载 zip 并验证 `sha256` 来安装发布包。
- 在推送 `OH-Plugins` 之前，运行 privacy-push 并等待明确的用户确认。

## UI 规则

- 将默认 React 插件 UI 设置为 `HanaThemeProvider mode="inherit"`，以便它遵循主机主题。
- 对于命名的 Hana 主题使用 `mode="hana"`，仅对于显式令牌覆盖使用 `mode="custom"`。
- 路由 shell 应读取 `hana-theme` 和 `hana-css` 查询参数，在存在时包含主题 CSS 链接，并转义插入 HTML 属性中的值。
- 直接模板可以使用小型无构建主机消息传递助手，但应保持与公共 iframe 协议兼容。
