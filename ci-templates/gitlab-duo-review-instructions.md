# GitLab Duo — SFMC Code Review Instructions

Place this content in `.gitlab/duo-instructions.md` in your repository.
GitLab Duo Code Review will use these instructions when reviewing merge requests.

---

This repository contains Salesforce Marketing Cloud (SFMC) code.
Apply the following rules when reviewing merge requests that contain AMPscript, SSJS, or HTML files.

## AMPscript rules

- Block delimiters must balance: every `%%[` requires a matching `]%%`, every `%%=` requires `=%%`.
- Control flow must balance: every `IF` requires `ENDIF`, every `FOR` requires `NEXT`.
- Keywords must be uppercase: `SET`, `VAR`, `IF`, `ELSEIF`, `ELSE`, `ENDIF`, `FOR`, `TO`, `NEXT`, `OUTPUT`.
- Variables must start with `@`. Example: `SET @name = "value"`.
- Comments must use `/* */`. Flag `//` and `<!-- -->` inside AMPscript blocks as errors.
- Flag any function name that does not match the AMPscript function catalog.
- Flag arity mismatches (too few or too many arguments for known functions).

## SSJS rules

- SSJS runs on an ES5 engine. Flag `let`, `const`, arrow functions, template literals, and `class`.
- Flag missing `Platform.Load("core", "1.1.5")` when Core library objects (DataExtension, Rows, etc.) are used.
- Verify WSProxy error handling: flag any `WSProxy` call without a `Status` check on the response.
- Flag `console.log` — use `Platform.Response.Write()` or `Write()` instead.

## Review format

For each issue:
1. Provide the line number.
2. Quote the exact problematic code.
3. Explain why it is wrong.
4. Provide the corrected version.

End with a one-line verdict: APPROVE, REQUEST CHANGES, or COMMENT.
