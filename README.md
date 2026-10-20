# Zahrex fork of the Penpot MCP plugin: MPL-2.0 source

This repository publishes the **Mozilla Public License 2.0** source files of the Penpot MCP plugin, as Zahrex distributes them in the plugin served at `design.zahrex.com`. That covers the files modified by Zahrex as well as those used unchanged.

- **Upstream:** [penpot/penpot](https://github.com/penpot/penpot), tag `2.18.3`, directories `mcp/packages/plugin` and `mcp/packages/common/src`.
- **License:** MPL-2.0 (see `LICENSE`).

## Modified by Zahrex

Each of these files carries a "Modified by Zahrex" header.

| File | Change |
|---|---|
| `src/plugin.ts` | One import and one guarded call that opens the Zahrex AI panel. The MCP task path is unchanged. |
| `src/task-handlers/ExecuteCodeTaskHandler.ts` | The import path of the shared types only. |
| `vite.config.ts` | The live-preview dev server is removed, and build-time defines for the panel URL and toggle are added. |

## Unmodified (verbatim from 2.18.3)

`src/main.ts`, `src/TaskHandler.ts`, `src/ErrorUtils.ts`, `src/PenpotUtils.ts`, `src/style.css`, `src/vite-env.d.ts`, `src/index.d.ts`, `index.html`, `tsconfig.json`, `public/manifest.json`, `public/icon.jpg`. The shared types under `src/common/` come from upstream `mcp/packages/common/src`.

## Not part of this publication

`src/plugin.ts` imports `./zahrex/panel`. That file and the chat panel UI are separate, original Zahrex files that are not covered by the MPL, so they are not published here.
