# SFMC Bugbot Rules

Copy this file into your repository as `.cursor/BUGBOT.md` (project root). Cursor Bugbot
always reads the root `.cursor/BUGBOT.md` and any nested `.cursor/BUGBOT.md` files found
while traversing upward from changed files. These rules tell Bugbot how to review
Salesforce Marketing Cloud code in your pull/merge requests.

> Bugbot rules are guidance, not a parser. For deterministic, blocking validation, also
> run `eslint-plugin-sfmc` and `sfmc-review-diff` in CI (see the templates in this folder).
> If your team has the MCP integration enabled (Team/Enterprise plan), Bugbot can call the
> `mcp-server-sfmc` tools named below directly during a review.

## Scope

These rules apply to files that contain SFMC server-side code:

- AMPscript: `*.amp`, `*.ampscript`, and `*.html` with `%%[ ... ]%%` / `%%=...=%%` blocks
- SSJS: `*.ssjs` and `<script runat="server">` blocks in `*.html`
- GTL (Guide Template Language) blocks in `*.html`

## Required behaviour

- When a diff touches any in-scope file, review the **added/changed lines** for SFMC
  correctness before leaving comments.
- If the `mcp-server-sfmc` MCP tools are available, call `review_change` on the diff, or
  `validate_ampscript` / `validate_ssjs` / `validate_sfmc_html` on the changed file, and
  base your findings on the returned diagnostics.
- Treat each `ERROR` diagnostic as a **blocking** bug; treat `WARNING` / `INFO` as
  **non-blocking** suggestions.
- When you flag an issue, suggest the corrected line inline so the author can apply it.

## AMPscript standards

- Flag calls to unknown AMPscript functions as blocking bugs (typos, wrong casing of a
  real function are common causes).
- Flag wrong argument counts (arity) for known functions as blocking bugs.
- Flag unbalanced AMPscript delimiters — every `%%[` must have a matching `]%%`, and
  inline `%%= ... =%%` must be closed — as blocking bugs.
- Flag malformed AMPscript comments (`/* ... */` must be balanced) as blocking bugs.
- Suggest consistent keyword casing and quote style for new code.

## SSJS standards

- SFMC SSJS runs on an ES3-era engine. Flag ES5+/ES6+ syntax as blocking bugs, including:
  `let` / `const`, arrow functions, template literals, `for...of`, `Array.prototype`
  iterators (`forEach`, `map`, `filter`, `reduce`), `JSON.parse` / `JSON.stringify`, and
  `String.prototype.trim`. Use the Platform equivalents instead
  (`Platform.Function.ParseJSON`, `Platform.Function.Stringify`, `Platform.Function.Trim`).
- Flag SSJS that calls Platform/Core API without a preceding
  `Platform.Load("Core", "1.1.1")` (or equivalent) as a warning.
- Flag direct use of undefined SSJS objects or misspelled `Platform.Function.*` names as
  blocking bugs.

## Marketing Cloud Next (MCN) migration — optional

Enable this section only for repositories that target Marketing Cloud Next (presence of a
`sfdx-project.json` at the repo root, or absence of `.mcdevrc.json`):

- Treat SSJS as **unsupported** in MCN — flag any new SSJS block as a blocking bug and
  suggest an AMPscript rewrite.
- Flag AMPscript functions that have no MCN equivalent (MCN supports a subset of AMPscript
  functions) as blocking bugs. When the MCP tools are available, call the validation tools
  with `target: "next"` to identify them.
- Flag `.NET`-style `FormatDate` patterns; MCN uses Java `SimpleDateFormat` patterns.
- Flag `Lookup()` calls with an odd number of search arguments — MCN requires
  column/value pairs.
- Flag CloudPages-only functions (`CloudPagesURL`, `RequestParameter`, `QueryParameter`,
  `Redirect`, `MicrositeURL`) as not migratable.
