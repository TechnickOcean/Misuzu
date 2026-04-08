# Development Guide

[English](#english) | [中文](#chinese)

---

## English

This guide provides step-by-step instructions for setting up and developing Misuzu locally.

### Table of Contents

1. [System Requirements](#system-requirements)
2. [Initial Setup](#initial-setup)
3. [Development Workflow](#development-workflow)
4. [Common Development Tasks](#common-development-tasks)
5. [Debugging](#debugging)
6. [Performance Tips](#performance-tips)
7. [FAQ](#faq)

### System Requirements

**Minimum Requirements:**

- **OS**: macOS, Linux, Windows (with WSL2 recommended)
- **Node.js**: 22.12.0 or higher
- **pnpm**: 10.32.1 or higher
- **Git**: Latest version

**Check Your Versions:**

```bash
node --version    # Should be >= 22.12.0
pnpm --version    # Should be >= 10.32.1
git --version
```

**Update if Needed:**

```bash
# Install Node via nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 22.12.0
nvm use 22.12.0

# Install pnpm
npm install -g pnpm@10.32.1
```

### Initial Setup

#### 1. Fork and Clone

```bash
# Fork on GitHub, then clone your fork
git clone https://github.com/your-username/misuzu.git
cd misuzu

# Add upstream remote
git remote add upstream https://github.com/author/misuzu.git
```

#### 2. Install Dependencies

```bash
# Install all dependencies
pnpm install

# Verify installation
vp --version
```

#### 3. Verify Setup

```bash
# Run complete validation
vp run ready

# This runs:
# - Code formatting check
# - Linting
# - Type checking
# - All tests
# - Build all packages
```

### Development Workflow

#### Starting Development

```bash
# 1. Create a feature branch
git checkout -b feature/my-feature

# 2. Sync with latest upstream
git fetch upstream
git rebase upstream/main

# 3. Start development
# For web app:
cd apps/misuzu-web
pnpm run dev

# For specific package:
cd packages/misuzu-core
vp pack --watch
```

#### Making Changes

```bash
# In one terminal: watch your code
vp pack --watch

# In another terminal: run tests
vp test --watch

# Or run everything together
pnpm run dev:full  # (if available)
```

#### Before Committing

```bash
# Format and lint
vp check --fix

# Run tests
vp run test -r

# Full validation
vp run ready
```

#### Committing and Pushing

```bash
# Review changes
git status
git diff

# Stage and commit
git add .
git commit -m "feat(core): add amazing feature"

# Push to your fork
git push origin feature/my-feature

# Create PR on GitHub
```

### Common Development Tasks

#### Running Tests

```bash
# Run all tests
vp run test -r

# Run tests for specific package
cd packages/misuzu-core
vp test

# Run specific test file
vp test src/container.test.ts

# Run with coverage
vp test --coverage

# Watch mode (re-run on changes)
vp test --watch

# Run only changed files
vp test --changed
```

#### Building Packages

```bash
# Build all packages
vp run build -r

# Build specific package
cd packages/misuzu-core
vp pack

# Build with watch mode
vp pack --watch

# Build and verify output
ls packages/misuzu-core/dist/
```

#### Code Quality Checks

```bash
# Format code
vp fmt

# Lint code
vp lint

# Type check
vp check

# All checks + auto-fix
vp check --fix

# Full validation
vp run ready
```

#### Adding Dependencies

```bash
# Add to workspace root
vp add package-name

# Add to specific package
cd packages/misuzu-core
vp add package-name

# Add as dev dependency
vp add -D package-name

# Update dependency
vp update package-name

# Remove dependency
vp remove package-name
```

#### Creating New Packages

```bash
# Create package directory
mkdir -p packages/my-package
cd packages/my-package

# Copy from existing package template
cp -r ../misuzu-core/* .
rm -rf dist node_modules

# Update package.json
# Update tsconfig.json if needed

# Install dependencies
vp install

# Verify
vp test
```

### Debugging

#### Debug in VS Code

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Tests",
      "runtimeExecutable": "vp",
      "runtimeArgs": ["test", "--no-coverage"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Backend",
      "program": "${workspaceFolder}/apps/misuzu-web/src/server/main.ts",
      "console": "integratedTerminal"
    }
  ]
}
```

#### Console Logging

```typescript
// Use console for quick debugging
console.log("Value:", value)

// Use describe blocks for organization
console.debug("DEBUG:", data)
console.error("ERROR:", error)
```

#### Testing Specific Scenarios

```bash
# Run single test
vp test -- -t "test name"

# Run tests matching pattern
vp test -- --grep "pattern"

# Debug mode
node --inspect-brk ./node_modules/.bin/vitest
```

### Performance Tips

#### Optimize Development Speed

```bash
# Use --watch flags for development
vp pack --watch
vp test --watch

# Watch specific package only
cd packages/misuzu-core
vp test --watch

# Avoid rebuilding everything
# Just rebuild changed package
```

#### Reduce Build Times

```bash
# Don't run full validation every commit
# Just run relevant tests:
vp test -- packages/misuzu-core

# Use --changed to test only affected files
vp test --changed
```

#### Cache Management

```bash
# If experiencing issues, clear caches
rm -rf node_modules/.vite
rm -rf node_modules/.vitest

# Full reset
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### FAQ

**Q: I get "command not found: vp"**

- Run `pnpm install` again
- Check that Vite+ is installed: `npm list -g vite-plus`
- Try `npx vp --version` as workaround

**Q: Tests are failing locally**

- Run `pnpm install` to ensure dependencies are fresh
- Check Node.js version: `node --version`
- Clear cache: `rm -rf node_modules/.vitest`
- Try on CI to compare behavior

**Q: TypeScript errors but code works**

- Run `vp check` to see full type errors
- Check tsconfig.json settings
- Ensure all imports include `.ts` extension
- Look for implicit `any` types

**Q: Changes not reflected in dev mode**

- Restart dev server (Ctrl+C, then run again)
- Check file was saved
- Clear browser cache
- Check for compilation errors in console

**Q: Build fails with strange errors**

- Run `vp check --fix` first
- Delete dist folder: `rm -rf dist`
- Reinstall dependencies: `pnpm install`
- Try building just one package

**Q: Need to reset everything**

```bash
# Complete reset
git clean -fd
rm -rf node_modules
rm pnpm-lock.yaml
pnpm install
vp run ready
```

### Getting Help

- Check [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines
- Read [AGENTS.md](./AGENTS.md) for code standards
- Review [README.md](./README.md) for project overview
- Open an issue or discussion on [GitHub](https://github.com/author/misuzu)

---

## Chinese

本指南提供了在本地设置和开发 Misuzu 的分步说明。

### 目录

1. [系统要求](#系统要求)
2. [初始设置](#初始设置)
3. [开发工作流程](#开发工作流程)
4. [常见开发任务](#常见开发任务)
5. [调试](#调试)
6. [性能提示](#性能提示)
7. [常见问题](#常见问题)

### 系统要求

**最低要求：**

- **OS**: macOS、Linux、Windows（推荐使用 WSL2）
- **Node.js**: 22.12.0 或更高版本
- **pnpm**: 10.32.1 或更高版本
- **Git**: 最新版本

**检查您的版本：**

```bash
node --version    # 应该 >= 22.12.0
pnpm --version    # 应该 >= 10.32.1
git --version
```

**如果需要更新：**

```bash
# 通过 nvm 安装 Node（推荐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 22.12.0
nvm use 22.12.0

# 安装 pnpm
npm install -g pnpm@10.32.1
```

### 初始设置

#### 1. Fork 和克隆

```bash
# 在 GitHub 上 Fork，然后克隆您的 fork
git clone https://github.com/your-username/misuzu.git
cd misuzu

# 添加 upstream 远程
git remote add upstream https://github.com/author/misuzu.git
```

#### 2. 安装依赖

```bash
# 安装所有依赖
pnpm install

# 验证安装
vp --version
```

#### 3. 验证设置

```bash
# 运行完整验证
vp run ready

# 这将运行：
# - 代码格式检查
# - Linting
# - 类型检查
# - 所有测试
# - 构建所有包
```

### 开发工作流程

#### 开始开发

```bash
# 1. 创建功能分支
git checkout -b feature/my-feature

# 2. 与最新 upstream 同步
git fetch upstream
git rebase upstream/main

# 3. 开始开发
# 对于网页应用：
cd apps/misuzu-web
pnpm run dev

# 对于特定包：
cd packages/misuzu-core
vp pack --watch
```

#### 进行更改

```bash
# 在一个终端：监听您的代码
vp pack --watch

# 在另一个终端：运行测试
vp test --watch

# 或全部一起运行
pnpm run dev:full  # （如果可用）
```

#### 提交前

```bash
# 格式化和 lint
vp check --fix

# 运行测试
vp run test -r

# 完整验证
vp run ready
```

#### 提交和推送

```bash
# 审查更改
git status
git diff

# 暂存和提交
git add .
git commit -m "feat(core): add amazing feature"

# 推送到您的 fork
git push origin feature/my-feature

# 在 GitHub 上创建 PR
```

### 常见开发任务

#### 运行测试

```bash
# 运行所有测试
vp run test -r

# 为特定包运行测试
cd packages/misuzu-core
vp test

# 运行特定测试文件
vp test src/container.test.ts

# 运行并生成覆盖率
vp test --coverage

# 监听模式（更改时重新运行）
vp test --watch

# 仅运行已更改文件
vp test --changed
```

#### 构建包

```bash
# 构建所有包
vp run build -r

# 构建特定包
cd packages/misuzu-core
vp pack

# 构建并监听模式
vp pack --watch

# 构建并验证输出
ls packages/misuzu-core/dist/
```

#### 代码质量检查

```bash
# 格式化代码
vp fmt

# Lint 代码
vp lint

# 类型检查
vp check

# 所有检查 + 自动修复
vp check --fix

# 完整验证
vp run ready
```

#### 添加依赖

```bash
# 添加到工作区根目录
vp add package-name

# 添加到特定包
cd packages/misuzu-core
vp add package-name

# 添加作为开发依赖
vp add -D package-name

# 更新依赖
vp update package-name

# 删除依赖
vp remove package-name
```

#### 创建新包

```bash
# 创建包目录
mkdir -p packages/my-package
cd packages/my-package

# 从现有包模板复制
cp -r ../misuzu-core/* .
rm -rf dist node_modules

# 更新 package.json
# 如果需要，更新 tsconfig.json

# 安装依赖
vp install

# 验证
vp test
```

### 调试

#### 在 VS Code 中调试

创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Tests",
      "runtimeExecutable": "vp",
      "runtimeArgs": ["test", "--no-coverage"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Backend",
      "program": "${workspaceFolder}/apps/misuzu-web/src/server/main.ts",
      "console": "integratedTerminal"
    }
  ]
}
```

#### 控制台日志

```typescript
// 使用 console 快速调试
console.log("Value:", value)

// 使用描述块进行组织
console.debug("DEBUG:", data)
console.error("ERROR:", error)
```

#### 测试特定场景

```bash
# 运行单个测试
vp test -- -t "test name"

# 运行匹配模式的测试
vp test -- --grep "pattern"

# 调试模式
node --inspect-brk ./node_modules/.bin/vitest
```

### 性能提示

#### 优化开发速度

```bash
# 在开发中使用 --watch 标志
vp pack --watch
vp test --watch

# 仅监听特定包
cd packages/misuzu-core
vp test --watch

# 避免重建所有内容
# 仅重建已更改的包
```

#### 减少构建时间

```bash
# 不要在每次提交时运行完整验证
# 仅运行相关测试：
vp test -- packages/misuzu-core

# 使用 --changed 仅测试受影响的文件
vp test --changed
```

#### 缓存管理

```bash
# 如果遇到问题，清除缓存
rm -rf node_modules/.vite
rm -rf node_modules/.vitest

# 完整重置
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### 常见问题

**Q：我收到"command not found: vp"**

- 再次运行 `pnpm install`
- 检查 Vite+ 是否已安装：`npm list -g vite-plus`
- 作为变通方法尝试 `npx vp --version`

**Q：本地测试失败**

- 运行 `pnpm install` 确保依赖是最新的
- 检查 Node.js 版本：`node --version`
- 清除缓存：`rm -rf node_modules/.vitest`
- 尝试在 CI 上比较行为

**Q：TypeScript 错误但代码有效**

- 运行 `vp check` 查看完整的类型错误
- 检查 tsconfig.json 设置
- 确保所有导入都包含 `.ts` 扩展名
- 查找隐式 `any` 类型

**Q：开发模式中的更改未反映**

- 重启开发服务器（Ctrl+C，然后再次运行）
- 检查文件是否已保存
- 清除浏览器缓存
- 在控制台中检查编译错误

**Q：构建因奇怪的错误而失败**

- 首先运行 `vp check --fix`
- 删除 dist 文件夹：`rm -rf dist`
- 重新安装依赖：`pnpm install`
- 尝试仅构建一个包

**Q：需要重置一切**

```bash
# 完整重置
git clean -fd
rm -rf node_modules
rm pnpm-lock.yaml
pnpm install
vp run ready
```

### 获取帮助

- 查看 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解贡献指南
- 阅读 [AGENTS.md](./AGENTS.md) 了解代码标准
- 查看 [README.md](./README.md) 了解项目概述
- 在 [GitHub](https://github.com/author/misuzu) 上打开 issue 或讨论
