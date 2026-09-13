import { localDateKey } from "../core";

/** Hands JSON to the browser as a download named `<prefix>-YYYY-MM-DD.json`, dated by the local calendar. */
export function saveJsonFile(json: string, prefix: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${prefix}-${localDateKey(Date.now())}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
