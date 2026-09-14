import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * The gate. One file, one question: is there a valid session?
 *
 * It deliberately does NOT look at app_users. This runs on every request that
 * gets past the matcher, and the row lookup belongs in currentUser(), where
 * React's cache() dedupes it to once per render. Middleware answering more than
 * "is this person signed in" means a database round trip per request for an
 * answer nothing here uses — everyone with a QEA account is allowed in, so
 * there is no second question to ask.
 *
 * It also refreshes the session cookie, which is the other half of its job: a
 * Server Component cannot write cookies, so if this file did not run, sessions
 * would expire mid-use and sign people out at random.
 */
export async function middleware(request) {
  // The stub (AUTH_PLAN 5a) has to open the gate too, or nothing downstream of
  // it can be reached before IT returns the Entra registration. Same production
  // guard as lib/auth.js: a stub that ships is an open dashboard that believes
  // it is closed.
  if (process.env.AUTH_STUB_EMAIL) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("AUTH_STUB_EMAIL is set in a production build", { status: 500 });
    }
    return NextResponse.next();
  }

  // Written to as the client refreshes tokens, and returned either way, so the
  // refreshed cookie survives both the pass-through and the redirect.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      "https://yfnqszwlyoyfhuwfmcyl.supabase.co",
    process.env.SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // getUser(), not getSession(): it asks the auth server whether the token is
  // real instead of trusting what the cookie says about itself.
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except the login page, the OAuth routes it depends on, Next's
    // own assets, and files with an extension (images, fonts, the QEA mark) —
    // which must stay reachable or the login page renders without its own logo.
    "/((?!login|auth/callback|auth/signout|_next/static|_next/image|favicon.ico|.*\\.[^/]*$).*)",
  ],
};
