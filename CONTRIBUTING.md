# Contributing to Misuzu

[English](#english) | [中文](#chinese)

---

## English

### Welcome Contributors!

We're thrilled that you're interested in contributing to Misuzu! This document provides guidelines and instructions for contributing to the project.

### Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md). We are committed to providing a welcoming and inclusive environment for everyone.

### Ways to Contribute

**There are many ways you can contribute to Misuzu:**

- 🐛 **Report Bugs** - Found a bug? Let us know on [GitHub Issues](https://github.com/author/misuzu/issues)
- ✨ **Suggest Features** - Have an idea for a new feature? Share it with us
- 📚 **Improve Documentation** - Help us improve our docs and examples
- 🔧 **Fix Bugs** - Submit a pull request with a bug fix
- 🎯 **Implement Features** - Work on requested features
- 🧪 **Write Tests** - Improve our test coverage
- 💬 **Answer Questions** - Help other community members

### Getting Started

#### Prerequisites

- Node.js >= 22.12.0
- pnpm >= 10.32.1
- Git

#### Setup Development Environment

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/misuzu.git
   cd misuzu
   ```
3. **Add upstream remote** to stay in sync:
   ```bash
   git remote add upstream https://github.com/author/misuzu.git
   ```
4. **Install dependencies**:
   ```bash
   pnpm install
   ```
5. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-amazing-feature
   ```

### Development Workflow

#### Before Starting Work

```bash
# Sync with upstream
git fetch upstream
git rebase upstream/main

# Ensure everything is ready
vp run ready
```

#### During Development

```bash
# Run development server (for web app)
pnpm run dev

# Run tests in watch mode
pnpm run test -- --watch

# Run specific package tests
cd packages/misuzu-core
vp test --watch

# Check code quality
vp check

# Auto-fix formatting and linting
vp check --fix
```

#### Before Committing

```bash
# Format and lint
vp check --fix

# Run all tests
vp run test -r

# Run full validation
vp run ready
```

### Commit Guidelines

We follow conventional commit messages to ensure a clear, meaningful commit history.

**Format:** `<type>(<scope>): <subject>`

**Types:**

- `feat:` A new feature
- `fix:` A bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, missing semicolons, etc.)
- `refactor:` Code refactoring without feature changes
- `perf:` Performance improvements
- `test:` Adding or updating tests
- `chore:` Build tool, dependency, or configuration changes
- `ci:` CI/CD configuration changes

**Scope:** (optional) Affected module/package

- `core:` Core library changes
- `web:` Web application changes
- `build:` Build system changes
- etc.

**Examples:**

```bash
git commit -m "feat(core): add dependency injection container"
git commit -m "fix(web): resolve routing issue on login page"
git commit -m "docs: improve API documentation"
git commit -m "test(core): add comprehensive error handling tests"
git commit -m "refactor(web): simplify component composition"
```

### Pull Request Process

1. **Create a descriptive PR title** following the conventional commit format
2. **Fill out the PR template** with all required information
3. **Link related issues** using `Closes #123` or `Relates to #456`
4. **Ensure all checks pass:**
   - Tests pass
   - Code coverage is maintained or improved
   - No lint errors
   - TypeScript compiles without errors
5. **Request reviews** from maintainers
6. **Address feedback** promptly and push updates to your branch
7. **Squash commits** if requested by reviewers

### Code Standards

#### TypeScript & Formatting

- **No semicolons** - Configured with `semi: false`
- **Strict types** - `strict: true` enforced everywhere
- **ES modules** - Use `import`/`export`, never `require()`
- **Type extensions** - Include `.ts` in TypeScript imports
- **Type imports** - Use `import type` for type-only imports
- **No `any`** - Use specific types instead of `any`

#### Naming Conventions

```typescript
// Files: kebab-case
// ✓ base-tools.ts
// ✓ di-container.ts

// Classes: PascalCase
// ✓ class Container {}
// ✓ class FeaturedAgent {}

// Interfaces: PascalCase
// ✓ interface FeaturedAgentOptions {}
// ✓ interface ContainerConfig {}

// Functions: camelCase
// ✓ function createContainer() {}
// ✓ function registerSingleton() {}

// Constants (exported): UPPER_SNAKE_CASE
// ✓ export const MAX_TIMEOUT = 5000
// ✓ export const DEFAULT_CONFIG = {}

// Private constants: UPPER_SNAKE_CASE
// ✓ const INTERNAL_VERSION = '1.0.0'
```

#### Error Handling

```typescript
// ✓ Descriptive error messages with context
throw new Error(`Missing dependency for token: ${String(token.description)}`)

// ✓ Always throw Error or specific error types
throw new ValidationError("Invalid configuration")

// ✗ Don't throw raw strings
throw "Something went wrong"
```

#### Testing

```typescript
// ✓ Use vite-plus/test, not vitest
import { describe, expect, test } from "vite-plus/test"

// ✓ Descriptive test names
test("resolves singleton dependencies only once", () => {
  // test body
})

// ✓ Test both success and error cases
describe("createContainer", () => {
  test("creates container successfully", () => {})
  test("throws error when invalid config provided", () => {})
})

// ✓ File naming: .test.ts suffix
// ✓ container.test.ts
```

### File Structure

When adding new features, follow this structure:

```
packages/misuzu-core/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── [feature-name]/         # Feature directory
│   │   ├── index.ts            # Feature exports
│   │   ├── [component].ts       # Implementation
│   │   ├── types.ts            # Type definitions
│   │   └── [component].test.ts  # Tests
│   └── utils/                  # Shared utilities
├── dist/                       # Built output
└── package.json

apps/misuzu-web/
├── src/
│   ├── pages/                  # Page components
│   ├── components/             # Reusable components
│   ├── composables/            # Vue composables
│   ├── stores/                 # Pinia stores
│   ├── types/                  # Type definitions
│   └── server/                 # Server code (if applicable)
└── package.json
```

### Documentation

When contributing code, please also update relevant documentation:

- **Code comments** - Explain complex logic with comments
- **JSDoc** - Document public functions and classes
- **README** - Update package README if adding major features
- **CHANGELOG** - Document your changes in [CHANGELOG.md](./CHANGELOG.md)

**Example JSDoc:**

```typescript
/**
 * Creates a new dependency injection container.
 *
 * @param options - Container configuration options
 * @returns A new container instance
 * @example
 * const container = createContainer({ strict: true })
 * container.register('service', Service)
 */
export function createContainer(options?: ContainerConfig): Container {
  // implementation
}
```

### Running Tests

```bash
# Run all tests
vp run test -r

# Run tests for specific package
cd packages/misuzu-core
vp test

# Run specific test file
vp test container.test.ts

# Run tests in watch mode
vp test --watch

# Run tests with coverage
vp test --coverage

# Run tests for changed files
vp test --changed
```

### Building

```bash
# Build all packages
vp run build -r

# Build specific package
cd packages/misuzu-core
vp pack

# Build with watch mode
vp pack --watch
```

### Troubleshooting

**Q: Tests are failing locally but pass on CI**

- Run `vp install` to ensure dependencies are up to date
- Check that you're using the correct Node.js version

**Q: Linting errors that seem incorrect**

- Run `vp check --fix` to auto-fix most issues
- Consult [AGENTS.md](./AGENTS.md) for code standards

**Q: Build fails with TypeScript errors**

- Run `vp check` to see all type errors
- Ensure all types are properly defined (no `any`)

**Q: Changes not reflected during development**

- Clear node_modules: `rm -rf node_modules && pnpm install`
- Restart dev server: Ctrl+C and `pnpm run dev`

### Getting Help

- **Questions?** Ask in [GitHub Discussions](https://github.com/author/misuzu/discussions)
- **Found a bug?** Report it on [GitHub Issues](https://github.com/author/misuzu/issues)
- **Security issue?** See [SECURITY.md](./SECURITY.md)
- **Chat with us?** Join our community Discord (if available)

### Recognition

Contributors will be recognized in:

- [CONTRIBUTORS.md](./CONTRIBUTORS.md) file
- GitHub contributor graph
- Release notes for significant contributions

Thank you for contributing to Misuzu! 🚀

---

## Chinese

### 欢迎贡献者！

我们很高兴你有兴趣为 Misuzu 做出贡献！本文档提供了向该项目贡献的指南和说明。

### 行为准则

通过参与此项目，您同意遵守我们的 [行为准则](./CODE_OF_CONDUCT.md)。我们致力于为每个人提供欢迎和包容的环境。

### 贡献方式

**有很多方式可以为 Misuzu 做出贡献：**

- 🐛 **报告 Bug** - 发现了 bug？在 [GitHub Issues](https://github.com/author/misuzu/issues) 上告诉我们
- ✨ **建议功能** - 有新功能的想法？与我们分享
- 📚 **改进文档** - 帮助我们改进文档和示例
- 🔧 **修复 Bug** - 提交带有 bug 修复的拉取请求
- 🎯 **实现功能** - 处理请求的功能
- 🧪 **编写测试** - 提高我们的测试覆盖率
- 💬 **回答问题** - 帮助其他社区成员

### 快速开始

#### 环境要求

- Node.js >= 22.12.0
- pnpm >= 10.32.1
- Git

#### 设置开发环境

1. **在 GitHub 上 Fork 该仓库**
2. **在本地克隆您的 fork**：
   ```bash
   git clone https://github.com/your-username/misuzu.git
   cd misuzu
   ```
3. **添加 upstream 远程** 保持同步：
   ```bash
   git remote add upstream https://github.com/author/misuzu.git
   ```
4. **安装依赖**：
   ```bash
   pnpm install
   ```
5. **创建功能分支**：
   ```bash
   git checkout -b feature/your-amazing-feature
   ```

### 开发工作流程

#### 开始工作前

```bash
# 与 upstream 同步
git fetch upstream
git rebase upstream/main

# 确保一切就绪
vp run ready
```

#### 开发期间

```bash
# 运行开发服务器（用于网页应用）
pnpm run dev

# 在监听模式下运行测试
pnpm run test -- --watch

# 运行特定包的测试
cd packages/misuzu-core
vp test --watch

# 检查代码质量
vp check

# 自动修复格式化和 linting
vp check --fix
```

#### 提交前

```bash
# 格式化和 lint
vp check --fix

# 运行所有测试
vp run test -r

# 运行完整验证
vp run ready
```

### 提交指南

我们遵循 Conventional Commits 来确保清晰、有意义的提交历史。

**格式：** `<type>(<scope>): <subject>`

**类型：**

- `feat:` 新功能
- `fix:` 修复 bug
- `docs:` 文档更改
- `style:` 代码风格更改（格式化、缺少分号等）
- `refactor:` 代码重构，不涉及功能变化
- `perf:` 性能改进
- `test:` 添加或更新测试
- `chore:` 构建工具、依赖或配置更改
- `ci:` CI/CD 配置更改

**范围：**（可选）受影响的模块/包

- `core:` 核心库更改
- `web:` 网页应用更改
- `build:` 构建系统更改
- 等等

**示例：**

```bash
git commit -m "feat(core): add dependency injection container"
git commit -m "fix(web): resolve routing issue on login page"
git commit -m "docs: improve API documentation"
git commit -m "test(core): add comprehensive error handling tests"
git commit -m "refactor(web): simplify component composition"
```

### 拉取请求流程

1. **创建描述性的 PR 标题** 遵循 Conventional Commit 格式
2. **填写 PR 模板** 包含所有必需信息
3. **链接相关 issue** 使用 `Closes #123` 或 `Relates to #456`
4. **确保所有检查通过：**
   - 测试通过
   - 代码覆盖率保持或改进
   - 无 lint 错误
   - TypeScript 编译无错误
5. **请求审核** 来自维护者
6. **及时处理反馈** 并推送更新到你的分支
7. **如果需要，压缩提交** 由审核者请求

### 代码标准

#### TypeScript 和格式化

- **无分号** - 配置 `semi: false`
- **严格类型** - 在任何地方强制 `strict: true`
- **ES 模块** - 使用 `import`/`export`，永远不要 `require()`
- **类型扩展** - 在 TypeScript 导入中包含 `.ts`
- **类型导入** - 对仅类型的导入使用 `import type`
- **无 `any`** - 使用特定类型而不是 `any`

#### 命名约定

```typescript
// 文件：kebab-case
// ✓ base-tools.ts
// ✓ di-container.ts

// 类：PascalCase
// ✓ class Container {}
// ✓ class FeaturedAgent {}

// 接口：PascalCase
// ✓ interface FeaturedAgentOptions {}
// ✓ interface ContainerConfig {}

// 函数：camelCase
// ✓ function createContainer() {}
// ✓ function registerSingleton() {}

// 常数（导出）：UPPER_SNAKE_CASE
// ✓ export const MAX_TIMEOUT = 5000
// ✓ export const DEFAULT_CONFIG = {}

// 私有常数：UPPER_SNAKE_CASE
// ✓ const INTERNAL_VERSION = '1.0.0'
```

#### 错误处理

```typescript
// ✓ 带上下文的描述性错误信息
throw new Error(`Missing dependency for token: ${String(token.description)}`)

// ✓ 总是抛出 Error 或特定的错误类型
throw new ValidationError("Invalid configuration")

// ✗ 不要抛出原始字符串
throw "Something went wrong"
```

#### 测试

```typescript
// ✓ 使用 vite-plus/test，不是 vitest
import { describe, expect, test } from "vite-plus/test"

// ✓ 描述性的测试名称
test("resolves singleton dependencies only once", () => {
  // test body
})

// ✓ 测试成功和错误情况
describe("createContainer", () => {
  test("creates container successfully", () => {})
  test("throws error when invalid config provided", () => {})
})

// ✓ 文件命名：.test.ts 后缀
// ✓ container.test.ts
```

### 文件结构

添加新功能时，遵循此结构：

```
packages/misuzu-core/
├── src/
│   ├── index.ts                 # 主入口点
│   ├── [feature-name]/         # 功能目录
│   │   ├── index.ts            # 功能导出
│   │   ├── [component].ts       # 实现
│   │   ├── types.ts            # 类型定义
│   │   └── [component].test.ts  # 测试
│   └── utils/                  # 共享工具函数
├── dist/                       # 构建输出
└── package.json

apps/misuzu-web/
├── src/
│   ├── pages/                  # 页面组件
│   ├── components/             # 可复用组件
│   ├── composables/            # Vue composables
│   ├── stores/                 # Pinia 存储
│   ├── types/                  # 类型定义
│   └── server/                 # 服务器代码（如适用）
└── package.json
```

### 文档

在贡献代码时，请也更新相关文档：

- **代码注释** - 用注释解释复杂逻辑
- **JSDoc** - 记录公共函数和类
- **README** - 如果添加主要功能，更新包 README
- **CHANGELOG** - 在 [CHANGELOG.md](./CHANGELOG.md) 中记录你的更改

**JSDoc 示例：**

```typescript
/**
 * 创建一个新的依赖注入容器。
 *
 * @param options - 容器配置选项
 * @returns 新的容器实例
 * @example
 * const container = createContainer({ strict: true })
 * container.register('service', Service)
 */
export function createContainer(options?: ContainerConfig): Container {
  // implementation
}
```

### 运行测试

```bash
# 运行所有测试
vp run test -r

# 运行特定包的测试
cd packages/misuzu-core
vp test

# 运行指定测试文件
vp test container.test.ts

# 在监听模式下运行测试
vp test --watch

# 运行测试并生成覆盖率报告
vp test --coverage

# 运行已更改文件的测试
vp test --changed
```

### 构建

```bash
# 构建所有包
vp run build -r

# 构建特定包
cd packages/misuzu-core
vp pack

# 在监听模式下构建
vp pack --watch
```

### 故障排除

**Q：本地测试失败但在 CI 中通过**

- 运行 `vp install` 确保依赖是最新的
- 检查你是否使用了正确的 Node.js 版本

**Q：Linting 错误看起来不正确**

- 运行 `vp check --fix` 自动修复大多数问题
- 查阅 [AGENTS.md](./AGENTS.md) 了解代码标准

**Q：构建因 TypeScript 错误而失败**

- 运行 `vp check` 查看所有类型错误
- 确保所有类型都正确定义（无 `any`）

**Q：开发期间更改未反映**

- 清除 node_modules: `rm -rf node_modules && pnpm install`
- 重启开发服务器：Ctrl+C 和 `pnpm run dev`

### 获取帮助

- **有问题？** 在 [GitHub Discussions](https://github.com/author/misuzu/discussions) 中提问
- **发现 bug？** 在 [GitHub Issues](https://github.com/author/misuzu/issues) 上报告
- **安全问题？** 请参见 [SECURITY.md](./SECURITY.md)
- **与我们聊天？** 加入我们的社区 Discord（如有）

### 致谢

贡献者将被认可为：

- [CONTRIBUTORS.md](./CONTRIBUTORS.md) 文件
- GitHub 贡献者图表
- 重要贡献的发布说明

感谢为 Misuzu 做贡献！🚀
