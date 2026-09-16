// GET /api/device/status
// Returns the current device status for the frontend ServerStatus component.
// Does NOT require device auth — it's called by the authenticated admin frontend.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAdminDb } from "../../lib/firebase-admin";

const DEVICE_ID = process.env.VITE_DEVICE_ID ?? "attendance-device-01";
const ONLINE_THRESHOLD_MS = 60_000; // device considered offline if no heartbeat in 60s

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  try {
    const db = getAdminDb();
    const deviceRef = db.collection("devices").doc(DEVICE_ID);
    const deviceSnap = await deviceRef.get();

    if (!deviceSnap.exists) {
      return res.status(200).json({
        success: true,
        device: {
          deviceId: DEVICE_ID,
          online: false,
          lastSeen: null,
          status: "UNKNOWN",
        },
      });
    }

    const deviceData = deviceSnap.data()!;
    const lastSeen: string | null = deviceData.lastSeen ?? null;
    const online = lastSeen
      ? Date.now() - new Date(lastSeen).getTime() < ONLINE_THRESHOLD_MS
      : false;

    return res.status(200).json({
      success: true,
      device: {
        deviceId: DEVICE_ID,
        online,
        lastSeen,
        firmwareVersion: deviceData.firmwareVersion ?? null,
        status: online ? (deviceData.status ?? "READY") : "OFFLINE",
        esp32Status: deviceData.esp32Status ?? null,
        lastGPS: deviceData.lastGPS ?? null,
      },
    });
  } catch (error: any) {
    console.error("[status] Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error", code: "INTERNAL_ERROR" });
  }
}
