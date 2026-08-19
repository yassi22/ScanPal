import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { pool } from "./db";
import { getSessionUser } from "./supabase/server";
import { getOrCreateUserTeam } from "./team";

export const getDashboardContext = cache(async () => {
  const authUser = await getSessionUser();
  if (!authUser) redirect("/login");

  const result = await getOrCreateUserTeam(pool, {
    id: authUser.id,
    email: authUser.email ?? "",
    name: authUser.user_metadata?.full_name ?? authUser.user_metadata?.name ?? null,
    avatar_url: authUser.user_metadata?.avatar_url ?? null,
    auth_provider: authUser.app_metadata?.provider ?? null,
  });

  return { ...result, authUser };
});
