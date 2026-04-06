# mcp-server-sfmc

MCP server providing Salesforce Marketing Cloud language intelligence — AMPscript, SSJS, and GTL — as Model Context Protocol tools, resources, and prompts for AI-assisted development and code review.

Built on [sfmc-language-lsp](https://github.com/JoernBerkefeld/sfmc-language-lsp), the same engine that powers the [SFMC Language Service VS Code extension](https://marketplace.visualstudio.com/items?itemName=joernberkefeld.sfmc-language).

## What it gives your AI assistant

| Feature | Details |
|---|---|
| **Validation** | Syntax errors, unknown functions, arity mismatches, unsupported SSJS syntax |
| **Lookup** | Full function signatures, parameters, return types, and examples from the SFMC catalog |
| **PR review** | Diff-aware review tool that surfaces issues in the exact lines that changed |
| **Fix suggestions** | Concrete, compilable replacement code for each detected issue |
| **Completions** | AMPscript function/keyword completions, SSJS Platform API catalog |
| **Prompts** | Guided prompts for writing AMPscript, SSJS, reviewing code, and converting between the two |
| **Resources** | Full function catalogs, keyword list, unsupported ES6+ syntax list |

## Quick start

### VS Code (1.99+) + GitHub Copilot

Add a `.vscode/mcp.json` file to your project (or copy it from this repo):

```json
{
  "servers": {
    "sfmc": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-server-sfmc@latest"]
    }
  }
}
```

Open the file in VS Code — a **Start** button appears at the top. Click it to launch the server. Open GitHub Copilot Chat in **Agent mode** and the SFMC tools appear automatically.

### Cursor

Add to your Cursor settings (`~/.cursor/mcp.json` or project-level `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "sfmc": {
      "command": "npx",
      "args": ["-y", "mcp-server-sfmc@latest"]
    }
  }
}
```

Restart Cursor. The tools are available in Agent mode.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "sfmc": {
      "command": "npx",
      "args": ["-y", "mcp-server-sfmc@latest"]
    }
  }
}
```

Restart Claude Desktop.

### Windsurf

Add to your Windsurf MCP settings (`~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "sfmc": {
      "command": "npx",
      "args": ["-y", "mcp-server-sfmc@latest"]
    }
  }
}
```

### Local install (faster startup than npx)

```bash
npm install -g mcp-server-sfmc
```

Then replace `"command": "npx", "args": ["-y", "mcp-server-sfmc@latest"]` with:

```json
"command": "mcp-server-sfmc",
"args": []
```

## Tools

| Tool | Description |
|---|---|
| `validate_ampscript` | Validate AMPscript code — unknown functions, arity, delimiter balance, comment syntax |
| `validate_ssjs` | Validate SSJS — ES6+ usage, missing Platform.Load, wrong API calls |
| `validate_sfmc_html` | Validate HTML with embedded AMPscript, SSJS, and GTL blocks |
| `lookup_ampscript_function` | Full signature, parameters, and example for any AMPscript function |
| `lookup_ssjs_function` | Full signature and description for any SSJS Platform function or method |
| `review_change` | Review a unified diff — validates only added lines, maps back to diff line numbers |
| `suggest_fix` | Generate fix suggestions for each diagnostic in a code snippet |
| `get_ampscript_completions` | List valid completions at a given cursor position in AMPscript |
| `get_ssjs_completions` | List SSJS Platform API completions, optionally filtered by prefix |
| `format_sfmc_code` | Apply basic formatting conventions (keyword casing, quote normalisation) |

## Resources

| URI | Description |
|---|---|
| `sfmc://ampscript/functions` | Full AMPscript function catalog with signatures |
| `sfmc://ssjs/functions` | Full SSJS function catalog |
| `sfmc://ampscript/keywords` | All AMPscript keywords |
| `sfmc://ssjs/unsupported-syntax` | ES6+ features not supported in SFMC SSJS |

## Prompts

Access via `/mcp.sfmc.writeAmpscript` etc. in VS Code, or via the prompts API:

