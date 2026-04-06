# invoice-platform

## Commit Convention

This project enforces [Conventional Commits](https://www.conventionalcommits.org/) via a local `commit-msg` git hook. Every commit message must start with a valid type prefix:

```
<type>[optional scope]: <description>
```

### Allowed types

| Type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, semicolons, etc. (no code change) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `build` | Build system or external dependencies |
| `ci` | CI/CD configuration |
| `chore` | Maintenance tasks |
| `revert` | Reverts a previous commit |

### Examples

```
feat: add invoice PDF export
fix(api): handle null client response
docs: update README
refactor(auth): simplify token validation
test: add payment integration tests
build: upgrade typescript to v5.5
```

### Setup

The hook lives at `.git/hooks/commit-msg`. Since git hooks are not tracked by git, each contributor must set it up locally:

```bash
cp .githooks/commit-msg .git/hooks/commit-msg
chmod +x .git/hooks/commit-msg
```
