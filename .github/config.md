# GitHub Repository Configuration

This file documents recommended GitHub repository settings for Misuzu.

## Settings to Configure

### General

- **Repository name**: misuzu
- **Description**: A powerful, modern monorepo powered by Vite+ for building scalable TypeScript applications
- **Visibility**: Public
- **Default branch**: main
- **Require status checks to pass**: Yes
- **Require branches to be up to date before merging**: Yes
- **Require code reviews before merging**: Yes (1 review minimum)
- **Dismiss stale pull request approvals when new commits are pushed**: Yes
- **Require status checks from branch protection rules to pass before merging**: Yes
- **Require branches to be up-to-date before merging**: Yes

### Branch Protection Rules

Configure for `main` branch:

```yaml
Branch pattern: main
- Require pull request reviews before merging: Yes (1 required)
- Require status checks to pass before merging: Yes
- Require branches to be up to date: Yes
- Require code reviews from code owners: Yes (if CODEOWNERS file exists)
- Dismiss stale pull request approvals: Yes
- Require conversation resolution before merging: Yes
- Require signed commits: Recommended
- Lock branch: Allow force pushes (No)
```

### Collaborators & Teams

Recommended team structure:

- **Maintainers** - Full access, can merge PRs, manage releases
- **Reviewers** - Can review PRs and suggest changes
- **Contributors** - Regular contributors with write access

### Labels

Recommended GitHub labels:

```yaml
bug:
  color: d73a4a
  description: Something isn't working

enhancement:
  color: a2eeef
  description: New feature or request

documentation:
  color: 0075ca
  description: Improvements or additions to documentation

good first issue:
  color: 7057ff
  description: Good for newcomers

help wanted:
  color: 008672
  description: Extra attention is needed

question:
  color: d876e3
  description: Further information is requested

security:
  color: ef476f
  description: Security related issue

type:dependencies:
  color: 5319e7
  description: Pull requests that update a dependency file

type:ci:
  color: 5319e7
  description: CI/CD configuration changes

type:refactor:
  color: 5319e7
  description: Code refactoring

type:test:
  color: 5319e7
  description: Adding or updating tests

wontfix:
  color: ffffff
  description: This will not be worked on
```

### Automated Features

Enable:

- **Dependabot version updates**: For dependency management
- **Dependabot security updates**: For security patches
- **GitHub Actions**: For CI/CD workflows
- **Branch auto-delete**: Delete head branches after merge

### Discussion Categories

Set up GitHub Discussions:

1. **Announcements** - Important project announcements
2. **General** - General discussions
3. **Ideas** - Feature ideas and suggestions
4. **Polls** - Community polls
5. **Q&A** - Questions and answers
6. **Show and tell** - Share projects and ideas

### Releases

Configure release settings:

- Use GitHub releases for version tags
- Auto-generate release notes from PRs
- Create release drafts before publishing
- Include changelog in release description

### Webhooks & Integration

Recommended integrations:

- **CI/CD**: GitHub Actions (built-in)
- **Package Publishing**: npm (if publishing packages)
- **Security**: Dependabot alerts
- **Code Quality**: Optional code analysis tools

### Issue & PR Templates

Already configured in `.github/`:

- `.github/ISSUE_TEMPLATE/bug_report.md` - Bug reports
- `.github/ISSUE_TEMPLATE/feature_request.md` - Feature requests
- `.github/ISSUE_TEMPLATE/question.md` - Questions
- `.github/PULL_REQUEST_TEMPLATE.md` - PR template

### Code Owners (Optional)

Create `.github/CODEOWNERS` file:

```
# Maintainers
*                     @author/maintainers

# Documentation
*.md                  @author/documentation-team
docs/                 @author/documentation-team

# Core library
packages/misuzu-core/ @author/core-team

# Web application
apps/misuzu-web/      @author/web-team

# CI/CD
.github/workflows/    @author/devops-team
```

### GitHub Actions Workflows

Recommended workflows to create in `.github/workflows/`:

1. **CI/CD Pipeline** (`ci.yml`)
   - Run tests on push and PR
   - Lint and format checks
   - Build verification

2. **Publish** (`publish.yml`)
   - Publish packages to npm on release
   - Build and publish documentation

3. **Dependency Updates** (`dependabot-auto-merge.yml`)
   - Auto-merge Dependabot PRs for patch updates

4. **CodeQL** (`codeql-analysis.yml`)
   - Security code analysis

### Repository Secrets

Store in repository Settings > Secrets:

```
NPM_TOKEN              # For publishing to npm
GITHUB_TOKEN          # (auto-created by GitHub)
```

### Repository Environment Variables

Configure in Settings > Environments > Production:

```
NODE_VERSION          # Target Node version
REGISTRY_URL          # npm registry URL
```

### Status Badge Configuration

For README.md:

```markdown
[![CI/CD](https://github.com/author/misuzu/actions/workflows/ci.yml/badge.svg)](https://github.com/author/misuzu/actions)
[![npm version](https://badge.fury.io/js/misuzu-core.svg)](https://badge.fury.io/js/misuzu-core)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
```

---

## Manual Steps to Configure

1. Go to repository Settings
2. Configure branch protection for `main`
3. Add GitHub labels
4. Set up branch auto-delete
5. Enable Dependabot
6. Configure Discussion categories
7. Add code owners file if needed
8. Configure any additional integrations

## Documentation

- [GitHub Branch Protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Actions](https://docs.github.com/en/actions)
- [GitHub Discussions](https://docs.github.com/en/discussions)
- [Dependabot](https://docs.github.com/en/code-security/dependabot)
