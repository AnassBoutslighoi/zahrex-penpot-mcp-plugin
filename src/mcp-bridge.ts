/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Zahrex for the Zahrex AI plugin (see NOTICE.md). Derived from the upstream
 * packages/plugin/src/main.ts: the MCP WebSocket bridge, extracted verbatim into a module so the same
 * code runs in the upstream MCP UI (panel disabled) and in the Zahrex AI panel page (panel enabled).
 */

declare const PENPOT_MCP_WEBSOCKET_URL: string;

/** Callbacks through which the host page renders bridge state. All optional; the bridge works headless. */
export interface McpBridgeHooks {
    /** connection state: "idle" | "connecting" | "connected" | "disconnected" | "error" */
    onStatus?: (code: string, label: string) => void;
    /** the task currently executing (null = none) */
    onTask?: (taskName: string | null, code: string | null) => void;
    onVersionMismatch?: (mcpVersion: string, penpotVersion: string) => void;
    /** Penpot theme change message from plugin.ts */
    onTheme?: (theme: string) => void;
    /** fallback WebSocket URL for a manually connected (non-integrated) bridge */
    defaultUrl?: string;
}

export interface McpBridge {
    connect(): void;
    disconnect(): void;
}

/**
 * the maximum allowed size for task responses sent back to the MCP server in the integrated remote MCP mode.
 * This bounds the JSON response size.
 * Note that in the remote MCP case, responses are transferred to LLMs (not the file system) and LLMs have
 * size limitations. This serves to bound the size of returned images in particular.
 * Too many overly large simultaneous responses can cause OOM issues in the MCP server, so this contributes
 * to bounding memory usage in the centrally provided MCP server.
 */
const MAX_TASK_RESPONSE_SIZE_REMOTE_MCP = 15_000_000;

