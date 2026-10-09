import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { beforeAll } from "vitest";

/**
 * Optional: run the whole suite through Prisma's driver-adapter layer.
 * - TEST_DRIVER_ADAPTER=pg: node-postgres adapter over TCP.
 * - TEST_DRIVER_ADAPTER=neon-ws: the production DATABASE_TRANSPORT=websocket
 *   adapter (Neon serverless driver over WebSockets), pointed at a local
 *   WebSocket-to-TCP bridge on TEST_WS_PROXY (host:port) standing in for
 *   Neon's proxy.
 * Verifies triggers, advisory locks, exclusion constraints and error mapping
 * behave identically under adapters.
 */
const g = globalThis as { __cmPrismaAdapter?: unknown };
const mode = process.env.TEST_DRIVER_ADAPTER;
if (mode === "pg") {
  g.__cmPrismaAdapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
} else if (mode === "neon-ws") {
  const proxy = process.env.TEST_WS_PROXY ?? "localhost:8089";
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  neonConfig.wsProxy = (host, port) => `${proxy}/v1?address=${host}:${port}`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
  g.__cmPrismaAdapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
}

/**
 * Open states: posting needs an available doctor (market.requireAvailableProvider). Older test files
 * post shifts to test other things before any provider exists, so the check is off unless a test
 * (open-states.test.ts) turns it on.
 */
beforeAll(async () => {
  // The test-site suite builds its own database in its own beforeAll (and runs with the check on, like the test site).
  if (process.env.SANDBOX_MODE === "1") return;
  const { prisma } = await import("@cm/db");
  const key = "market.requireAvailableProvider";
  await prisma.setting.upsert({ where: { key }, create: { key, value: false }, update: { value: false } });
  (await import("@cm/services")).invalidateSettings();
});
