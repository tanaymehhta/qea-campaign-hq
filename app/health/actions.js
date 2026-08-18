"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "../../lib/db";

/**
 * The one thing /health lets anyone change.
 *
 * A group with no owner disappears from the rep layer entirely — no avatar, no
 * rep filter on the Overview, no entry in the /calls roster — and until now the
 * only way to give it one was editing the database by hand.
 *
 * It goes through `set_group_owner`, a security-definer function that validates
 * its own arguments and can touch exactly one column of one row. Same pattern as
 * app/conflicts/actions.js: a rejected write comes back as the database's own
 * sentence in a banner rather than a crash screen.
 */
export async function setGroupOwner(formData) {
  const { error } = await db.rpc("set_group_owner", {
    p_group: formData.get("group"),
    p_owner: formData.get("owner") ?? "",
  });
  if (error) redirect(`/health?err=${encodeURIComponent(error.message)}`, "replace");
  // Every page that draws a rep avatar or a rep filter reads this.
  for (const p of ["/health", "/", "/campaigns", "/meetings", "/calls"]) revalidatePath(p);
  redirect("/health", "replace");
}
