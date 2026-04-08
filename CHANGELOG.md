# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial monorepo structure with Vite+ toolchain
- `misuzu-core` TypeScript library for core functionality
- `misuzu-web` Vue 3 web application with Hono backend
- Comprehensive documentation suite:
  - README.md with bilingual support (English/Chinese)
  - CONTRIBUTING.md with contribution guidelines
  - SECURITY.md with security policy
  - CODE_OF_CONDUCT.md with community guidelines
  - AGENTS.md with AI agent guidelines
  - GitHub issue templates (bug reports, feature requests, questions)
  - GitHub PR template with comprehensive checklist
  - Package-specific README files

### Infrastructure

- GitHub configuration files and templates
- Comprehensive test coverage framework
- CI/CD ready build system
- Type-safe development environment with TypeScript
- Code quality tools (formatting, linting, type checking)

## Guidelines for Future Releases

### Format

```markdown
## [Version] - YYYY-MM-DD

### Added

- New features

### Changed

- Changes to existing functionality

### Deprecated

- Features that will be removed in a future version

### Removed

- Removed features

### Fixed

- Bug fixes

### Security

- Security issue fixes and updates
```

### Semantic Versioning

- **MAJOR**: Incompatible API changes (e.g., 1.0.0 → 2.0.0)
- **MINOR**: New backwards-compatible functionality (e.g., 1.0.0 → 1.1.0)
- **PATCH**: Backwards-compatible bug fixes (e.g., 1.0.0 → 1.0.1)

### Release Process

1. Create a new version section with the date
2. Document all changes in appropriate categories
3. Update version numbers in:
   - `package.json` (root and packages)
   - Package-specific documentation
4. Tag the release in git: `git tag v0.1.0`
5. Push tags to repository: `git push origin --tags`

### Examples of Changes to Document

**Added:**

- New features, APIs, or modules
- New dependencies (with reason)
- New documentation or guides

**Changed:**

- API improvements or modifications
- Default behavior changes
- Dependency version updates
- Performance improvements

**Deprecated:**

- Features to be removed (with migration path)
- Outdated patterns or APIs

**Removed:**

- Deleted features or dependencies
- Removed APIs (always provide migration path)

**Fixed:**

- Bug fixes with description
- Typos and documentation corrections

**Security:**

- Security vulnerabilities fixed
- Updated security guidelines
- Dependency security patches

---

## How to Contribute Changes to This File

1. Before your PR is merged, add an entry to the "Unreleased" section
2. Use the format above
3. Reference GitHub issues when applicable (e.g., "Fixes #123")
4. Keep entries organized and user-facing
5. Include migration paths for breaking changes

## Past Versions

This project uses semantic versioning. Visit the [releases page](https://github.com/author/misuzu/releases) for detailed information about each version.
