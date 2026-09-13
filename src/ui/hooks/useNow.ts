import { useEffect, useState } from "react";

/** The current time, re-read every 30 s: often enough for "3 min ago" to stay true. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
