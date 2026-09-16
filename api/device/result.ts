// POST /api/device/result
// Called by ESP32 after executing a command (enroll, delete, verify, clear-all).
// Validates the command, records the result, and triggers Firestore app-level events.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAdminDb } from "../../lib/firebase-admin";
import { authenticateDevice } from "../../lib/auth";
import { FieldValue } from "firebase-admin/firestore";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  const authResult = authenticateDevice(req as any);
  if (!authResult.ok) {
    return res.status(authResult.status!).json({ success: false, error: authResult.error!, code: authResult.code! });
  }

  const { deviceId, commandId, resultType, success: resultSuccess, data } = req.body ?? {};

  if (!commandId || !resultType) {
    return res.status(400).json({ success: false, error: "commandId and resultType are required", code: "MISSING_FIELDS" });
  }

  try {
    const db = getAdminDb();

    // Update device lastSeen
    await db.collection("devices").doc(authResult.deviceId).set(
      { lastSeen: new Date().toISOString(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );

    // Mark the original command as completed/failed
    const commandRef = db.collection("deviceCommands").doc(commandId);
    const commandSnap = await commandRef.get();

    if (!commandSnap.exists) {
      return res.status(404).json({ success: false, error: "Command not found", code: "COMMAND_NOT_FOUND" });
    }

    await commandRef.update({
      status: resultSuccess ? "completed" : "failed",
      processedAt: new Date().toISOString(),
      result: { success: resultSuccess, data: data ?? {} },
    });

    // Write a deviceEvent so the frontend Firestore listener picks it up
    const eventPayload: Record<string, unknown> = {
      success: resultSuccess,
      ...(data ?? {}),
    };

    await db.collection("deviceEvents").add({
      deviceId: authResult.deviceId,
      eventType: resultType,
      commandId,
      payload: eventPayload,
      processed: false,
      createdAt: new Date().toISOString(),
      createdAtServer: FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("[result] Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error", code: "INTERNAL_ERROR" });
  }
}
