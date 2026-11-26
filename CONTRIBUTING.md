# Contributing to Skill Docs

Thank you for your interest in contributing to **Skill Docs (`skill-docs`)**!

## Prerequisites

- **Node.js** `>= 20` (tested with Node 22)
- **npm** `>= 10`
- **Git** (used for remote update-check tests)

## Project Structure

```text
skill-docs/
├── plugin/                 # Antigravity plugin manifest, icon, MCP config, companion skill
├── scripts/
│   ├── build.mjs           # esbuild bundler for server.mjs, cli.mjs, and single-file app.html
│   ├── install.sh          # One-step install from source
│   └── test.mjs            # Compiles and runs Node test runner suite
├── src/
│   ├── cli.ts              # CLI entrypoint (`install`, `uninstall`, `status`, `mcp`)
│   ├── shared/types.ts     # Shared TypeScript interfaces between backend and UI
│   ├── server/             # MCP server, filesystem store, YAML parser, linter, analytics, graph
│   └── ui/                 # React + @modelcontextprotocol/ext-apps single-file web UI
└── tests/
    └── skill-docs.test.ts  # Integration, AC-1..AC-6, MCP E2E, and CLI tests
```

## Development Workflow

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run typecheck, build, and full test suite:
   ```bash
   npm run typecheck && npm run build && npm test
   ```
3. Install your local build into Antigravity for live testing:
   ```bash
   npm run install:plugin
   ```
4. For rapid UI iteration without reinstalling, point `SKILL_DOCS_APP_HTML` to `dist/app.html`.

## Submitting Pull Requests

- Keep changes focused and ensure `npm run typecheck && npm run build && npm test` passes with zero errors.
- Add or update tests in `tests/skill-docs.test.ts` for any new backend or CLI behavior.
- Never include machine-specific absolute user paths in source files or documentation.
