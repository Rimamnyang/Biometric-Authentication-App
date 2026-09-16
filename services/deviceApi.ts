// services/deviceApi.ts
// Replaces all `new WebSocket("ws://localhost:5000")` calls in components.
// Uses fetch("/api/device/...") — works identically in local Vite dev and on Vercel.

import type { CommandType, DeviceStatus, ApiResponse } from "../types/device";

const DEFAULT_DEVICE_ID = import.meta.env.VITE_DEVICE_ID ?? "attendance-device-01";

// ─── Command sender ───────────────────────────────────────────────────────────

export async function sendDeviceCommand(
  command: CommandType,
  payload: Record<string, unknown> = {},
  deviceId = DEFAULT_DEVICE_ID
): Promise<{ success: true; commandId: string } | { success: false; error: string }> {
  try {
    const res = await fetch("/api/device/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, payload, deviceId }),
    });
    const data: any = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error ?? "Command failed" };
    }
    return { success: true, commandId: data.commandId };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Network error" };
  }
}

// ─── Specific command helpers ─────────────────────────────────────────────────

export function requestFingerprintVerification(deviceId = DEFAULT_DEVICE_ID) {
  return sendDeviceCommand("VERIFY_FINGERPRINT", {}, deviceId);
}

export function requestFingerprintEnrollment(deviceId = DEFAULT_DEVICE_ID) {
  return sendDeviceCommand("CAPTURE_FINGERPRINT", {}, deviceId);
}

export function deleteFingerprint(templateId: string | number, deviceId = DEFAULT_DEVICE_ID) {
  return sendDeviceCommand("DELETE_FINGERPRINT", { templateId: String(templateId) }, deviceId);
}

export function clearAllFingerprints(deviceId = DEFAULT_DEVICE_ID) {
  return sendDeviceCommand("CLEAR_ALL_FINGERPRINTS", {}, deviceId);
}

export function requestDeviceStatusRefresh(deviceId = DEFAULT_DEVICE_ID) {
  return sendDeviceCommand("GET_STATUS", {}, deviceId);
}

// ─── Status polling ───────────────────────────────────────────────────────────

export async function getDeviceStatus(deviceId = DEFAULT_DEVICE_ID): Promise<DeviceStatus | null> {
  try {
    const res = await fetch(`/api/device/status?deviceId=${encodeURIComponent(deviceId)}`);
    const data: ApiResponse<DeviceStatus> = await res.json();
    if (!data.success) return null;
    return (data as any).device as DeviceStatus;
  } catch {
    return null;
  }
}
