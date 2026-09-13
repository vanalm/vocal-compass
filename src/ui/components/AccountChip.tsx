import { syncStatus } from "../accountStatus";
import type { Account } from "../hooks/useAccount";
import { useNow } from "../hooks/useNow";

/**
 * The topbar's account status: a quiet way in when signed out, how sync
 * stands when signed in. Either way it opens Settings, where the account lives.
 */
export function AccountChip({ account, onOpen }: { account: Account; onOpen: () => void }) {
  const now = useNow();
  const status = account.phase === "loading" ? null : syncStatus(account, now);
  // Only states that need attention are announced. "Syncing…" then "Synced" follows every saved trial, and
  // reading those out would talk over the cues; so would a ticking "4 min ago".
  const announcement =
    status && (status.tone === "warn" || status.tone === "off")
      ? [status.label, status.detail].filter(Boolean).join(" ")
      : "";
  return (
    <>
      <span className="vc-sr-only" aria-live="polite">
        {announcement}
      </span>
      {account.phase !== "loading" && (
        <button type="button" className="vc-settings-link vc-account-chip" title="Account & sync" onClick={onOpen}>
          {status ? (
            <>
              <span className={`vc-sync-dot ${status.tone}`} aria-hidden="true" />
              <span>
                {status.label}
                {status.detail && <span className="vc-sync-detail"> {status.detail}</span>}
              </span>
            </>
          ) : (
            "Sign in"
          )}
        </button>
      )}
    </>
  );
}