| Prompt | Description |
|---|---|
| `writeAmpscript` | Generate AMPscript code for a described task |
| `writeSsjs` | Generate SSJS code for a described task |
| `reviewSfmcCode` | Review AMPscript or SSJS code for bugs and best-practice violations |
| `convertAmpscriptToSsjs` | Convert AMPscript code to equivalent SSJS |

## AI code review in pull requests

### GitHub Copilot (cloud agent)

The `.github/agents/sfmc-reviewer.agent.md` custom agent in this repository configures a GitHub Copilot cloud agent that uses `mcp-server-sfmc` for SFMC-aware PR reviews.

To enable it in your own repository:
1. Copy `.github/agents/sfmc-reviewer.agent.md` to your repo.
2. In your GitHub repo settings → **Copilot → Cloud agent → MCP configuration**, add:

```json
{
  "mcpServers": {
    "sfmc": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-server-sfmc@latest"],
      "tools": ["*"]
    }
  }
}
```

3. Assign the `sfmc-reviewer` agent to a pull request by mentioning it in a comment or via the **@sfmc-reviewer** agent in GitHub Copilot Chat.

### GitHub Copilot (dedicated PR review)

Copy `.github/copilot-instructions.md` from this repo to your project. GitHub Copilot's dedicated PR review feature reads this file and applies the SFMC language rules when summarising your PRs.

### GitLab Duo

1. Copy the content of `ci-templates/gitlab-duo-review-instructions.md` to `.gitlab/duo-instructions.md` in your repository.
2. GitLab Duo Code Review will apply these instructions on every merge request.

> GitLab Duo's dedicated MR review does not support MCP directly. Use the CI lint job below for automated static analysis, and the Duo instructions for AI-assisted review comments.

### CI linting (deterministic checks)

For deterministic, blocking CI validation, use the **eslint-plugin-sfmc** templates provided in `ci-templates/`:

| Platform | File |
|---|---|
| GitHub Actions | [`github-actions.yml`](.github/workflows/sfmc-lint.yml) |
| GitLab CI | [`ci-templates/gitlab-ci.yml`](ci-templates/gitlab-ci.yml) |
| Jenkins | [`ci-templates/Jenkinsfile`](ci-templates/Jenkinsfile) |
| Azure DevOps | [`ci-templates/azure-pipelines.yml`](ci-templates/azure-pipelines.yml) |
| Bitbucket Pipelines | [`ci-templates/bitbucket-pipelines.yml`](ci-templates/bitbucket-pipelines.yml) |

These templates run `eslint-plugin-sfmc` on changed files and post lint results as PR/MR comments.

### ESLint + @eslint/mcp

For AI assistants that don't support MCP but do support tool-calling, you can combine `eslint-plugin-sfmc` with the official `@eslint/mcp` server. Add it alongside `mcp-server-sfmc`:

```json
{
  "servers": {
    "sfmc": {
      "command": "npx",
      "args": ["-y", "mcp-server-sfmc@latest"]
    },
    "eslint": {
      "command": "npx",
      "args": ["-y", "@eslint/mcp@latest"]
    }
  }
}
```

Create an `eslint.config.mjs` in your project root:

```js
import sfmc from 'eslint-plugin-sfmc';
export default [...sfmc.configs.recommended];
```

The `@eslint/mcp` server exposes an `eslint_lint` tool that your AI can call to run the full ESLint rule set (including all AMPscript and SSJS rules from `eslint-plugin-sfmc`) on any file.

## Architecture

```
mcp-server-sfmc
    └── sfmc-language-lsp   (language intelligence core)
            ├── ampscript-data  (AMPscript function catalog)
            └── ssjs-data       (SSJS function catalog)

vscode-sfmc-language (VS Code extension)
    └── sfmc-language-lsp   (same core, bundled via esbuild)
```

Both the VS Code extension and the MCP server share exactly the same validation, completion, hover, and lookup logic through `sfmc-language-lsp`. This means the AI assistant sees the same errors and suggestions that the editor shows.

## Contributing

See [CONTRIBUTING.md](https://github.com/JoernBerkefeld/mcp-server-sfmc/blob/main/CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
