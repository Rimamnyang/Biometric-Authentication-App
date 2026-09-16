// Device authentication middleware
// Validates the Authorization: Bearer <DEVICE_API_KEY> header on incoming requests
// from the ESP32.  Never use VITE_ prefixed env vars here — those are public.

export interface DeviceAuthResult {
  ok: boolean;
  deviceId: string;
  status?: number;
  error?: string;
  code?: string;
}

/**
 * Authenticate a device request.
 *
 * Expected headers:
 *   Authorization: Bearer <DEVICE_API_KEY>
 *   x-device-id: <deviceId>   (or ?deviceId= query param)
 */
export function authenticateDevice(req: any): DeviceAuthResult {
  const apiKey = process.env.DEVICE_API_KEY;

  if (!apiKey) {
    console.error("DEVICE_API_KEY environment variable is not set");
    return {
      ok: false,
      deviceId: "",
      status: 403,
      error: "Server misconfiguration: device authentication not configured",
      code: "SERVER_MISCONFIGURATION",
    };
  }

  const authHeader = req.headers?.authorization as string | undefined;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      deviceId: "",
      status: 401,
      error: "Missing or malformed Authorization header. Expected: Bearer <key>",
      code: "MISSING_AUTH_HEADER",
    };
  }

  const providedKey = authHeader.slice(7); // strip "Bearer "
  if (providedKey !== apiKey) {
    return {
      ok: false,
      deviceId: "",
      status: 401,
      error: "Invalid device API key",
      code: "INVALID_API_KEY",
    };
  }

  // Extract device ID from header or query string
  const headers = req.headers as Record<string, string | undefined>;
  const query = req.query as Record<string, string | string[]> | undefined;

  const deviceId =
    headers["x-device-id"] ||
    (typeof query?.deviceId === "string" ? query.deviceId : undefined) ||
    "default-device";

  return { ok: true, deviceId };
}
