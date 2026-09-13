import { useEffect, useRef, useState } from "react";
import type { AccountUser } from "../../core";
import { resultSummary, syncStatus, type AuthNotice } from "../accountStatus";
import type { Account } from "../hooks/useAccount";
import { useNow } from "../hooks/useNow";
import { Modal } from "./Modal";

const AUTH_NOTICES: Record<AuthNotice, string> = {
  failed: "Sign-in didn't complete. Try again.",
  denied: "This email isn't on the access list for this deployment.",
};

/** Typed to delete the account, so no stray click or Enter can. */
const CONFIRM_WORD = "delete";

/** One action at a time, with its failure kept to show beside it. */
function useAction<Name extends string>() {
  const [pending, setPending] = useState<Name | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (name: Name, action: () => Promise<void>) => {
    if (pending) return;
    setPending(name);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setPending(null);
    }
  };
  return { pending, problem, run };
}

/** Settings' account card: what an account adds, and everything to do with one. */
export function AccountSettings({ account }: { account: Account }) {
  const { phase, user, authNotice } = account;
  const title = useRef<HTMLHeadingElement>(null);
  const [signedOut, setSignedOut] = useState(false);
  // Signing out removes the controls that had focus: put it back at the top of the card rather than lose it.
  useEffect(() => {
    if (signedOut) title.current?.focus();
  }, [signedOut]);

  return (
    <section className="vc-card vc-card-pad" style={{ gridColumn: "span 12" }} aria-labelledby="vc-account-title">
      <div className="vc-section-title">
        <h3 id="vc-account-title" ref={title} tabIndex={-1}>
          Account &amp; sync
        </h3>
      </div>
      {authNotice && !user && (
        <p className="vc-account-notice" role="alert">
          {AUTH_NOTICES[authNotice]}
        </p>
      )}
      <div role="status">
        {signedOut && !user && <p className="vc-account-done">Signed out. Practice on this device is kept.</p>}
      </div>
      {phase === "loading" ? (
        <p className="vc-account-lede">Checking for an account…</p>
      ) : user ? (
        <SignedIn account={account} user={user} onSignedOut={() => setSignedOut(true)} />
      ) : phase === "offline" ? (
        <Unreachable account={account} />
      ) : (
        <>
          <p className="vc-account-lede">
            Your practice is saved on this device either way. An account backs it up and syncs it to your other
            devices, and what you have practiced here joins the account when you sign in.
          </p>
          <div className="vc-actions">
            <button type="button" className="vc-button primary" onClick={() => account.signIn()}>
              Sign in
            </button>
            <button type="button" className="vc-button" onClick={() => account.signIn("sign-up")}>
              Create account
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Unreachable({ account }: { account: Account }) {
  const { pending, run } = useAction<"retry">();
  return (
    <>
      <p className="vc-account-lede">
        Can't reach the server right now, so account options are unavailable. Your practice is still saved on this
        device.
      </p>
      <div className="vc-actions">
        <button type="button" className="vc-button" onClick={() => void run("retry", account.syncNow)}>
          {pending ? "Checking…" : "Try again"}
        </button>
      </div>
    </>
  );
}

function SignedIn({ account, user, onSignedOut }: { account: Account; user: AccountUser; onSignedOut: () => void }) {
  const now = useNow();
  const { pending, problem, run } = useAction<"export" | "sign-out">();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const status = syncStatus(account, now);
  const note =
    account.phase === "error"
      ? account.error
      : account.phase === "idle" && account.lastResult
        ? resultSummary(account.lastResult)
        : null;

  return (
    <>
      <p className="vc-account-who">
        Signed in as <strong>{user.email}</strong>
      </p>
      {status && (
        <p className="vc-account-status">
          <span className={`vc-sync-dot ${status.tone}`} aria-hidden="true" />
          <span>
            {status.detail ? `${status.label} ${status.detail}` : status.label}
            {note && ` · ${note}`}
          </span>
        </p>
      )}
      {/* Sync runs by itself, so none of these is the page's primary action. */}
      <div className="vc-actions vc-account-actions">
        <button type="button" className="vc-button" onClick={() => void account.syncNow()}>
          Sync now
        </button>
        <button type="button" className="vc-button" onClick={() => void run("export", account.exportAccount)}>
          {pending === "export" ? "Preparing download…" : "Download account data"}
        </button>
        <button
          type="button"
          className="vc-button ghost"
          onClick={() =>
            void run("sign-out", async () => {
              await account.signOut();
              onSignedOut();
            })
          }
        >
          {pending === "sign-out" ? "Signing out…" : "Sign out"}
        </button>
      </div>
      {problem && (
        <p className="vc-small vc-error" role="alert">
          {problem}
        </p>
      )}

      <div className="vc-account-danger">
        <div>
          <h4>Delete account</h4>
          <p className="vc-small">Deletes the account and everything synced to it. Practice on this device stays.</p>
        </div>
        <button type="button" className="vc-button danger" onClick={() => setConfirmingDelete(true)}>
          Delete account…
        </button>
      </div>
      {confirmingDelete && <DeleteAccountDialog account={account} onClose={() => setConfirmingDelete(false)} />}
    </>
  );
}

function DeleteAccountDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const { pending, problem, run } = useAction<"export" | "delete">();
  const input = useRef<HTMLInputElement>(null);
  // Phone keyboards capitalize and pad; the intent is the same.
  const confirmed = typed.trim().toLowerCase() === CONFIRM_WORD;

  return (
    <Modal
      className="vc-confirm"
      labelledBy="vc-delete-title"
      describedBy="vc-delete-what"
      initialFocus={input}
      onClose={onClose}
    >
      <h2 id="vc-delete-title">Delete your account?</h2>
      <div id="vc-delete-what" className="vc-confirm-body">
        <p>
          The account is deleted, along with the server's copy of every trial, range measurement, session and phrase
          attempt synced to it.
        </p>
        <p>Practice saved on this device stays. To remove that too, use Clear data on the Progress screen.</p>
        <p>
          <strong>This can't be undone.</strong>
        </p>
      </div>
      <button type="button" className="vc-link" onClick={() => void run("export", account.exportAccount)}>
        {pending === "export" ? "Preparing download…" : "Download account data first"}
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmed) void run("delete", account.deleteAccount);
        }}
      >
        <label htmlFor="vc-delete-confirm">
          Type <strong>{CONFIRM_WORD}</strong> to confirm
        </label>
        <input
          ref={input}
          id="vc-delete-confirm"
          className="vc-input"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {problem && (
          <p className="vc-small vc-error" role="alert">
            {problem}
          </p>
        )}
        <div className="vc-actions">
          <button type="button" className="vc-button ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="vc-button danger" disabled={!confirmed || pending === "delete"}>
            {pending === "delete" ? "Deleting…" : "Delete account"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
