import { redirect } from "next/navigation";
import { currentUser } from "../../lib/auth";
import { signInWithMicrosoft } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in — QEA Campaign HQ" };

/**
 * One button. There is no password to offer, no account to create and nothing
 * to choose: Microsoft proves the address, and everyone with a QEA account is
 * allowed in.
 */
export default async function Login({ searchParams }) {
  // Already signed in, arriving by back button or a stale bookmark.
  if (await currentUser()) redirect("/");

  const err = searchParams?.err;

  return (
    <main className="wrap" style={{ maxWidth: 420, paddingTop: 96 }}>
      <div className="card" style={{ textAlign: "center", padding: "34px 28px" }}>
        <img src="/qea-mark.png" alt="" width={44} height={44}
             style={{ opacity: .9, marginBottom: 18 }} />
        <h1 style={{ fontSize: 19, margin: "0 0 6px", letterSpacing: "-.01em" }}>
          QEA Campaign HQ
        </h1>
        <p style={{ color: "var(--ink-3)", fontSize: 13, margin: "0 0 22px" }}>
          Sign in with your QEA work account.
        </p>

        {err ? (
          <p role="alert" style={{
            color: "var(--crit)", fontSize: 12.5, textAlign: "left",
            margin: "0 0 16px", lineHeight: 1.5,
          }}>{err}</p>
        ) : null}

        <form action={signInWithMicrosoft}>
          <button type="submit" className="choice go"
                  style={{ height: 40, width: "100%", fontSize: 13.5 }}>
            Continue with Microsoft
          </button>
        </form>

        <p style={{ color: "var(--ink-3)", fontSize: 11.5, margin: "18px 0 0", lineHeight: 1.6 }}>
          Work accounts only. Nothing here asks for a password —
          Microsoft does the checking.
        </p>
      </div>
    </main>
  );
}
