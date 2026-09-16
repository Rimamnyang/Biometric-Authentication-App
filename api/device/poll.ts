// GET /api/device/poll?deviceId=<id>
// Called by ESP32 to retrieve the next pending command.
// Returns the command and marks it as "delivered".

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAdminDb } from "../../lib/firebase-admin";
import { authenticateDevice } from "../../lib/auth";
import { FieldValue } from "firebase-admin/firestore";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  // Authenticate device
  const authResult = authenticateDevice(req as any);
  if (!authResult.ok) {
    return res.status(authResult.status!).json({ success: false, error: authResult.error!, code: authResult.code! });
  }

  const deviceId = (req.query.deviceId as string) || authResult.deviceId;

  try {
    const db = getAdminDb();

    // Find oldest pending command for this device
    const snapshot = await db
      .collection("deviceCommands")
      .where("deviceId", "==", deviceId)
      .where("status", "==", "pending")
      .orderBy("createdAt", "asc")
      .limit(1)
      .get();

    // Update device lastSeen
    await db.collection("devices").doc(deviceId).set(
      {
        deviceId,
        lastSeen: new Date().toISOString(),
        status: "POLLING",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (snapshot.empty) {
      return res.status(200).json({ success: true, command: null });
    }

    const commandDoc = snapshot.docs[0];
    const command = { id: commandDoc.id, ...commandDoc.data() };

    // Mark as delivered
    await commandDoc.ref.update({
      status: "delivered",
      processedAt: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      command: {
        id: command.id,
        type: (command as any).command,
        payload: (command as any).payload ?? {},
      },
    });
  } catch (error: any) {
    console.error("[poll] Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error", code: "INTERNAL_ERROR" });
  }
}
