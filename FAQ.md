# Frequently Asked Questions (FAQ)

[English](#english) | [中文](#chinese)

---

## English

### General Questions

**Q: What is Misuzu?**

A: Misuzu is a modern monorepo framework built on Vite+. It provides a unified development experience for building scalable TypeScript applications and libraries.

**Q: Who is Misuzu for?**

A: Misuzu is designed for:

- Teams building multiple TypeScript packages
- Projects that need strict type safety
- Developers who want a modern, fast development experience
- Open source projects following best practices

**Q: Is Misuzu production-ready?**

A: Misuzu is currently in active development (v0.x). Core functionality is stable, but breaking changes may occur before v1.0.0. We recommend testing thoroughly before using in production.

**Q: How does Misuzu compare to other monorepo tools?**

A: Key differences:

- **Vite+ Integration**: Unified CLI for all development tasks
- **Type-First**: Strict TypeScript by default
- **Modern Stack**: Built on latest technologies
- **Developer Experience**: Fast, intuitive workflows

**Q: Is Misuzu free?**

A: Yes! Misuzu is licensed under GPL-3.0, making it free for anyone to use, modify, and distribute. See [LICENSE](./LICENSE) and [LICENSE-INFO.md](./LICENSE-INFO.md).

### Getting Started

**Q: How do I install Misuzu?**

A: Clone the repository and run:

```bash
pnpm install
vp run ready
```

See [DEVELOPMENT.md](./DEVELOPMENT.md) for detailed setup instructions.

**Q: What are the system requirements?**

A:

- Node.js >= 22.12.0
- pnpm >= 10.32.1
- Git (latest recommended)

**Q: Can I use Misuzu on Windows?**

A: Yes, Misuzu works on Windows, macOS, and Linux. We recommend WSL2 on Windows for better development experience.

**Q: How do I create a new package?**

A:

1. Create directory: `mkdir packages/my-package`
2. Copy template from existing package
3. Update `package.json` with your package info
4. Run `pnpm install` and `vp test` to verify

See [DEVELOPMENT.md](./DEVELOPMENT.md) for more details.

### Development

**Q: How do I run tests?**

A:

```bash
# All tests
vp run test -r

# Specific package
cd packages/misuzu-core && vp test

# Watch mode
vp test --watch
```

**Q: How do I format and lint my code?**

A:

```bash
# Check everything
vp check

# Auto-fix issues
vp check --fix
```

**Q: Why do I get "command not found: vp"?**

A: Run `pnpm install` again. If that doesn't work, try `npx vp --version`.

**Q: How do I debug code?**

A: See [DEVELOPMENT.md](./DEVELOPMENT.md#debugging) for VS Code debugging setup and console logging techniques.

**Q: What's the recommended workflow?**

A:

1. Create feature branch
2. Make changes in watch mode
3. Run tests regularly
4. Run `vp check --fix` before committing
5. Commit and push
6. Open PR on GitHub

### Code Style

**Q: Why no semicolons?**

A: Our project uses Prettier-style configuration with `semi: false`. Semicolons are optional in JavaScript/TypeScript and removing them reduces visual clutter.

**Q: Must I use strict TypeScript?**

A: Yes, `strict: true` is enforced project-wide. This catches more errors at compile time and improves code quality.

**Q: Can I use `any` types?**

A: Strongly discouraged. If you really need it, we use it sparingly and add a comment explaining why.

**Q: How should I name my files and variables?**

A: See [AGENTS.md](./AGENTS.md#naming--structure) for detailed naming conventions.

### Contributing

**Q: How do I contribute?**

A: See [CONTRIBUTING.md](./CONTRIBUTING.md) for a complete guide covering:

- Getting started
- Development workflow
- Code standards
- Pull request process

**Q: Do I need to sign a CLA?**

A: No CLA is required. By contributing, you agree your work is licensed under GPL-3.0.

**Q: How long does PR review take?**

A: We aim to review PRs within 3-5 business days. Complex changes may take longer.

**Q: Can I get feedback before submitting a PR?**

A: Yes! Open a discussion or draft PR to get early feedback. See [GitHub Discussions](https://github.com/author/misuzu/discussions).

**Q: What if my PR is rejected?**

A: We'll explain why and suggest improvements. Feel free to discuss or iterate on your changes.

### Project Structure

**Q: What's in each directory?**

A:

- `packages/` - Published libraries
- `apps/` - End-user applications
- `tools/` - Internal development tools
- `examples/` - Example code
- `plugins/` - Plugin system

See [ARCHITECTURE.md](./ARCHITECTURE.md) for more details.

**Q: Should I put my code in `packages/` or `apps/`?**

A: Use `packages/` for reusable libraries and `apps/` for end-user applications. See [ARCHITECTURE.md](./ARCHITECTURE.md#monorepo-structure).

### Performance

**Q: Why is my build slow?**

A: Try:

1. Ensure all dependencies are installed: `pnpm install`
2. Clear cache: `rm -rf node_modules/.vite`
3. Use watch mode: `vp pack --watch`
4. Check for heavy computations in code

**Q: How can I improve development speed?**

A: Tips from [DEVELOPMENT.md](./DEVELOPMENT.md#performance-tips):

- Use watch mode
- Run tests for changed files only
- Clear caches periodically
- Keep node_modules clean

### Publishing

**Q: How do I publish a package?**

A: Once v1.0.0 is released and publishing workflow is finalized, see documentation on publishing.

**Q: Can I publish to npm?**

A: Yes, packages in `packages/` are set up for npm publishing. See package `package.json` for configuration.

### License & Legal

**Q: Why GPL-3.0?**

A: GPL-3.0 ensures Misuzu remains free software and benefits the community. See [LICENSE-INFO.md](./LICENSE-INFO.md) for more information.

**Q: Can I use Misuzu in a commercial project?**

A: Yes, but your project must also be licensed under GPL-3.0. See [LICENSE-INFO.md](./LICENSE-INFO.md) for details.

**Q: What if I want a different license?**

A: You can license your own code under a different license, but any Misuzu code you use must remain GPL-3.0.

### Support & Community

**Q: Where can I ask for help?**

A:

- [GitHub Issues](https://github.com/author/misuzu/issues) - Bug reports
- [GitHub Discussions](https://github.com/author/misuzu/discussions) - Questions and discussions
- [README.md](./README.md) - Project overview

**Q: How do I report a security vulnerability?**

A: See [SECURITY.md](./SECURITY.md) for responsible disclosure instructions.

**Q: Is there a Slack/Discord community?**

A: Not yet, but check [GitHub Discussions](https://github.com/author/misuzu/discussions) for community interaction.

### Troubleshooting

**Q: Tests pass locally but fail in CI**

A: Common causes:

- Different Node.js version
- Missing environment variables
- Stale cache

Run `vp install` and check `node --version`.

**Q: TypeScript shows errors but code runs**

A: Run `vp check` for full type report. Enable strict mode in your IDE's TypeScript plugin.

**Q: Changes not reflected in development**

A: Restart dev server and clear browser cache. Check console for errors.

**Q: Build fails with strange errors**

A: Try:

```bash
vp check --fix
rm -rf dist node_modules
pnpm install
vp run ready
```

### Still Have Questions?

- Check [DEVELOPMENT.md](./DEVELOPMENT.md) for setup and troubleshooting
- Read [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines
- Review [AGENTS.md](./AGENTS.md) for code standards
- Open an issue on [GitHub Issues](https://github.com/author/misuzu/issues)
- Start a discussion on [GitHub Discussions](https://github.com/author/misuzu/discussions)

---

## Chinese

### 常见问题

**Q：Misuzu 是什么？**

A：Misuzu 是一个建立在 Vite+ 之上的现代 monorepo 框架。它为构建可扩展的 TypeScript 应用程序和库提供了统一的开发体验。

**Q：Misuzu 适合谁？**

A：Misuzu 为以下人群设计：

- 构建多个 TypeScript 包的团队
- 需要严格类型安全的项目
- 想要现代、快速开发体验的开发者
- 遵循最佳实践的开源项目

**Q：Misuzu 是否生产就绪？**

A：Misuzu 目前处于主动开发中（v0.x）。核心功能稳定，但在 v1.0.0 之前可能出现破坏性更改。我们建议在生产中使用前进行彻底测试。

**Q：Misuzu 与其他 monorepo 工具相比如何？**

A：关键差异：

- **Vite+ 集成**：所有开发任务的统一 CLI
- **类型优先**：默认严格的 TypeScript
- **现代栈**：建立在最新技术上
- **开发者体验**：快速、直观的工作流

**Q：Misuzu 是免费的吗？**

A：是的！Misuzu 采用 GPL-3.0 许可证，任何人都可以免费使用、修改和分发。参见 [LICENSE](./LICENSE) 和 [LICENSE-INFO.md](./LICENSE-INFO.md)。

### 快速开始

**Q：我如何安装 Misuzu？**

A：克隆仓库并运行：

```bash
pnpm install
vp run ready
```

详见 [DEVELOPMENT.md](./DEVELOPMENT.md) 获得详细设置说明。

**Q：系统要求是什么？**

A：

- Node.js >= 22.12.0
- pnpm >= 10.32.1
- Git（推荐最新）

**Q：我可以在 Windows 上使用 Misuzu 吗？**

A：可以，Misuzu 可在 Windows、macOS 和 Linux 上运行。我们建议在 Windows 上使用 WSL2 以获得更好的开发体验。

**Q：我如何创建新包？**

A：

1. 创建目录：`mkdir packages/my-package`
2. 从现有包复制模板
3. 使用您的包信息更新 `package.json`
4. 运行 `pnpm install` 和 `vp test` 以验证

详见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

### 开发

**Q：我如何运行测试？**

A：

```bash
# 所有测试
vp run test -r

# 特定包
cd packages/misuzu-core && vp test

# 监听模式
vp test --watch
```

**Q：我如何格式化和 lint 代码？**

A：

```bash
# 检查一切
vp check

# 自动修复问题
vp check --fix
```

**Q：为什么我收到"command not found: vp"？**

A：再次运行 `pnpm install`。如果仍不行，尝试 `npx vp --version`。

**Q：我如何调试代码？**

A：参见 [DEVELOPMENT.md](./DEVELOPMENT.md#调试) 了解 VS Code 调试设置和控制台日志记录技术。

**Q：推荐的工作流程是什么？**

A：

1. 创建功能分支
2. 在监听模式下进行更改
3. 定期运行测试
4. 提交前运行 `vp check --fix`
5. 提交并推送
6. 在 GitHub 上打开 PR

### 代码风格

**Q：为什么没有分号？**

A：我们的项目使用 Prettier 风格的配置，配置 `semi: false`。分号在 JavaScript/TypeScript 中是可选的，移除它们可以减少视觉混乱。

**Q：我必须使用严格的 TypeScript 吗？**

A：是的，`strict: true` 在项目范围内强制执行。这在编译时捕获更多错误并改进代码质量。

**Q：我可以使用 `any` 类型吗？**

A：强烈不建议。如果您真的需要，我们会谨慎使用并添加注释解释原因。

**Q：我应该如何命名文件和变量？**

A：详见 [AGENTS.md](./AGENTS.md#命名约定) 了解详细的命名约定。

### 贡献

**Q：我如何贡献？**

A：详见 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解完整指南，涵盖：

- 快速开始
- 开发工作流程
- 代码标准
- 拉取请求流程

**Q：我需要签署 CLA 吗？**

A：不需要 CLA。通过贡献，您同意您的工作采用 GPL-3.0 许可。

**Q：PR 审查需要多长时间？**

A：我们目标在 3-5 个工作日内审查 PR。复杂更改可能需要更长时间。

**Q：我可以在提交 PR 前获得反馈吗？**

A：可以！打开讨论或草稿 PR 以获得早期反馈。参见 [GitHub Discussions](https://github.com/author/misuzu/discussions)。

**Q：如果我的 PR 被拒绝了怎么办？**

A：我们会解释原因并建议改进。随时讨论或迭代您的更改。

### 项目结构

**Q：每个目录中有什么？**

A：

- `packages/` - 发布的库
- `apps/` - 面向最终用户的应用
- `tools/` - 内部开发工具
- `examples/` - 示例代码
- `plugins/` - 插件系统

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

**Q：我应该将代码放在 `packages/` 还是 `apps/` 中？**

A：为可复用库使用 `packages/`，为面向最终用户的应用使用 `apps/`。详见 [ARCHITECTURE.md](./ARCHITECTURE.md#monorepo-结构)。

### 性能

**Q：为什么我的构建很慢？**

A：尝试：

1. 确保所有依赖都已安装：`pnpm install`
2. 清除缓存：`rm -rf node_modules/.vite`
3. 使用监听模式：`vp pack --watch`
4. 检查代码中的重型计算

**Q：我如何提高开发速度？**

A：来自 [DEVELOPMENT.md](./DEVELOPMENT.md#性能提示) 的提示：

- 使用监听模式
- 仅针对已更改文件运行测试
- 定期清除缓存
- 保持 node_modules 干净

### 发布

**Q：我如何发布包？**

A：一旦 v1.0.0 发布并完成发布工作流程，详见发布文档。

**Q：我可以发布到 npm 吗？**

A：可以，`packages/` 中的包设置为 npm 发布。详见包 `package.json` 了解配置。

### 许可和法律

**Q：为什么是 GPL-3.0？**

A：GPL-3.0 确保 Misuzu 保持自由软件并惠及社区。详见 [LICENSE-INFO.md](./LICENSE-INFO.md)。

**Q：我可以在商业项目中使用 Misuzu 吗？**

A：可以，但您的项目也必须采用 GPL-3.0 许可。详见 [LICENSE-INFO.md](./LICENSE-INFO.md)。

**Q：如果我想要不同的许可证怎么办？**

A：您可以在不同许可证下许可您自己的代码，但您使用的任何 Misuzu 代码必须保持 GPL-3.0。

### 支持和社区

**Q：我可以在哪里寻求帮助？**

A：

- [GitHub Issues](https://github.com/author/misuzu/issues) - Bug 报告
- [GitHub Discussions](https://github.com/author/misuzu/discussions) - 问题和讨论
- [README.md](./README.md) - 项目概述

**Q：我如何报告安全漏洞？**

A：详见 [SECURITY.md](./SECURITY.md) 了解负责任的披露说明。

**Q：是否有 Slack/Discord 社区？**

A：还没有，但请查看 [GitHub Discussions](https://github.com/author/misuzu/discussions) 了解社区互动。

### 故障排除

**Q：本地测试通过但在 CI 中失败**

A：常见原因：

- 不同的 Node.js 版本
- 缺少环境变量
- 过时的缓存

运行 `vp install` 并检查 `node --version`。

**Q：TypeScript 显示错误但代码运行**

A：运行 `vp check` 获得完整的类型报告。在 IDE 的 TypeScript 插件中启用严格模式。

**Q：开发中的更改未反映**

A：重启开发服务器并清除浏览器缓存。检查控制台中的错误。

**Q：构建因奇怪的错误而失败**

A：尝试：

```bash
vp check --fix
rm -rf dist node_modules
pnpm install
vp run ready
```

### 还有问题？

- 查看 [DEVELOPMENT.md](./DEVELOPMENT.md) 了解设置和故障排除
- 阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解开发指南
- 审查 [AGENTS.md](./AGENTS.md) 了解代码标准
- 在 [GitHub Issues](https://github.com/author/misuzu/issues) 上打开 issue
- 在 [GitHub Discussions](https://github.com/author/misuzu/discussions) 上开始讨论
