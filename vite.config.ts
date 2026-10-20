/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Zahrex for the Zahrex AI plugin (see NOTICE.md). Derived from the upstream
 * packages/plugin/vite.config.ts: live-preview dev server dropped, Zahrex defines added.
 */
import { defineConfig } from "vite";

// The bundled plugin runs in "integrated remote MCP" mode (Penpot injects `mcp`), so the websocket URL
// below is only a fallback for a manually loaded copy. The version must match the Penpot it serves.
const WS_URI = process.env.WS_URI || "http://localhost:4402";
const MCP_VERSION = process.env.PENPOT_MCP_VERSION || "2.18.3";
const PANEL_URL = process.env.ZX_PANEL_URL || "https://design.zahrex.com/zx/plugin/ui/";
const PANEL_ENABLED = (process.env.ZX_PANEL_ENABLED ?? "true") !== "false";

export default defineConfig({
    base: "./",
    build: {
        outDir: "dist",
        rollupOptions: {
            input: {
                plugin: "src/plugin.ts",
                index: "./index.html",
            },
            output: {
                entryFileNames: "[name].js",
            },
        },
    },
    define: {
        PENPOT_MCP_WEBSOCKET_URL: JSON.stringify(WS_URI),
        PENPOT_MCP_VERSION: JSON.stringify(MCP_VERSION),
        ZX_PANEL_URL: JSON.stringify(PANEL_URL),
        ZX_PANEL_ENABLED: JSON.stringify(PANEL_ENABLED),
    },
});
