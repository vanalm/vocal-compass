import { useState } from "react";
import { useServices } from "../services";

/**
 * Optional sync account: email → code → signed in. Local data stays the
 * source of truth; sync is a union merge with the server. The dev server
 * echoes codes back (no mail infrastructure), so we surface them inline.
 */
export function AccountCard({ onSynced }: { onSynced: () => Promise<void> }) {
  const { sync, repository } = useServices();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"idle" | "code" | "signed-in">(
    sync.signedInEmail ? "signed-in" : "idle",
  );
  const [status, setStatus] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const report = (e: unknown) => setStatus(e instanceof Error ? e.message : "Something failed.");

  const request = async () => {
    try {
      setStatus(null);
      const { devCode: echoed } = await sync.requestCode(email);
      setDevCode(echoed ?? null);
      setPhase("code");
    } catch (e) {
      report(e);
    }
  };

  const verify = async () => {
    try {
      setStatus(null);
      await sync.verify(email, code.trim());
      setPhase("signed-in");
      setCode("");
    } catch (e) {
      report(e);
    }
  };

  const runSync = async () => {
    try {
      setStatus("Syncing…");
      const { pushed, pulled } = await sync.sync(repository);
      await onSynced();
      setStatus(`Synced: ${pushed} pushed, ${pulled} pulled.`);
    } catch (e) {
      report(e);
      if (!sync.signedInEmail) setPhase("idle");
    }
  };

  return (
    <div className="vc-account">
      {phase === "idle" && (
        <>
          <p className="vc-small">Optional: sign in to back up and sync between devices.</p>
          <div className="vc-account-row">
            <input
              className="vc-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email for sync"
            />
            <button className="vc-button" onClick={() => void request()} disabled={!email.includes("@")}>
              Send code
            </button>
          </div>
        </>
      )}

      {phase === "code" && (
        <>
          <p className="vc-small">
            Enter the 6-digit code{devCode ? ` (dev server says: ${devCode})` : ` sent to ${email}`}.
          </p>
          <div className="vc-account-row">
            <input
              className="vc-input"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label="Sign-in code"
            />
            <button className="vc-button primary" onClick={() => void verify()} disabled={code.trim().length < 6}>
              Verify
            </button>
            <button className="vc-button" onClick={() => setPhase("idle")}>
              Back
            </button>
          </div>
        </>
      )}

      {phase === "signed-in" && (
        <div className="vc-account-row">
          <span className="vc-small">{sync.signedInEmail}</span>
          <button className="vc-button primary" onClick={() => void runSync()}>
            Sync now
          </button>
          <button
            className="vc-button"
            onClick={() => {
              sync.signOut();
              setPhase("idle");
              setStatus(null);
            }}
          >
            Sign out
          </button>
        </div>
      )}

      {status && <p className="vc-small">{status}</p>}
    </div>
  );
}
