# mcp-server-sfmc

MCP server providing Salesforce Marketing Cloud language intelligence — AMPscript, SSJS, GTL, and **Marketing Cloud Next (MCN) Handlebars** — as Model Context Protocol tools, resources, and prompts for AI-assisted development and code review. Ships two searchable doc indexes: **MCE help** (Salesforce Help for Marketing Cloud Engagement administration and setup) and **MCN developer docs** (Marketing Cloud Next REST API and developer reference). Includes full **Marketing Cloud Next (MCN) platform awareness**: auto-detects whether a project targets MCE or MCN, restricts completions and validation to MCN-supported functions, flags SSJS as unsupported in MCN, surfaces MCN behavioral differences in hover and diagnostics, validates MCN Handlebars templates, and provides a **migration toolkit** to analyze and rewrite code for MCN — including AMPscript ↔ Handlebars and SSJS → Handlebars conversion.

Built on [sfmc-language-lsp](https://github.com/JoernBerkefeld/sfmc-language-lsp), the same engine that powers the [SFMC Language Service VS Code extension](https://marketplace.visualstudio.com/items?itemName=joernberkefeld.sfmc-language).

## VS Code MCP Server Gallery (`@mcp`)

This package is registered with the [official MCP Registry](https://registry.modelcontextprotocol.io) as **`io.github.JoernBerkefeld/mcp-server-sfmc`** so it can appear in Visual Studio Code when you use the **`@mcp`** filter in the Extensions view (see the [publish quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)). Enable **`chat.mcp.gallery.enabled`** if the gallery does not show.

The registry only stores **metadata**; the server still runs **locally** via stdio (for example `npx -y mcp-server-sfmc@latest`). This is separate from **`@contribute:mcp`**, which lists VS Code extensions that contribute MCP definitions — use the [SFMC Language Service](https://marketplace.visualstudio.com/items?itemName=joernberkefeld.sfmc-language) for that path.

After publishing metadata (see [Publish an MCP Server](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx) or the release workflow), you can confirm the entry with:

`curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.JoernBerkefeld/mcp-server-sfmc"`

## VS Code without manual MCP config

If you use the **SFMC Language Service** extension (**1.101+**), it registers this MCP server for discovery in VS Code — you normally do **not** need to edit `.vscode/mcp.json` or run `npm install` for that path; VS Code still launches the published package via `npx` when the server starts.

For **other editors**, or if you prefer explicit configuration, use the `npx` or install options below.

## Using this package without the VS Code extension

You **do not** have to install the VS Code extension. Pick one way to run the server:

| Approach                                       | When to use it                                                                                                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`npx` (no install)**                         | Default in the examples below. Runs the latest published version from npm on demand; first run may download the package. **Requires Node.js and npm** (which provides `npx`).                                                |
| **`npm install -g mcp-server-sfmc`**           | Same CLI as `npx`, but the package stays on disk so **startup is faster** and you can set `"command": "mcp-server-sfmc"` with empty `args` in your MCP config.                                                               |
| **`npm install mcp-server-sfmc` in a project** | Keeps a **pinned version** in that folder's `node_modules` — point your MCP config at `npx mcp-server-sfmc` with `cwd` set to the project, or run `./node_modules/.bin/mcp-server-sfmc` directly.                            |
| **`sfmc-review-diff` (bundled CLI)**           | For **CI**: spawns this MCP server, calls `review_change` on a unified diff (stdin or file), exits non-zero on `ERROR` by default. Install the package in the job, then e.g. `git diff base...HEAD \| npx sfmc-review-diff`. |

None of these replace the VS Code extension for **editing** (syntax, LSP, snippets); they only expose the **MCP server** to tools that speak the Model Context Protocol.

## CI templates and `sfmc-review-diff`

Ready-to-copy workflows (GitHub Actions, GitLab CI, Jenkins, Azure Pipelines, Bitbucket Pipelines) live under **[`ci-templates/`](./ci-templates/)**. They run **`eslint-plugin-sfmc`** on changed files and **`sfmc-review-diff`** on the PR/MR unified diff. See **[`ci-templates/README.md`](./ci-templates/README.md)** for what each file does and how the two checks differ.

## What it gives your AI assistant

| Feature                        | Details                                                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Validation**                 | Syntax errors, unknown functions, arity mismatches, unsupported SSJS syntax; `target: 'next'` flags MCN-incompatible functions and all SSJS; `validate_handlebars` checks MCN Handlebars helper names, arity, block balance, and unsupported constructs |
| **Lookup**                     | Full function signatures, parameters, return types, MCN compatibility badge (API version), behavioral notes, and examples                                                                      |
| **PR review**                  | Diff-aware review tool that surfaces issues in the exact lines that changed                                                                                                                    |
| **Fix suggestions**            | Concrete, compilable replacement code; `target: 'next'` includes MCN platform issues                                                                                                           |
| **Completions**                | AMPscript completions (filtered to MCN-supported when `target: 'next'`); SSJS catalog (redirects to AMPscript for MCN)                                                                         |
| **Platform detection**         | `detect_sfmc_platform` checks `.mcdevrc.json` (MCE) or `sfdx-project.json` (MCN) in the project root                                                                                           |
| **MCN compatibility analysis** | `check_mcn_compatibility` analyzes files for MCN readiness — per-function classification (supported / needs review / not supported), SSJS block migration difficulty, and an executive summary |
| **MCN migration**              | `rewrite_for_mcn` (tool + prompt) deterministically rewrites AMPscript and converts convertible SSJS to AMPscript for MCN, then applies AI reasoning to remaining manual-rewrite sections      |
| **Code conversion**            | `convertSsjsToAmpscript` and `convertAmpscriptToSsjs` (tool + prompt hybrid) — rule-based conversion with AI-enhanced handling of flagged sections                                             |
| **MCN Handlebars**             | `lookup_handlebars_helper`, `list_handlebars_helpers`, `get_handlebars_completions`, and `write_handlebars` (authoring) backed by the `handlebars-data` catalog                                |
| **Handlebars conversion**      | `convertAmpscriptToHandlebars`, `convertHandlebarsToAmpscript`, and `convertSsjsToHandlebars` (tool + prompt hybrid) — data-driven from `ampscript-data` `handlebarsEquivalent` / `mcnHandlebarsGap` |
| **Prompts**                    | Guided prompts for writing AMPscript/SSJS/Handlebars (with MCN constraints), reviewing code, converting between languages, and rewriting for MCN                                               |
| **Resources**                  | Full function catalogs, keyword list, unsupported ES6+ syntax list, MCN Handlebars helper and binding catalogs                                                                                 |
| **Help search**                | `search_help` (unified, auto-detects MCE vs MCN from project root); `search_mce_help` (MCE help, 7 product scopes); `search_mcn_help` (MCN developer API reference)                            |

## Connecting AI clients

### VS Code (1.99+) + GitHub Copilot — manual `mcp.json`

If you are **not** using the SFMC Language Service extension's built-in MCP registration, add a `.vscode/mcp.json` file to your project (or copy it from this repo):

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

| Tool                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate_ampscript`        | Validate AMPscript code — unknown functions, arity, delimiter balance, comment syntax. `target: 'next'` flags MCN-incompatible functions.                                                                                                                                                                                                                                                                                                   |
| `validate_ssjs`             | Validate SSJS — ES6+ usage, missing Platform.Load, wrong API calls. `target: 'next'` flags all SSJS as unsupported.                                                                                                                                                                                                                                                                                                                         |
| `validate_sfmc_html`        | Validate HTML with embedded AMPscript, SSJS, and GTL blocks. `target: 'next'` enables MCN validation.                                                                                                                                                                                                                                                                                                                                       |
| `lookup_ampscript_function` | Full signature, parameters, return type, MCN compatibility badge (API version), behavioral notes for MCN, and examples                                                                                                                                                                                                                                                                                                                      |
| `lookup_ssjs_function`      | Full signature and description for any SSJS Platform function or method                                                                                                                                                                                                                                                                                                                                                                     |
| `list_ampscript_functions`  | List all AMPscript functions, optionally filtered by `platform: 'next'` to return only MCN-supported functions                                                                                                                                                                                                                                                                                                                              |
| `review_change`             | Review a unified diff — validates only added lines, maps back to diff line numbers                                                                                                                                                                                                                                                                                                                                                          |
| `suggest_fix`               | Generate fix suggestions for each diagnostic in a code snippet. `target: 'next'` includes MCN fixes.                                                                                                                                                                                                                                                                                                                                        |
| `get_ampscript_completions` | List valid completions at a given cursor position; MCN-unsupported functions marked `[MCE only]` when `target: 'next'`                                                                                                                                                                                                                                                                                                                      |
| `get_ssjs_completions`      | List SSJS Platform API completions, optionally filtered by prefix; redirects to AMPscript completions when `target: 'next'`                                                                                                                                                                                                                                                                                                                 |
| `format_sfmc_code`          | Apply basic formatting conventions (keyword casing, quote normalisation)                                                                                                                                                                                                                                                                                                                                                                    |
| `detect_sfmc_platform`      | Detect the target platform for a project — checks `.mcdevrc.json` (→ `"engagement"`) or `sfdx-project.json` (→ `"next"`)                                                                                                                                                                                                                                                                                                                    |
| `check_mcn_compatibility`   | Analyze one or more AMPscript/HTML files for MCN readiness. Returns per-function classification, SSJS block migration difficulty, and an executive summary with overall migration effort. Run this before `rewrite_for_mcn`.                                                                                                                                                                                                                |
| `rewrite_for_mcn`           | Deterministic MCN rewrite engine: fixes `.NET → Java` format strings, removes `StringToDate` wrappers, converts convertible SSJS to AMPscript, marks unsupported functions, annotates the rest as `MANUAL_REWRITE_REQUIRED`. **Prefer the `rewrite_for_mcn` prompt** for interactive use — it calls this tool first, then applies AI reasoning to the flagged sections. Use the tool directly only for structured JSON output in pipelines. |
| `convertSsjsToAmpscript`    | Rule-based SSJS → AMPscript conversion engine: `Platform.Function.*` → AMPscript equivalents, variable/request access, control flow. Flags JS-native constructs as `MANUAL_REWRITE_REQUIRED`. **Prefer the `convertSsjsToAmpscript` prompt** for interactive use.                                                                                                                                                                           |
| `convertAmpscriptToSsjs`    | Rule-based AMPscript → SSJS conversion engine: variables, control flow, function calls. Flags AMPscript-only constructs as `MANUAL_REWRITE_REQUIRED`. **Prefer the `convertAmpscriptToSsjs` prompt** for interactive use.                                                                                                                                                                                                                   |
| `validate_handlebars`        | Validate MCN Handlebars template code — helper names, arity, block balance, and unsupported constructs (partials, decorators, built-in helpers absent from the locked-down MCN engine).                                                                                                                                                                                                                                                     |
| `lookup_handlebars_helper`   | Signature, parameters, description, origin, and MCN API version for a single MCN Handlebars helper (case-insensitive).                                                                                                                                                                                                                                                                                                                      |
| `list_handlebars_helpers`    | List all MCN Handlebars helpers, optionally filtered by `category` and/or `origin` (`handlebars-builtin`, `mcn-helper`, `mcn-platform`).                                                                                                                                                                                                                                                                                                    |
| `get_handlebars_completions` | List MCN Handlebars helper completions, optionally filtered by prefix.                                                                                                                                                                                                                                                                                                                                                                      |
| `convertAmpscriptToHandlebars` | Rule-based AMPscript → MCN Handlebars conversion. Maps functions to helpers where an equivalent exists; flags unsupported functions and runtime gaps as `MANUAL_REWRITE_REQUIRED`. **Prefer the `convertAmpscriptToHandlebars` prompt** for interactive use.                                                                                                                                                                              |
| `convertHandlebarsToAmpscript` | Rule-based MCN Handlebars → AMPscript conversion. Maps helpers and bindings back to AMPscript; flags block helpers as `MANUAL_REWRITE_REQUIRED`. **Prefer the `convertHandlebarsToAmpscript` prompt** for interactive use.                                                                                                                                                                                                               |
| `convertSsjsToHandlebars`    | Transitive SSJS → AMPscript → MCN Handlebars conversion. Conservatively flags imperative SSJS for manual rewrite. **Prefer the `convertSsjsToHandlebars` prompt** for interactive use.                                                                                                                                                                                                                                                      |
| `write_handlebars`           | Validate an MCN Handlebars-in-HTML draft against the helper catalog. **Prefer the `writeHandlebars` prompt** for authoring.                                                                                                                                                                                                                                                                                                                 |
| `search_help`               | **Unified help search** — auto-detects the platform from `projectRoot` and routes to the right doc index. MCN projects search both the developer API reference and MCN admin docs. Pass `target` to override detection.                                                                                                                                                                                                                     |
| `search_mce_help`           | Search bundled Marketing Cloud Engagement setup/ops help; use `product_focus` to target Engagement vs Next                                                                                                                                                                                                                                                                                                                                  |
| `search_mcn_help`           | Search bundled Marketing Cloud Next developer API documentation (objects, flows, segments, REST/SOAP APIs, AMPscript behavior in MCN)                                                                                                                                                                                                                                                                                                       |

## Resources

| URI                              | Description                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `sfmc://ampscript/functions`     | Full AMPscript function catalog with signatures                                              |
| `sfmc://ssjs/functions`          | Full SSJS function catalog                                                                   |
| `sfmc://ampscript/keywords`      | All AMPscript keywords                                                                       |
| `sfmc://ssjs/unsupported-syntax` | ES6+ features not supported in SFMC SSJS                                                     |
| `sfmc://handlebars/helpers`      | Full MCN Handlebars helper catalog with signatures, origin, and MCN API version              |
| `sfmc://handlebars/bindings`     | MCN Handlebars data bindings (context variables available in templates)                      |
| `sfmc://mce/product-context`     | How **Marketing Cloud Engagement** differs from **Marketing Cloud Next** (when to use which) |
| `sfmc://mce/help-index`          | List of bundled MCE help files and section counts per product scope                          |
| `sfmc://mcn/help-index`          | List of bundled MCN developer API doc files and chunk counts                                 |

## Prompts

Access via `/mcp.sfmc.writeAmpscript` etc. in VS Code, or via the prompts API:

| Prompt                   | Description                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `writeAmpscript`         | Generate AMPscript code for a described task. `target: 'next'` enforces MCN constraints (MCN-supported functions only, Java `SimpleDateFormat` patterns, no SSJS).                                                                                                                                                                    |
| `writeSsjs`              | Generate SSJS code for a described task. `target: 'next'` redirects to AMPscript instead (SSJS is not available in MCN).                                                                                                                                                                                                              |
| `reviewSfmcCode`         | Review AMPscript or SSJS code for bugs and best-practice violations. `target: 'next'` adds MCN compatibility checklist.                                                                                                                                                                                                               |
| `rewrite_for_mcn`        | **Primary interface for MCN migration.** Internally calls the `rewrite_for_mcn` tool for all deterministic rewrites, then applies AI reasoning to every `MANUAL_REWRITE_REQUIRED` section — producing a single fully migrated code block with a prose changelog. You always get both the rule-based pass and the AI pass in one step. |
| `convertSsjsToAmpscript` | **Primary interface for SSJS → AMPscript conversion.** Internally calls the `convertSsjsToAmpscript` tool for rule-based conversion, then AI-reasons over any sections the rules could not handle.                                                                                                                                    |
| `convertAmpscriptToSsjs` | **Primary interface for AMPscript → SSJS conversion.** Internally calls the `convertAmpscriptToSsjs` tool for rule-based conversion, then applies AI reasoning to flagged AMPscript-only constructs.                                                                                                                                  |
| `writeHandlebars`        | Generate MCN Handlebars-in-HTML for a described task, constrained to the locked-down MCN helper catalog. Validates the draft against `handlebars-data` and reports unsupported constructs.                                                                                                                                            |
| `convertAmpscriptToHandlebars` | **Primary interface for AMPscript → MCN Handlebars conversion.** Internally calls the `convertAmpscriptToHandlebars` tool for rule-based conversion, then AI-reasons over functions with no Handlebars equivalent (runtime gaps and unsupported functions).                                                                     |
| `convertHandlebarsToAmpscript` | **Primary interface for MCN Handlebars → AMPscript conversion.** Internally calls the `convertHandlebarsToAmpscript` tool for rule-based conversion, then AI-reasons over block helpers and constructs the rules could not handle.                                                                                              |
| `convertSsjsToHandlebars`      | **Primary interface for SSJS → MCN Handlebars conversion.** Transitive (SSJS → AMPscript → Handlebars); calls the `convertSsjsToHandlebars` tool, then applies AI reasoning to imperative SSJS flagged for manual rewrite.                                                                                                       |
| `answerMceHowTo`         | Guided prompt for admin/setup questions — searches bundled help and keeps Engagement vs Next explicit                                                                                                                                                                                                                                 |

## Migrating code to Marketing Cloud Next

Marketing Cloud Next (MCN) supports **41 of the 150 AMPscript functions** and **does not support SSJS**. Three supported functions have behavioral differences (see below). The migration toolkit guides you from analysis through to a fully rewritten result.

### Recommended workflow

```
1. detect_sfmc_platform  →  confirm the project targets MCN
2. check_mcn_compatibility  →  understand scope: which files need work, how hard
3. rewrite_for_mcn prompt  →  calls the rewrite_for_mcn tool internally, then applies AI
                               reasoning to any MANUAL_REWRITE_REQUIRED sections
4. validate_ampscript with target:'next'  →  verify the rewritten code is clean
```

### What `check_mcn_compatibility` tells you

Pass one or more `{ filename, content }` pairs and get back:

- **Per-function classification** for every AMPscript call site:
  - ✅ Supported — works as-is
  - ⚠️ Needs review — supported but has behavioral differences in MCN
  - ❌ Not supported — no MCN equivalent
- **SSJS block analysis** — classified as "needs conversion" (has AMPscript equivalents) or "not migratable" (uses JS-native constructs such as `try/catch`, `forEach`, regex)
- **Migration difficulty per file** — Ready / Minor changes needed / Significant rewrite / Not migratable
- **Executive summary** across all files

### What `rewrite_for_mcn` does

**Use the `rewrite_for_mcn` prompt** — it is the primary interface and gives you the full result in one step. It first calls the `rewrite_for_mcn` tool internally for all deterministic rewrites, then applies AI reasoning to every section the tool could not handle mechanically. You get both the accuracy of rule-based conversion and the intelligence of an AI pass, without having to invoke them separately.

**Deterministic rewrites (handled by the tool internally):**

- Removes `StringToDate()` wrappers from `FormatDate()` calls (`FormatDate(StringToDate(@x), fmt)` → `FormatDate(@x, fmt)`)
- Converts `.NET → Java SimpleDateFormat` format strings (e.g. `tt` → `a`)
- Annotates `Lookup()` calls with an odd number of search arguments
- Marks MCE-only AMPscript functions with `%%-- NOT SUPPORTED IN MCN %%`
- Converts convertible SSJS blocks to AMPscript (`Platform.Function.*` → AMPscript equivalents, `Platform.Variable.GetValue/SetValue` → `@variable` references)
- Flags JS-native SSJS constructs (`try/catch`, array methods, regex, complex logic) as `MANUAL_REWRITE_REQUIRED`

**AI reasoning layer (added by the prompt):** for each `MANUAL_REWRITE_REQUIRED` section, the prompt instructs the AI to attempt a full conversion using its knowledge of AMPscript and SSJS, then produces a single final rewritten code block with a prose changelog covering every change.

> **Pipelines and programmatic use:** call the `rewrite_for_mcn` **tool** directly when you need the structured JSON output (`{ rewrittenCode, changes[], nonMigratableItems[], difficulty, summary }`) without the AI layer — for example in a CI step that feeds results to another tool.

The same hybrid pattern applies to `convertSsjsToAmpscript` and `convertAmpscriptToSsjs`: always use the **prompt** for interactive use; use the **tool** when you need structured output in a pipeline.

### MCN behavioral differences to watch for

| Function       | Difference                                                                                                                                                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FormatDate`   | Uses **Java `SimpleDateFormat`** patterns in MCN instead of .NET. Example: `.NET "M/d/yyyy h:mm:ss tt"` → Java `"M/d/yyyy h:mm:ss a"`                                                                                                                 |
| `Lookup`       | Search arguments must come in column/value pairs — an **odd argument count causes an error** in MCN. All filter keys must fully specify the composite primary key.                                                                                    |
| `StringToDate` | Returns a **locale-formatted string** in MCN (G standard format, e.g. `"5/15/2026 1:23:45 PM"`) instead of a dateTime object. Cannot be reliably passed to `FormatDate()` in MCN — use `FormatDate()` directly with the original date string instead. |

### CloudPages functions — not migratable

Functions that depend on CloudPages context (`CloudPagesURL`, `RequestParameter`, `QueryParameter`, `Redirect`, `MicrositeURL`) have no equivalent in Marketing Cloud Next. `check_mcn_compatibility` and `rewrite_for_mcn` flag these as **Not migratable** immediately.

## MCN Handlebars

Marketing Cloud Next embeds a **locked-down Handlebars** templating layer (Handlebars.Net) alongside AMPscript. The server exposes the full helper catalog and conversion tooling, all data-driven from [`handlebars-data`](https://www.npmjs.com/package/handlebars-data) and the `handlebarsEquivalent` / `mcnHandlebarsGap` fields in [`ampscript-data`](https://www.npmjs.com/package/ampscript-data) — nothing is hand-maintained.

### Authoring & lookup

```
1. list_handlebars_helpers       →  browse the catalog (filter by category / origin)
2. lookup_handlebars_helper      →  signature, parameters, origin, MCN API version
3. get_handlebars_completions    →  prefix-filtered completions
4. writeHandlebars prompt        →  generate Handlebars-in-HTML, validated against the catalog
5. validate_handlebars           →  helper names, arity, block balance, unsupported constructs
```

`validate_handlebars` rejects constructs the MCN engine does not implement — partials (`{{> name}}`), decorators (`{{#* ...}}`), and built-in helpers absent from the locked-down runtime.

### Conversion categories

AMPscript → Handlebars conversion classifies every function from `ampscript-data`:

| Category | Condition (in `ampscript-data`)                       | Output                                                            |
| -------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| **A**    | `handlebarsEquivalent` is a helper name               | Mapped to the canonical MCN Handlebars helper                     |
| **B**    | No Handlebars counterpart                             | `{{!-- MANUAL_REWRITE_REQUIRED: … no Handlebars equivalent --}}`  |
| **C**    | `mcnHandlebarsGap: true` (MCN-supported, no helper yet) | `{{!-- MANUAL_REWRITE_REQUIRED: … (runtime gap) --}}` (distinct note) |

The Category C note is intentionally distinct from Category B so consumers can tell a *runtime gap* (function works in MCN AMPscript but has no Handlebars helper) apart from a function with no MCN counterpart at all. `convertSsjsToHandlebars` is transitive (SSJS → AMPscript → Handlebars) and conservatively flags imperative SSJS for manual rewrite.

## Writing effective prompts

### Automatic tool use

Clients that honour the MCP `instructions` field (Cursor, Claude Desktop, GitHub Copilot Agent mode) will call `search_help` or `search_mce_help` automatically whenever you ask an MCE administration or setup question — no special phrasing needed. If your client does not process server instructions, or if you want explicit control, the templates below help.

### Quick reference: which tool or prompt to use

| Situation                                    | What to do                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCE admin question (classic Engagement)      | Ask naturally; the server calls `search_help` (or `search_mce_help` directly). Or use the `answerMceHowTo` prompt with `assumeProduct: engagement`.                                                                                        |
| Marketing Cloud Next developer API question  | The server calls `search_help` or `search_mcn_help` automatically. Or use `search_mcn_help` explicitly.                                                                                                                                    |
| MCN operational / migration / setup question | Use `search_mce_help` with `product_focus: 'next'`, or ask naturally and the server routes it.                                                                                                                                             |
| Not sure which product                       | Use `answerMceHowTo` with `assumeProduct: unsure`, or `search_help` without a `target`.                                                                                                                                                    |
| Write or validate AMPscript                  | Use the `writeAmpscript` prompt, or ask directly (the server auto-validates). Add `target: 'next'` for MCN.                                                                                                                                |
| Write or validate SSJS                       | Use the `writeSsjs` prompt, or ask directly. Note: SSJS is not supported in MCN.                                                                                                                                                           |
| Check if code is MCN-ready                   | Use `check_mcn_compatibility` with your file contents.                                                                                                                                                                                     |
| Migrate code to Marketing Cloud Next         | Use the `rewrite_for_mcn` **prompt** — it calls the tool internally for deterministic rewrites, then applies AI reasoning to any remaining manual sections. Use the tool directly only when you need structured JSON output in a pipeline. |
| Convert SSJS ↔ AMPscript                     | Use the `convertSsjsToAmpscript` or `convertAmpscriptToSsjs` **prompt** — same hybrid pattern: tool runs first, AI handles what the rules couldn't.                                                                                        |
| Write or validate MCN Handlebars             | Use the `writeHandlebars` prompt to author, or `validate_handlebars` to check existing template code. Look helpers up with `lookup_handlebars_helper` / `list_handlebars_helpers`.                                                          |
| Convert AMPscript ↔ Handlebars (or SSJS → Handlebars) | Use the `convertAmpscriptToHandlebars`, `convertHandlebarsToAmpscript`, or `convertSsjsToHandlebars` **prompt** — same hybrid pattern: tool runs first, AI handles what the rules couldn't.                                       |
| Review a code diff                           | Use the `reviewSfmcCode` prompt or mention "review the following diff".                                                                                                                                                                    |

### Copy-paste prompt templates

#### Classic Engagement admin (most common)

```
Search the Marketing Cloud Engagement help (product_focus: engagement) and tell me:
<your question here>

Cite which product version your steps apply to and note if the bundled docs are incomplete.
```

#### Marketing Cloud Next — developer API

```
Search the Marketing Cloud Next developer docs and tell me:
<your question here>

Confirm the steps apply to Marketing Cloud Next, not classic Engagement.
```

#### MCN migration analysis

```
Check these files for Marketing Cloud Next compatibility and give me an executive summary:
<paste file contents>
```

#### Rewrite code for MCN

Use the `rewrite_for_mcn` **prompt** — it first runs the deterministic rewrite tool, then applies AI reasoning to any sections that need it. You get the full result in one step.

```
Rewrite the following AMPscript/HTML for Marketing Cloud Next:
<paste code>

Apply all deterministic fixes, convert convertible SSJS to AMPscript, and explain every change.
```

#### Unknown product / migration question

```
Search both Marketing Cloud Engagement and Next help (product_focus: any) and tell me:
<your question here>

Separate the steps for classic Engagement vs Marketing Cloud Next clearly.
```

#### Explicit use of the answerMceHowTo prompt

In clients that support MCP prompts (e.g. VS Code with the `/mcp.sfmc.answerMceHowTo` command):

```
/mcp.sfmc.answerMceHowTo
  question: "How do I create a child business unit and assign it a sender profile?"
  assumeProduct: engagement
```

#### Combining MCE admin with code

```
1. Use search_mce_help (product_focus: engagement) to find the correct Journey Builder entry event
   configuration steps, then
2. Write the AMPscript snippet that reads the data extension row inside the journey email.
```

### What to expect from the AI

- The AI cites the product scope (Engagement or Next) in every answer.
- If the bundled excerpts do not cover the question fully, the AI says so and suggests verifying in the live Salesforce Help.
- Function signatures (AMPscript / SSJS) are always sourced from the language catalog, not from training data.

## Refresh bundled help indexes

### Marketing Cloud Engagement help

The published npm package includes `bundled/mce-help/chunks.json`, produced by `npm run bundle-mce-help`. By default the bundler uses the path in **`MCE_HELP_DOCS`** (see `scripts/bundle-mce-help.mjs`); set it to the root of your mirrored MCE Help Markdown tree when not using the maintainer default.

```bash
cd mcp-server-sfmc
npm run bundle-mce-help
npm run build
npm test
```

Example: `MCE_HELP_DOCS=/absolute/path/to/mce-help-mirror npm run bundle-mce-help`

### Marketing Cloud Next developer docs

The published npm package includes `bundled/mcn-help/chunks.json`, produced by `npm run bundle-mcn-help`. Set **`MCN_HELP_DOCS`** to the root of your mirrored MCN developer docs tree when not using the maintainer default (see `scripts/bundle-mcn-help.mjs`).

```bash
cd mcp-server-sfmc
npm run bundle-mcn-help
npm run build
npm test
```

To rebuild both indexes in one command: `npm run bundle-all`

## AI code review in pull requests

### Cursor Bugbot

[Cursor Bugbot](https://cursor.com/bugbot) reviews pull requests (GitHub) and merge
requests (GitLab) automatically, leaves inline comments with fix suggestions, and publishes
a `Cursor Bugbot` check. It does not run `sfmc-review-diff` itself — you make it
SFMC-aware in two ways:

**1. Repository rules (`BUGBOT.md`) — all plans.** Copy
[`ci-templates/BUGBOT.md`](ci-templates/BUGBOT.md) to **`.cursor/BUGBOT.md`** in your repo
root. It tells Bugbot how to review AMPscript, SSJS, and SFMC HTML — unknown functions,
arity, delimiter balance, ES3-only SSJS, and optional Marketing Cloud Next migration
rules. Bugbot reads the root file plus any nested `.cursor/BUGBOT.md` files near changed
files, so you can scope stricter rules to subfolders.

**2. MCP tools (`mcp-server-sfmc`) — Team / Enterprise plans only.** Bugbot can call MCP
tools during a review so its findings come from the same language catalog as the editor:

1. In the [Bugbot dashboard](https://cursor.com/dashboard?tab=bugbot), enable Bugbot on
   the repository.
2. Open the **MCP** configuration for Bugbot and add this server:

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

3. Add the tools to Bugbot in the dashboard. The relevant review tools are
   `review_change`, `validate_ampscript`, `validate_ssjs`, `validate_sfmc_html`, and
   `suggest_fix`. The `BUGBOT.md` rules above instruct Bugbot when to call them.

> Branch protection: require the **`Cursor Bugbot`** check to make sure a review runs
> before merge. Findings default to a `neutral` conclusion; enable
> fail-on-unresolved-issues in the dashboard (where available) if you want findings to
> produce a failing check.

**Run it locally first.** In Cursor 3.7+, run `/review-bugbot` on your branch before you
push; Bugbot reuses that review on the PR/MR with the same diff, avoiding a duplicate run.

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

For deterministic, blocking CI validation, use the templates provided in `ci-templates/`.
Each one runs **two checks** on every PR/MR: `eslint-plugin-sfmc` on changed files, and
`sfmc-review-diff` (this package) on the unified diff — so a finding fails the job
regardless of which AI reviewer (Bugbot, Copilot, Duo) is also enabled.

| Platform            | File                                                                           |
| ------------------- | ------------------------------------------------------------------------------ |
| GitHub Actions      | [`ci-templates/github-action.yml`](ci-templates/github-action.yml)             |
| GitLab CI           | [`ci-templates/gitlab-ci.yml`](ci-templates/gitlab-ci.yml)                     |
| Jenkins             | [`ci-templates/Jenkinsfile`](ci-templates/Jenkinsfile)                         |
| Azure DevOps        | [`ci-templates/azure-pipelines.yml`](ci-templates/azure-pipelines.yml)         |
| Bitbucket Pipelines | [`ci-templates/bitbucket-pipelines.yml`](ci-templates/bitbucket-pipelines.yml) |

The ESLint job posts lint results as PR/MR comments; the `sfmc-review-diff` job exits
non-zero on `ERROR` diagnostics by default (`--fail-on warning|info` to be stricter).
See [`ci-templates/README.md`](ci-templates/README.md) for the difference between the two
checks.

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
