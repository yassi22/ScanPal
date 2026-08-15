import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const webEnv = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".env",
);
for (const line of readFileSync(webEnv, "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}

const email = process.argv[2];
if (!email) {
  console.error('Gebruik: node scripts/create-test-user.mjs naam@voorbeeld.nl [volledige naam]');
  process.exit(1);
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY ontbreekt in apps/web/.env",
  );
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: created, error } = await supabase.auth.admin.createUser({
  email,
  email_confirm: true,
  user_metadata: { full_name: process.argv[3] ?? email.split("@")[0] },
});
if (error && !/already registered|already been registered/i.test(error.message)) {
  console.error("createUser mislukt:", error.message);
  process.exit(1);
}

const redirectTo = `${process.env.APP_URL ?? "http://localhost:3000"}/api/auth/callback`;
const { data: link, error: linkError } = await supabase.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { redirectTo },
});
if (linkError) {
  console.error("generateLink mislukt:", linkError.message);
  process.exit(1);
}

const isNew = created?.user && !error;
console.log(`${isNew ? "User aangemaakt" : "User bestond al"}: ${email}`);
console.log(`Open deze link om in te loggen (geen mail nodig):\n${link.properties.action_link}`);
