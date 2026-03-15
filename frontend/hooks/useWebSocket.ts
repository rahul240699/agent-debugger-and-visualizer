"use client";

/**
 * useWebSocket — manages the WebSocket connection to the backend for a
 * specific run_id.
 *
 * Protocol
 * --------
 * 1. On connect the server sends a HYDRATE message with the full current
 *    state (for late-joiners).
 * 2. Subsequent messages are individual TraceEvent objects.
 * 3. The hook calls store.hydrate() for HYDRATE messages and
 *    store.applyEvent() for every TraceEvent — keeping UI in
 *    sync without full re-renders.
 * 4. A keep-alive ping is sent every 20 s.
 * 5. Exponential backoff reconnection (max 30 s).
 */

import { useCallback, useEffect, useRef } from "react";
import { useRunStore } from "@/store/useRunStore";
import type { HydrateMessage, TraceEvent, WsMessage } from "@/lib/schema";

const BASE_WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";

const PING_INTERVAL_MS = 20_000;
const MAX_BACKOFF_MS = 30_000;

export function useWebSocket(runId: string | null) {
  const applyEvent = useRunStore((s) => s.applyEvent);
  const hydrate = useRunStore((s) => s.hydrate);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffMs = useRef(1000);
  const unmounted = useRef(false);

  const clearTimers = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    if (pingTimer.current) clearInterval(pingTimer.current);
  }, []);

  const connect = useCallback(
    (id: string) => {
      if (unmounted.current) return;

      const url = `${BASE_WS_URL}/ws/${id}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        backoffMs.current = 1000; // reset backoff on successful connect
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (ev: MessageEvent<string>) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(ev.data) as WsMessage;
        } catch {
          return;
        }

        if ("type" in msg && msg.type === "HYDRATE") {
          hydrate(msg as HydrateMessage);
        } else if ("event_type" in msg) {
          applyEvent(msg as TraceEvent);
        }
        // ignore pong / unknown messages
      };

      ws.onerror = () => {
        // onclose will fire after onerror; reconnect there
      };

      ws.onclose = () => {
        clearTimers();
        if (unmounted.current) return;

        // Exponential backoff
        reconnectTimer.current = setTimeout(() => {
          backoffMs.current = Math.min(backoffMs.current * 2, MAX_BACKOFF_MS);
          connect(id);
        }, backoffMs.current);
      };
    },
    [applyEvent, hydrate, clearTimers]
  );

  useEffect(() => {
    unmounted.current = false;
    if (!runId) return;

    connect(runId);

    return () => {
      unmounted.current = true;
      clearTimers();
      wsRef.current?.close();
    };
  }, [runId, connect, clearTimers]);

  const sendMessage = useCallback((msg: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(msg);
    }
  }, []);

  return { sendMessage };
}
