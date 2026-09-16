// Shared TypeScript types for device communication (ESP32 ↔ Vercel API)

export type CommandType =
  | "CAPTURE_FINGERPRINT"
  | "VERIFY_FINGERPRINT"
  | "DELETE_FINGERPRINT"
  | "CLEAR_ALL_FINGERPRINTS"
  | "GET_STATUS";

export type CommandStatus =
  | "pending"
  | "delivered"
  | "processing"
  | "completed"
  | "failed"
  | "expired";

export interface DeviceCommand {
  id: string;
  deviceId: string;
  command: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  createdAt: string;
  processedAt?: string;
  expiresAt: string;
}

export type EventType =
  | "STATUS"
  | "FINGERPRINT_ENROLLED"
  | "FINGERPRINT_VERIFIED"
  | "FINGERPRINT_DELETED"
  | "ALL_FINGERPRINTS_CLEARED"
  | "ATTENDANCE"
  | "VERIFY_RESPONSE"
  | "ENROLL_RESPONSE"
  | "DELETE_RESPONSE"
  | "CLEAR_ALL_RESPONSE"
  | "ERROR"
  // Application-level events (written by server after processing)
  | "ATTENDANCE_RECORDED"
  | "SIGNED_OUT"
  | "NO_ACTIVE_SESSION"
  | "NO_MATCHING_SESSION"
  | "SESSION_COMPLETED"
  | "DUPLICATE_ATTENDANCE";

export interface DeviceEvent {
  id: string;
  deviceId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
  processed: boolean;
  createdAt: string;
}

export interface DeviceResult {
  deviceId: string;
  commandId: string;
  resultType: string;
  success: boolean;
  data: Record<string, unknown>;
}

export interface DeviceStatus {
  deviceId: string;
  online: boolean;
  lastSeen: string | null;
  firmwareVersion?: string;
  status?: string;
  esp32Status?: {
    wifi: boolean;
    fingerprint: boolean;
    gps: boolean;
    gpsFixed: boolean;
    satellites: number;
    ip: string;
  };
  lastGPS?: {
    lat: number | null;
    lon: number | null;
    gpsFixed: boolean;
  };
}

export interface AttendanceEventPayload {
  fingerprintId: number | string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  gpsFixed?: boolean;
  gpsAvailable?: boolean;
  satellites?: number;
}

// Standard API response shapes
export interface ApiSuccess<T = unknown> {
  success: true;
  data?: T;
}

export interface ApiError {
  success: false;
  error: string;
  code: string;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;
