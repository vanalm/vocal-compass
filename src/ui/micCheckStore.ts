import { MicrophoneEngine } from "../core";

const DEVICE_KEY = "vc-mic-device";
const CHECKED_KEY = "vc-mic-checked";

/** The last check that heard a steady note, in this browser. */
export interface MicCheckRecord {
  deviceId: string | null;
  label: string | null;
  at: string;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The chosen input; null means the system default. */
export function loadMicDevice(): string | null {
  try {
    return storage()?.getItem(DEVICE_KEY) || null;
  } catch {
    return null;
  }
}

export function saveMicDevice(deviceId: string | null): void {
  try {
    if (deviceId) storage()?.setItem(DEVICE_KEY, deviceId);
    else storage()?.removeItem(DEVICE_KEY);
  } catch {
    /* blocked storage: the choice lasts for this page only */
  }
}

export function loadMicCheck(): MicCheckRecord | null {
  try {
    const record = JSON.parse(storage()?.getItem(CHECKED_KEY) ?? "null") as MicCheckRecord | null;
    return record && typeof record.at === "string" ? record : null;
  } catch {
    return null;
  }
}

export function saveMicCheck(record: MicCheckRecord): void {
  try {
    storage()?.setItem(CHECKED_KEY, JSON.stringify(record));
  } catch {
    /* blocked storage: the check just runs again next time */
  }
}

/**
 * Whether the app opens the check at startup: until it has passed once in
 * this browser, and again whenever microphone permission is no longer granted
 * or the input it passed on has been unplugged.
 */
export async function micCheckNeeded(record = loadMicCheck()): Promise<boolean> {
  if (!record) return true;
  try {
    const permission = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    if (permission && permission.state !== "granted") return true;
  } catch {
    /* a browser that can't report the permission: trust the saved check */
  }
  if (!record.deviceId) return false;
  const inputs = await MicrophoneEngine.listInputs().catch(() => []);
  return !inputs.some((input) => input.id === record.deviceId);
}
