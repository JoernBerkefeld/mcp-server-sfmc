# CI templates for SFMC projects

Copy these files into your own repository and adjust branch names, Node version, or path filters as needed.

## Two complementary checks

| Mechanism | What it does |
|-----------|----------------|
| **ESLint** (`eslint-plugin-sfmc`) | Lints **changed files** matching `*.amp`, `*.ssjs`, `*.html` (and embedded rules for HTML). File-level rules (unknown functions, arity, ES6 in SSJS, etc.). |
| **`sfmc-review-diff`** (this package, CLI) | Pipes a **unified `git diff`** into the MCP tool `review_change`, which validates **only added lines** using the same language catalog as the MCP server. Fails the job on `ERROR` diagnostics by default (`--fail-on` can include warnings or infos). |

You can keep **both** jobs in CI, or drop one if you only want file-based linting or only diff-based review.

**Git history:** shallow clones often lack the merge base. Prefer `fetch-depth: 0` (GitHub Actions), `GIT_DEPTH: "0"` (GitLab merge request pipelines), or enough depth that your diff command’s base ref/SHA exists.

## Files in this folder

| File | Platform | ESLint | `sfmc-review-diff` |
|------|----------|--------|----------------------|
| [github-action.yml](./github-action.yml) | GitHub Actions | yes | yes |
| [gitlab-ci.yml](./gitlab-ci.yml) | GitLab CI | yes | yes |
| [Jenkinsfile](./Jenkinsfile) | Jenkins | yes | yes |
| [azure-pipelines.yml](./azure-pipelines.yml) | Azure Pipelines | yes | yes |
| [bitbucket-pipelines.yml](./bitbucket-pipelines.yml) | Bitbucket Pipelines | yes | yes |
| [eslint.config.mjs](./eslint.config.mjs) | (reference) | shared flat config | — |

## AI review instructions (not CI)

These files guide **GitLab Duo** / **GitHub Copilot** style review text; they do **not** run `sfmc-review-diff`:

- [gitlab-duo-review-instructions.md](./gitlab-duo-review-instructions.md) — place content in `.gitlab/duo/mr-review-instructions.yaml` per GitLab docs (YAML format), not as a raw paste of this file.
- [github-copilot-review-instructions.md](./github-copilot-review-instructions.md) — Copilot / agent instructions; MCP blocks belong in client config, not in Actions YAML.

## Installing the CLI in CI

Templates use `npm install --no-save mcp-server-sfmc@latest` so the `sfmc-review-diff` binary is available. Pin a semver range in your project if you need reproducible builds.