export function startMcpBridge(hooks: McpBridgeHooks = {}): McpBridge {
    // WebSocket connection to the MCP server
    let ws: WebSocket | null = null;

    const HEARTBEAT_INTERVAL_MS = 10_000;
    const RECONNECT_BASE_DELAY_MS = 1_000;
    const RECONNECT_MAX_DELAY_MS = 30_000;

    // transport-level reconnect state for the plugin WebSocket
    let shouldReconnect = false;
    let lastConnectionUrl: string | undefined;
    let lastConnectionToken: string | undefined;
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    /**
     * indicates whether the plugin is running with the Penpot-integrated remote MCP server enabled
     * (as opposed to a local server used with the explicitly loaded plugin);
     * set via the "mcp-mode" message sent by plugin.ts on initialization
     */
    let isIntegratedRemoteMcp = false;

    /**
     * Sends a task response back to the MCP server via WebSocket.
     *
     * @param response - The response containing task ID and result
     */
    function sendTaskResponse(response: any): void {
        if (ws && ws.readyState === WebSocket.OPEN) {
            let responseString = JSON.stringify(response);
            if (isIntegratedRemoteMcp && responseString.length > MAX_TASK_RESPONSE_SIZE_REMOTE_MCP) {
                const errorMessage = `Serialised response size (${responseString.length}) exceeds maximum of ${MAX_TASK_RESPONSE_SIZE_REMOTE_MCP}.`;
                console.warn(
                    errorMessage +
                        " [integrated remote MCP mode restriction]; sending error response instead; original response:",
                    response
                );
                response = {
                    id: response.id,
                    success: false,
                    error: errorMessage,
                };
                responseString = JSON.stringify(response);
            }
            ws.send(responseString);
            console.log("Sent response to MCP server:", response);
        } else {
            console.error("WebSocket not connected, cannot send response");
        }
    }

    /**
     * Emits a liveness signal from the plugin event loop.
     *
     * WebSocket ping/pong is not enough here: browsers can answer protocol pings while
     * page JavaScript is frozen and unable to run MCP tasks.
     */
    function sendHeartbeat(): boolean {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "heartbeat" }));
            return true;
        }
        return false;
    }

    /** Starts heartbeat emission for the active WebSocket. */
    function startHeartbeat(): void {
        stopHeartbeat();
        heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    }

    /** Stops heartbeat emission for the active WebSocket. */
    function stopHeartbeat(): void {
        if (heartbeatTimer !== null) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    /**
     * Delay before the next reconnect, using capped exponential backoff.
     *
     * Keeps recovery fast for short drops without hammering an unavailable server.
     */
    function computeReconnectDelay(attempts: number): number {
        return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempts, RECONNECT_MAX_DELAY_MS);
    }

    /** Schedules one WebSocket reconnect attempt with backoff. */
    function scheduleReconnect(): void {
        if (!shouldReconnect || reconnectTimer !== null) {
            return;
        }
        const delay = computeReconnectDelay(reconnectAttempts);
        reconnectAttempts++;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (shouldReconnect && ws?.readyState !== WebSocket.OPEN && ws?.readyState !== WebSocket.CONNECTING) {
                connectToMcpServer(lastConnectionUrl, lastConnectionToken);
            }
        }, delay);
    }

    /** Cancels pending reconnection and resets backoff. */
    function cancelReconnect(): void {
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
        reconnectAttempts = 0;
    }

    /**
     * Establishes a WebSocket connection to the MCP server.
     */
    function connectToMcpServer(baseUrl?: string, token?: string): void {
        shouldReconnect = true;
        lastConnectionUrl = baseUrl;
        lastConnectionToken = token;

        if (ws?.readyState === WebSocket.OPEN) {
            updateConnectionStatus("connected", "Connected");
            return;
        }
        if (ws?.readyState === WebSocket.CONNECTING) {
            return;
        }

        try {
            let wsUrl = baseUrl || hooks.defaultUrl || PENPOT_MCP_WEBSOCKET_URL;
            let wsError: unknown | undefined;

            if (token) {
                wsUrl += `?userToken=${encodeURIComponent(token)}`;
            }

            ws = new WebSocket(wsUrl);
            updateConnectionStatus("connecting", "Connecting...");

            ws.onopen = () => {
                cancelReconnect();
                startHeartbeat();
                setTimeout(() => {
                    if (ws) {
                        console.log("Connected to MCP server");
                        updateConnectionStatus("connected", "Connected");
                    }
                }, 100);
            };

            ws.onmessage = (event) => {
                try {
                    console.log("Received from MCP server:", event.data);
                    const request = JSON.parse(event.data);
                    // Track the current task received from the MCP server
                    if (request.task) {
                        hooks.onTask?.(request.task, request.params?.code ?? null);
                    }
                    // Forward the task request to the plugin for execution
                    parent.postMessage(request, "*");
                } catch (error) {
                    console.error("Failed to parse WebSocket message:", error);
                }
            };

            ws.onclose = (event: CloseEvent) => {
                stopHeartbeat();
                // keep the explicit error state if one was already shown
                if (!wsError) {
                    console.log("Disconnected from MCP server");
                    const label = event.reason ? `Disconnected: ${event.reason}` : "Disconnected";
                    updateConnectionStatus("disconnected", label);
                    hooks.onTask?.(null, null);
                }
                ws = null;
                scheduleReconnect();
            };

            ws.onerror = (error) => {
                console.error("WebSocket error:", error);
                wsError = error;
                // note: WebSocket error events typically don't contain detailed error messages
                updateConnectionStatus("error", "Connection error");
            };
        } catch (error) {
            console.error("Failed to connect to MCP server:", error);
            const reason = error instanceof Error ? error.message : undefined;
            const label = reason ? `Connection failed: ${reason}` : "Connection failed";
            updateConnectionStatus("error", label);
        }
    }

    /** Closes the socket without reconnecting. */
    function disconnectFromMcpServer(): void {
        shouldReconnect = false;
        cancelReconnect();
        stopHeartbeat();
        ws?.close();
    }

    /** Reports connection state to the host page and to plugin.ts (which relays it to Penpot's MCP indicator). */
    function updateConnectionStatus(code: string, label: string): void {
        hooks.onStatus?.(code, label);
        parent.postMessage(
            {
                type: "update-connection-status",
                status: code,
            },
            "*"
        );
    }

    // Listen plugin.ts messages
    window.addEventListener("message", (event) => {
        if (event.data.type === "mcp-mode") {
            isIntegratedRemoteMcp = event.data.integratedRemoteMcp;
        }
        if (event.data.type === "start-server") {
            connectToMcpServer(event.data.url, event.data.token);
        }
        if (event.data.type === "version-mismatch") {
            hooks.onVersionMismatch?.(event.data.mcpVersion, event.data.penpotVersion);
        }
        if (event.data.type === "stop-server") {
            disconnectFromMcpServer();
        } else if (event.data.source === "penpot") {
            hooks.onTheme?.(event.data.theme);
        } else if (event.data.type === "task-response") {
            // Forward task response back to MCP server
            sendTaskResponse(event.data.response);
        }
    });

    /** Sends a heartbeat or reconnects after the tab becomes active again. */
    function handleTabResumed(): void {
        if (!shouldReconnect) {
            return;
        }
        if (ws?.readyState === WebSocket.OPEN) {
            sendHeartbeat();
        } else if (ws?.readyState !== WebSocket.CONNECTING) {
            cancelReconnect();
            connectToMcpServer(lastConnectionUrl, lastConnectionToken);
        }
    }

    // Chrome supports freeze/resume; Firefox does not. That is acceptable because
    // Firefox still supports visibilitychange, and stale heartbeats detect any tab
    // suspension that prevents plugin JavaScript from running tasks.

    // Chrome: about to pause page JavaScript.
    document.addEventListener("freeze", () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "freeze" }));
        }
    });

    // Chrome: frozen page resumed.
    document.addEventListener("resume", handleTabResumed);

    // Chrome and Firefox: tab visibility changed.
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            handleTabResumed();
        }
    });

    parent.postMessage({ type: "ui-initialized" }, "*");

    return {
        connect: () => connectToMcpServer(),
        disconnect: disconnectFromMcpServer,
    };
}
