# Security Policy

[English](#english) | [中文](#chinese)

---

## English

### Reporting a Vulnerability

We take security very seriously. If you discover a security vulnerability in Misuzu, please report it responsibly and do not publicly disclose the vulnerability until we have had a chance to address it.

**To report a security vulnerability:**

1. **Do NOT open a public GitHub issue** for security vulnerabilities
2. **Email us** at `security@example.com` with:
   - Description of the vulnerability
   - Steps to reproduce (if applicable)
   - Potential impact
   - Suggested fix (if you have one)
3. **Include your contact information** for follow-up communication
4. **Allow time for response** - we aim to respond within 48 hours

### Response Process

We follow this process for handling security vulnerabilities:

1. **Acknowledgment** (within 48 hours) - We'll confirm receipt of your report
2. **Investigation** (1-2 weeks) - Our team investigates and assesses the vulnerability
3. **Fix Development** - We develop and test a fix
4. **Notification** - We notify you before public disclosure
5. **Release** - We release a patched version
6. **Disclosure** - We publicly disclose the vulnerability and credit you (if desired)

### Security Best Practices

#### For Users

When using Misuzu, follow these security best practices:

**Dependency Management:**

- Keep Misuzu and all dependencies up to date
- Regularly audit dependencies for known vulnerabilities: `npm audit`
- Use lock files (pnpm-lock.yaml) to ensure reproducible installs

**Development:**

- Don't commit sensitive credentials (API keys, tokens, passwords)
- Use environment variables for sensitive configuration
- Never push `.env` or similar files containing secrets
- Use `.gitignore` to exclude sensitive files

**Deployment:**

- Validate and sanitize all user inputs
- Use environment-specific configurations
- Keep production dependencies minimal
- Monitor for security updates

**TypeScript & Code:**

- Use strict TypeScript (`strict: true`) to catch type errors
- Avoid using `any` types that bypass type safety
- Keep error messages descriptive but not revealing sensitive info

#### For Contributors

If you're contributing to Misuzu:

**Before Contributing:**

- Review our [Contributing Guidelines](./CONTRIBUTING.md)
- Check for known security issues in [GitHub Security Advisories](https://github.com/author/misuzu/security)

**When Writing Code:**

- Don't hardcode secrets or sensitive data
- Validate all inputs carefully
- Use type-safe patterns (avoid `any`)
- Write tests for security-critical code
- Document security considerations in comments

**When Submitting PRs:**

- Explain any security implications
- Reference related security issues if applicable
- Ensure all tests pass
- Update security-related documentation if needed

### Known Security Considerations

#### Dependency Security

Misuzu depends on several external packages. We regularly:

- Monitor for security advisories
- Update dependencies promptly
- Audit the dependency tree

To check for vulnerabilities in your installation:

```bash
npm audit
# or with pnpm
pnpm audit
```

#### TypeScript & Type Safety

Misuzu enforces strict TypeScript checks (`strict: true`) to prevent common security issues:

- No implicit `any` types
- Strict null checks
- Type-safe error handling

#### Cryptography

Misuzu does not provide cryptographic functions. For cryptographic operations, use:

- `node:crypto` (built-in Node.js module)
- `tweetnacl-js` (proven cryptographic library)
- `sodium-plus` (libsodium wrapper)

Never implement your own cryptography.

### Security Headers & Environment

#### Environment Variables

Never commit sensitive data:

```bash
# ✓ Good: Use environment variables
const apiKey = process.env.API_KEY

# ✗ Bad: Hardcoded secrets
const apiKey = 'sk-1234567890'
```

#### Error Handling

Don't expose sensitive information in error messages:

```typescript
// ✗ Bad: Reveals database structure
throw new Error(`Database error: ${error.message}`)

// ✓ Good: Generic error message
throw new Error("An error occurred while processing your request")
```

### Third-Party Security

#### Package Updates

We automatically check for security updates and:

- Apply critical security patches promptly
- Document security fixes in release notes
- Notify users of breaking security changes

#### Monitoring

We monitor:

- GitHub Security Advisories
- NPM security announcements
- Dependabot alerts
- CVSS vulnerability scores

### Compliance

Misuzu aims to comply with:

- [OWASP Top 10](https://owasp.org/www-project-top-ten/) security risks
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/) weakest software errors
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

### Support

**Security Related Questions:**

- Email: `security@example.com`
- Do NOT post security questions in public issues
- Please use responsible disclosure

**Security Resources:**

- [OWASP](https://owasp.org/)
- [Node.js Security](https://nodejs.org/en/docs/guides/security/)
- [npm Security](https://docs.npmjs.com/packages-and-modules/managing-packages-and-modules/about-npm-security)

### Changelog & Advisories

For past security issues and their fixes:

- Check [GitHub Security Advisories](https://github.com/author/misuzu/security/advisories)
- Review [CHANGELOG.md](./CHANGELOG.md)
- Subscribe to [GitHub security alerts](https://github.blog/changelog/2021-04-13-security-and-analysis-settings-for-repositories-owned-by-organizations/)

---

## Chinese

### 报告安全漏洞

我们非常重视安全。如果你发现 Misuzu 中存在安全漏洞，请负责任地报告，不要在我们有机会处理之前公开披露该漏洞。

**报告安全漏洞：**

1. **不要打开公开的 GitHub issue** 来报告安全漏洞
2. **发送邮件** 至 `security@example.com`，包含：
   - 漏洞说明
   - 复现步骤（如适用）
   - 潜在影响
   - 建议的修复（如果有）
3. **包含您的联系方式** 以便后续沟通
4. **预留处理时间** - 我们目标在 48 小时内响应

### 响应流程

我们按照以下流程处理安全漏洞：

1. **确认收到**（48 小时内）- 我们确认收到您的报告
2. **调查**（1-2 周）- 我们的团队调查和评估漏洞
3. **修复开发** - 我们开发并测试修复
4. **通知** - 我们在公开披露前通知您
5. **发布** - 我们发布补丁版本
6. **披露** - 我们公开披露漏洞并致谢（如需要）

### 安全最佳实践

#### 对于用户

使用 Misuzu 时，遵循以下安全最佳实践：

**依赖管理：**

- 使 Misuzu 和所有依赖保持最新
- 定期审计依赖的已知漏洞：`npm audit`
- 使用 lock 文件（pnpm-lock.yaml）确保可复现安装

**开发：**

- 不要提交敏感凭证（API 密钥、令牌、密码）
- 对敏感配置使用环境变量
- 永远不要推送包含机密的 `.env` 或类似文件
- 使用 `.gitignore` 排除敏感文件

**部署：**

- 验证并清理所有用户输入
- 使用特定于环境的配置
- 使生产依赖最小化
- 监控安全更新

**TypeScript 和代码：**

- 使用严格的 TypeScript（`strict: true`）来捕获类型错误
- 避免使用绕过类型安全的 `any` 类型
- 保持错误信息描述性但不泄露敏感信息

#### 对于贡献者

如果你贡献于 Misuzu：

**贡献前：**

- 审阅我们的 [贡献指南](./CONTRIBUTING.md)
- 检查 [GitHub 安全公告](https://github.com/author/misuzu/security) 中的已知安全问题

**编写代码时：**

- 不要硬编码机密或敏感数据
- 小心验证所有输入
- 使用类型安全的模式（避免 `any`）
- 为安全关键代码编写测试
- 在注释中记录安全考虑

**提交 PR 时：**

- 解释任何安全影响
- 如适用，引用相关的安全问题
- 确保所有测试通过
- 如需要，更新安全相关文档

### 已知安全考虑

#### 依赖安全

Misuzu 依赖于多个外部包。我们定期：

- 监控安全公告
- 及时更新依赖
- 审计依赖树

检查安装中是否存在漏洞：

```bash
npm audit
# 或使用 pnpm
pnpm audit
```

#### TypeScript 和类型安全

Misuzu 强制执行严格的 TypeScript 检查（`strict: true`）以防止常见安全问题：

- 无隐式 `any` 类型
- 严格的空值检查
- 类型安全的错误处理

#### 密码学

Misuzu 不提供密码学函数。对于密码学操作，使用：

- `node:crypto`（Node.js 内置模块）
- `tweetnacl-js`（经过验证的密码学库）
- `sodium-plus`（libsodium 包装器）

永远不要实现自己的密码学。

### 安全头和环境

#### 环境变量

永远不要提交敏感数据：

```bash
# ✓ 好：使用环境变量
const apiKey = process.env.API_KEY

# ✗ 坏：硬编码机密
const apiKey = 'sk-1234567890'
```

#### 错误处理

不要在错误信息中暴露敏感信息：

```typescript
// ✗ 坏：泄露数据库结构
throw new Error(`Database error: ${error.message}`)

// ✓ 好：通用错误信息
throw new Error("An error occurred while processing your request")
```

### 第三方安全

#### 包更新

我们自动检查安全更新并：

- 快速应用关键安全补丁
- 在发布说明中记录安全修复
- 通知用户破坏性的安全变更

#### 监控

我们监控：

- GitHub 安全公告
- npm 安全公告
- Dependabot 警报
- CVSS 漏洞评分

### 合规性

Misuzu 目标符合：

- [OWASP Top 10](https://owasp.org/www-project-top-ten/) 安全风险
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/) 最弱的软件错误
- [Node.js 安全最佳实践](https://nodejs.org/en/docs/guides/security/)

### 支持

**安全相关问题：**

- 邮件：`security@example.com`
- 不要在公开 issue 中提出安全问题
- 请使用负责任的披露

**安全资源：**

- [OWASP](https://owasp.org/)
- [Node.js 安全](https://nodejs.org/en/docs/guides/security/)
- [npm 安全](https://docs.npmjs.com/packages-and-modules/managing-packages-and-modules/about-npm-security)

### 更新日志和公告

了解过去的安全问题及其修复：

- 检查 [GitHub 安全公告](https://github.com/author/misuzu/security/advisories)
- 审阅 [CHANGELOG.md](./CHANGELOG.md)
- 订阅 [GitHub 安全警报](https://github.blog/changelog/2021-04-13-security-and-analysis-settings-for-repositories-owned-by-organizations/)
