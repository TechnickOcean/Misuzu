# Misuzu

> A powerful, modern monorepo powered by Vite+ for building scalable TypeScript applications.

[English](#english) | [中文](#chinese)

---

## English

### Overview

Misuzu is a cutting-edge monorepo framework built on top of Vite+, designed to streamline the development of TypeScript-based applications and libraries. It provides a unified development experience with best-in-class tooling for formatting, linting, testing, and building.

**Key Features:**

- 📦 **Monorepo Architecture** - Manage multiple packages efficiently with pnpm workspaces
- ⚡ **Vite+ Toolchain** - Integrated Vite, Rolldown, Vitest, tsdown, Oxlint, and Oxfmt
- 🧪 **Type-Safe** - Strict TypeScript configuration with full type checking
- 🎯 **Zero Configuration** - Pre-configured development environment
- 🚀 **Fast Build Times** - Optimized Rolldown bundler for lightning-fast builds
- 📝 **Consistent Code Style** - Automatic formatting with Oxfmt and linting with Oxlint
- 🏗️ **Scalable** - Built for growing teams and complex projects

### Project Structure

```
misuzu/
├── apps/                    # Applications (private packages)
│   └── misuzu-web/         # Vue.js web application
├── packages/               # Published libraries
│   └── misuzu-core/        # Core library
├── tools/                  # Internal development tools
├── examples/               # Example code
├── plugins/                # Vite+ plugins
├── package.json           # Root workspace configuration
├── pnpm-workspace.yaml    # Workspace settings
├── vite.config.ts         # Root Vite configuration
└── tsconfig.json          # Root TypeScript configuration
```

### Quick Start

#### Prerequisites

- **Node.js** >= 22.12.0
- **pnpm** >= 10.32.1

#### Installation

```bash
# Install dependencies
pnpm install

# Verify everything is ready
pnpm run ready
```

#### Development

```bash
# Start development server
pnpm run dev

# Run tests
pnpm run test

# Run specific test file
pnpm run test -- container.test.ts

# Watch mode
pnpm run test -- --watch

# Build all packages
pnpm run build

# Format and lint code
pnpm run check

# Auto-fix formatting and linting issues
pnpm run check -- --fix
```

### Available Commands

| Command           | Description                                        |
| ----------------- | -------------------------------------------------- |
| `vp install`      | Install dependencies (run after pulling changes)   |
| `vp check`        | Run format, lint, and TypeScript type checks       |
| `vp check --fix`  | Auto-fix formatting and linting issues             |
| `vp test`         | Run all tests                                      |
| `vp test <file>`  | Run single test file                               |
| `vp test --watch` | Run tests in watch mode                            |
| `vp build`        | Build monorepo packages                            |
| `vp fmt`          | Format code with Oxfmt                             |
| `vp lint`         | Lint with Oxlint (includes type checking)          |
| `vp run ready`    | Complete validation: format, lint, test, and build |

### Project Packages

#### Core Packages

**[misuzu-core](./packages/misuzu-core)**

- TypeScript library providing core functionality
- Available on npm: `npm install misuzu-core`

**[misuzu-web](./apps/misuzu-web)**

- Vue.js web application
- Built with Vite and modern web technologies

### Code Style Guidelines

We follow strict code standards to maintain consistency across the project:

**TypeScript & Formatting:**

- No semicolons (configured with `semi: false`)
- Strict types (`strict: true` enforced)
- ES modules only (`import`/`export`)
- Include `.ts` in import paths for TypeScript files
- Use `import type` for type-only imports

**Naming Conventions:**

- Files: `kebab-case` (e.g., `base-tools.ts`)
- Classes: `PascalCase` (e.g., `Container`)
- Interfaces: `PascalCase` (e.g., `FeaturedAgentOptions`)
- Functions: `camelCase` (e.g., `createContainer`)
- Constants: `UPPER_SNAKE_CASE` for exported module constants

**Error Handling:**

- Use descriptive error messages with context
- Always throw `Error` or specific error types
- Test error cases explicitly

See [AGENTS.md](./AGENTS.md) for comprehensive development guidelines.

### Contributing

We welcome contributions from the community! Please read our [Contributing Guide](./CONTRIBUTING.md) for details about our development process, code standards, and how to submit pull requests.

**Quick Contributing Steps:**

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Security

For security concerns, please read our [Security Policy](./SECURITY.md). For responsible disclosure, please don't open public issues for security vulnerabilities.

### Code of Conduct

Please review our [Code of Conduct](./CODE_OF_CONDUCT.md) before participating in this project. We're committed to providing a welcoming and inclusive environment.

### License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](./LICENSE) file for details.

### Support & Community

- **Issues**: Report bugs or request features on [GitHub Issues](https://github.com/author/misuzu/issues)
- **Discussions**: Join our community discussions on [GitHub Discussions](https://github.com/author/misuzu/discussions)
- **Documentation**: Read our [documentation](./docs) for more details

### Changelog

See [CHANGELOG.md](./CHANGELOG.md) for detailed release notes and version history.

---

## Chinese

### 概述

Misuzu 是一个建立在 Vite+ 之上的尖端 monorepo 框架，专为开发 TypeScript 应用和库而设计。它提供统一的开发体验，配备业界最佳的格式化、linting、测试和构建工具。

**主要特性：**

- 📦 **Monorepo 架构** - 使用 pnpm workspaces 高效管理多个包
- ⚡ **Vite+ 工具链** - 集成 Vite、Rolldown、Vitest、tsdown、Oxlint 和 Oxfmt
- 🧪 **类型安全** - 严格的 TypeScript 配置和完整的类型检查
- 🎯 **零配置** - 预配置的开发环境
- 🚀 **快速构建** - 优化的 Rolldown 打包器实现闪电般的构建速度
- 📝 **代码风格一致** - 使用 Oxfmt 自动格式化和 Oxlint linting
- 🏗️ **高度可扩展** - 为成长中的团队和复杂项目而设计

### 项目结构

```
misuzu/
├── apps/                    # 应用程序（私有包）
│   └── misuzu-web/         # Vue.js 网页应用
├── packages/               # 发布的库
│   └── misuzu-core/        # 核心库
├── tools/                  # 内部开发工具
├── examples/               # 示例代码
├── plugins/                # Vite+ 插件
├── package.json           # 根工作区配置
├── pnpm-workspace.yaml    # 工作区设置
├── vite.config.ts         # 根 Vite 配置
└── tsconfig.json          # 根 TypeScript 配置
```

### 快速开始

#### 环境要求

- **Node.js** >= 22.12.0
- **pnpm** >= 10.32.1

#### 安装

```bash
# 安装依赖
pnpm install

# 验证一切就绪
pnpm run ready
```

#### 开发

```bash
# 启动开发服务器
pnpm run dev

# 运行测试
pnpm run test

# 运行指定测试文件
pnpm run test -- container.test.ts

# 监听模式
pnpm run test -- --watch

# 构建所有包
pnpm run build

# 格式化和 lint 代码
pnpm run check

# 自动修复格式化和 lint 问题
pnpm run check -- --fix
```

### 可用命令

| 命令              | 说明                                     |
| ----------------- | ---------------------------------------- |
| `vp install`      | 安装依赖（拉取更改后运行）               |
| `vp check`        | 运行格式化、lint 和 TypeScript 类型检查  |
| `vp check --fix`  | 自动修复格式化和 lint 问题               |
| `vp test`         | 运行所有测试                             |
| `vp test <file>`  | 运行单个测试文件                         |
| `vp test --watch` | 监听模式运行测试                         |
| `vp build`        | 构建 monorepo 包                         |
| `vp fmt`          | 使用 Oxfmt 格式化代码                    |
| `vp lint`         | 使用 Oxlint 进行 linting（包括类型检查） |
| `vp run ready`    | 完整验证：格式化、lint、测试和构建       |

### 项目包

#### 核心包

**[misuzu-core](./packages/misuzu-core)**

- 提供核心功能的 TypeScript 库
- 在 npm 上可用：`npm install misuzu-core`

**[misuzu-web](./apps/misuzu-web)**

- Vue.js 网页应用
- 使用 Vite 和现代网页技术构建

### 代码风格指南

我们遵循严格的代码标准以保持项目的一致性：

**TypeScript 和格式化：**

- 无分号（配置 `semi: false`）
- 严格类型检查（强制 `strict: true`）
- 仅使用 ES 模块（`import`/`export`）
- 导入 TypeScript 文件时包含 `.ts` 扩展名
- 对仅类型的导入使用 `import type`

**命名约定：**

- 文件：`kebab-case`（例如 `base-tools.ts`）
- 类：`PascalCase`（例如 `Container`）
- 接口：`PascalCase`（例如 `FeaturedAgentOptions`）
- 函数：`camelCase`（例如 `createContainer`）
- 常数：`UPPER_SNAKE_CASE` 用于导出的模块常数

**错误处理：**

- 使用有上下文的描述性错误信息
- 始终抛出 `Error` 或特定的错误类型
- 显式测试错误情况

有关全面的开发指南，请参见 [AGENTS.md](./AGENTS.md)。

### 贡献

我们欢迎社区贡献！请阅读我们的 [贡献指南](./CONTRIBUTING.md) 了解我们的开发流程、代码标准和如何提交拉取请求的详细信息。

**快速贡献步骤：**

1. Fork 该仓库
2. 创建您的功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 打开拉取请求

### 安全

有关安全问题，请阅读我们的 [安全策略](./SECURITY.md)。对于负责任的漏洞披露，请勿在公共问题中提出安全问题。

### 行为准则

在参与本项目之前，请查看我们的 [行为准则](./CODE_OF_CONDUCT.md)。我们致力于提供一个欢迎和包容的环境。

### 许可证

本项目采用 GNU General Public License v3.0 许可证 - 请查看 [LICENSE](./LICENSE) 文件获取详细信息。

### 支持与社区

- **问题报告**: 在 [GitHub Issues](https://github.com/author/misuzu/issues) 上报告 bug 或请求功能
- **讨论**: 加入我们在 [GitHub Discussions](https://github.com/author/misuzu/discussions) 上的社区讨论
- **文档**: 阅读我们的 [文档](./docs) 获取更多信息

### 更新日志

请参见 [CHANGELOG.md](./CHANGELOG.md) 了解详细的发布说明和版本历史。
