/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Zahrex for the Zahrex AI plugin (see NOTICE.md): the WebSocket/heartbeat/reconnect logic
 * moved to ./mcp-bridge.ts (unchanged behaviour); this file keeps only the upstream UI rendering.
 */
import "./style.css";
import { startMcpBridge } from "./mcp-bridge";

declare const PENPOT_MCP_WEBSOCKET_URL: string;

// get the current theme from the URL
const searchParams = new URLSearchParams(window.location.hash.split("?")[1]);
document.body.dataset.theme = searchParams.get("theme") ?? "light";

const statusPill = document.getElementById("connection-status") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const currentTaskEl = document.getElementById("current-task") as HTMLElement;
const executedCodeEl = document.getElementById("executed-code") as HTMLTextAreaElement;
const copyCodeBtn = document.getElementById("copy-code-btn") as HTMLButtonElement;
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnect-btn") as HTMLButtonElement;
const versionWarningEl = document.getElementById("version-warning") as HTMLElement;
const versionWarningTextEl = document.getElementById("version-warning-text") as HTMLElement;

const bridge = startMcpBridge({
    defaultUrl: PENPOT_MCP_WEBSOCKET_URL,
    onStatus: (code, label) => {
        if (statusPill) {
            statusPill.dataset.status = code;
        }
        if (statusText) {
            statusText.textContent = label;
        }
        const isConnected = code === "connected";
        if (connectBtn) connectBtn.hidden = isConnected;
        if (disconnectBtn) disconnectBtn.hidden = !isConnected;
    },
    onTask: (taskName, code) => {
        if (currentTaskEl) {
            currentTaskEl.textContent = taskName ?? "---";
        }
        if (executedCodeEl) {
            executedCodeEl.value = code ?? "";
        }
        if (copyCodeBtn) {
            copyCodeBtn.disabled = !code;
        }
    },
    onVersionMismatch: (mcpVersion, penpotVersion) => {
        if (versionWarningEl && versionWarningTextEl) {
            versionWarningTextEl.innerHTML =
                `<b>Version mismatch detected</b>: This version of the MCP server is intended for Penpot ` +
                `${mcpVersion} while the current version is ${penpotVersion}. ` +
                `Executions may not work or produce suboptimal results.`;
            versionWarningEl.hidden = false;
        }
    },
    onTheme: (theme) => {
        document.body.dataset.theme = theme;
    },
});

copyCodeBtn?.addEventListener("click", () => {
    const code = executedCodeEl?.value;
    if (!code) return;

    navigator.clipboard.writeText(code).then(() => {
        copyCodeBtn.classList.add("copied");
        setTimeout(() => copyCodeBtn.classList.remove("copied"), 1500);
    });
});

connectBtn?.addEventListener("click", () => {
    bridge.connect();
});

disconnectBtn?.addEventListener("click", () => {
    bridge.disconnect();
});
