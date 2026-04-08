# misuzu-core

> The core TypeScript library for the Misuzu ecosystem.

[English](#english) | [中文](#chinese)

---

## English

### Overview

**misuzu-core** is the foundational library for the Misuzu ecosystem. It provides essential utilities and functionality for building TypeScript applications.

### Features

- 📦 **Modular Design** - Well-organized, focused modules
- 🧪 **Type-Safe** - Strict TypeScript with full type checking
- ⚡ **Tree-Shakeable** - Only import what you need
- 🎯 **Zero Dependencies** - Minimal external dependencies
- 📚 **Well Documented** - Clear examples and API documentation
- ✅ **Well Tested** - Comprehensive test coverage

### Installation

```bash
npm install misuzu-core
# or
pnpm add misuzu-core
# or
yarn add misuzu-core
```

### Quick Start

```typescript
import {} from /* exports */ "misuzu-core"

// Use exported APIs
```

### Available Modules

The core library is organized into logical modules. Each module focuses on a specific concern:

```typescript
// Example: Import from specific modules
import { feature1, feature2 } from "misuzu-core"
```

### API Documentation

For detailed API documentation, see the [docs](../../docs) folder.

### Development

#### Setup

```bash
cd packages/misuzu-core
pnpm install
```

#### Commands

```bash
# Build the library
vp pack

# Build with watch mode
vp pack --watch

# Run tests
vp test

# Run tests in watch mode
vp test --watch

# Generate coverage report
vp test --coverage

# Format and lint code
vp check
vp check --fix
```

#### File Structure

```
src/
├── index.ts           # Main entry point
├── [feature]/        # Feature modules
│   ├── index.ts      # Module exports
│   ├── types.ts      # Type definitions
│   └── *.test.ts     # Tests
└── utils/            # Shared utilities
```

### Contributing

We welcome contributions! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

**Development Workflow:**

1. Create a feature branch
2. Make your changes
3. Run `vp check --fix` to format code
4. Run `vp test` to ensure tests pass
5. Commit with conventional commit messages
6. Push and open a pull request

### Testing

We use Vitest for testing. Tests should follow these patterns:

```typescript
import { describe, expect, test } from "vite-plus/test"
import { myFunction } from "./my-module.ts"

describe("myFunction", () => {
  test("does something", () => {
    const result = myFunction("input")
    expect(result).toBe("expected")
  })

  test("throws error when invalid", () => {
    expect(() => {
      myFunction(null)
    }).toThrow("Invalid input")
  })
})
```

### Build Output

The library is built with tsdown and produces:

- `dist/index.mjs` - ES module output
- `dist/index.d.ts` - TypeScript type definitions

### TypeScript Support

- **Minimum TypeScript**: 5.0
- **Strict Mode**: Enabled by default
- **Full Type Safety**: No implicit `any`

### License

MIT - See [LICENSE](../../LICENSE)

### Support

- **Issues**: Report bugs on [GitHub Issues](https://github.com/author/misuzu/issues)
- **Discussions**: Join conversations on [GitHub Discussions](https://github.com/author/misuzu/discussions)
- **Documentation**: Check [README.md](../../README.md) for more info

---

## Chinese

### 概述

**misuzu-core** 是 Misuzu 生态系统的基础库。它为构建 TypeScript 应用程序提供必要的工具和功能。

### 特性

- 📦 **模块化设计** - 组织良好的聚焦模块
- 🧪 **类型安全** - 严格的 TypeScript 和完整的类型检查
- ⚡ **可树摇** - 仅导入所需内容
- 🎯 **零依赖** - 最小的外部依赖
- 📚 **文档齐全** - 清晰的示例和 API 文档
- ✅ **充分测试** - 全面的测试覆盖

### 安装

```bash
npm install misuzu-core
# 或
pnpm add misuzu-core
# 或
yarn add misuzu-core
```

### 快速开始

```typescript
import {} from /* exports */ "misuzu-core"

// 使用导出的 API
```

### 可用模块

核心库被组织成逻辑模块。每个模块都关注特定的关注点：

```typescript
// 示例：从特定模块导入
import { feature1, feature2 } from "misuzu-core"
```

### API 文档

详细的 API 文档，请参见 [文档](../../docs) 文件夹。

### 开发

#### 设置

```bash
cd packages/misuzu-core
pnpm install
```

#### 命令

```bash
# 构建库
vp pack

# 在监听模式下构建
vp pack --watch

# 运行测试
vp test

# 在监听模式下运行测试
vp test --watch

# 生成覆盖率报告
vp test --coverage

# 格式化和 lint 代码
vp check
vp check --fix
```

#### 文件结构

```
src/
├── index.ts           # 主入口点
├── [feature]/        # 功能模块
│   ├── index.ts      # 模块导出
│   ├── types.ts      # 类型定义
│   └── *.test.ts     # 测试
└── utils/            # 共享工具
```

### 贡献

我们欢迎贡献！请参见 [CONTRIBUTING.md](../../CONTRIBUTING.md) 了解详细信息。

**开发工作流程：**

1. 创建功能分支
2. 进行更改
3. 运行 `vp check --fix` 格式化代码
4. 运行 `vp test` 确保测试通过
5. 使用 conventional commit 消息提交
6. 推送并打开拉取请求

### 测试

我们使用 Vitest 进行测试。测试应遵循以下模式：

```typescript
import { describe, expect, test } from "vite-plus/test"
import { myFunction } from "./my-module.ts"

describe("myFunction", () => {
  test("does something", () => {
    const result = myFunction("input")
    expect(result).toBe("expected")
  })

  test("throws error when invalid", () => {
    expect(() => {
      myFunction(null)
    }).toThrow("Invalid input")
  })
})
```

### 构建输出

该库使用 tsdown 构建并生成：

- `dist/index.mjs` - ES 模块输出
- `dist/index.d.ts` - TypeScript 类型定义

### TypeScript 支持

- **最小 TypeScript 版本**：5.0
- **严格模式**：默认启用
- **完整类型安全**：无隐式 `any`

### 许可证

MIT - 请参见 [LICENSE](../../LICENSE)

### 支持

- **Issue 报告**：在 [GitHub Issues](https://github.com/author/misuzu/issues) 上报告 bug
- **讨论**：在 [GitHub Discussions](https://github.com/author/misuzu/discussions) 上加入对话
- **文档**：检查 [README.md](../../README.md) 获取更多信息
