// POST /api/device/command
// Called by the React frontend to queue a command for the ESP32.
// The ESP32 retrieves this command via GET /api/device/poll.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAdminDb } from "../../lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { CommandType } from "../../types/device";

const VALID_COMMANDS: CommandType[] = [
  "CAPTURE_FINGERPRINT",
  "VERIFY_FINGERPRINT",
  "DELETE_FINGERPRINT",
  "CLEAR_ALL_FINGERPRINTS",
  "GET_STATUS",
];

const DEVICE_ID = process.env.VITE_DEVICE_ID ?? "attendance-device-01";
// Commands expire after 2 minutes if not picked up
const EXPIRY_MS = 2 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  const { command, payload = {}, deviceId: bodyDeviceId } = req.body ?? {};

  if (!command) {
    return res.status(400).json({ success: false, error: "command is required", code: "MISSING_COMMAND" });
  }

  if (!VALID_COMMANDS.includes(command)) {
    return res.status(400).json({
      success: false,
      error: `Invalid command. Must be one of: ${VALID_COMMANDS.join(", ")}`,
      code: "INVALID_COMMAND",
    });
  }

  const targetDeviceId = bodyDeviceId ?? DEVICE_ID;

  try {
    const db = getAdminDb();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_MS);

    const commandRef = await db.collection("deviceCommands").add({
      deviceId: targetDeviceId,
      command,
      payload,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      createdAtServer: FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      success: true,
      commandId: commandRef.id,
    });
  } catch (error: any) {
    console.error("[command] Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error", code: "INTERNAL_ERROR" });
  }
}
