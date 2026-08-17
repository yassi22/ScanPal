import { z } from "zod";

/**
 * Plan 40 — stackdetectie (CMS/framework) uit headers + HTML. Pure logica
 * (geen fetch); de worker-wrapper levert headers + HTML aan. Detectie op basis
 * van bekende signatures: Server/X-Powered-By headers, <meta name="generator">,
 * framework-specifieke markers in HTML (wp-content, __NEXT_DATA__, ng-version,
 * data-reactroot, etc.) en bekende asset-paden.
 */

export type StackMatch = {
  id: string;
  name: string;
  category: "cms" | "framework" | "server" | "cdn" | "analytics" | "platform";
  signals: string[];
};

export const stackDetectionEvidenceSchema = z.object({
  kind: z.literal("stack-detection"),
  detected: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      signals: z.array(z.string()),
    }),
  ),
});
export type StackDetectionEvidence = z.infer<typeof stackDetectionEvidenceSchema>;

type Signature = {
  id: string;
  name: string;
  category: StackMatch["category"];
  /** Header-name (lowercase) → substring-match (lowercase). */
  headers?: Record<string, string>;
  /** Generator meta-tag substring (lowercase). */
  generator?: string[];
  /** HTML-substring markers (lowercase). */
  html?: string[];
  /** Cookie-name prefixes (lowercase) die de stack verraden. */
  cookies?: string[];
};

const SIGNATURES: Signature[] = [
  {
    id: "wordpress",
    name: "WordPress",
    category: "cms",
    generator: ["wordpress"],
    html: ["wp-content", "wp-includes", "wp-json"],
  },
  {
    id: "drupal",
    name: "Drupal",
    category: "cms",
    generator: ["drupal"],
    headers: { "x-generator": "drupal" },
    html: ["sites/all/themes", "drupal.js"],
  },
  {
    id: "joomla",
    name: "Joomla",
    category: "cms",
    generator: ["joomla"],
    headers: { "x-content-powered-by": "joomla" },
  },
  {
    id: "shopify",
    name: "Shopify",
    category: "platform",
    headers: { "x-shopify-stage": "" },
    html: ["cdn.shopify.com", "shopify.theme"],
  },
  {
    id: "wix",
    name: "Wix",
    category: "platform",
    headers: { "x-wix-request-server": "" },
    html: ["static.wixstatic.com", "wix.com"],
  },
  {
    id: "squarespace",
    name: "Squarespace",
    category: "platform",
    headers: { server: "squarespace" },
    html: ["static1.squarespace.com", "squarespace.com"],
  },
  {
    id: "webflow",
    name: "Webflow",
    category: "platform",
    html: ["webflow.com", "w-nav"],
  },
  {
    id: "nextjs",
    name: "Next.js",
    category: "framework",
    headers: { "x-powered-by": "next.js" },
    html: ["__next_data__", "_next/static", "__next_f"],
  },
  {
    id: "nuxt",
    name: "Nuxt",
    category: "framework",
    headers: { "x-powered-by": "nuxt" },
    html: ["_nuxt/", "__nuxt", "window.__NUXT__"],
  },
  {
    id: "remix",
    name: "Remix",
    category: "framework",
    html: ["__remixContext", "__remix_manifest", "window.__remix"],
  },
  {
    id: "sveltekit",
    name: "SvelteKit",
    category: "framework",
    html: ["sveltekit:", "__sveltekit", "data-sveltekit"],
  },
  {
    id: "gatsby",
    name: "Gatsby",
    category: "framework",
    html: ["___gatsby", "gatsby-image"],
  },
  {
    id: "angular",
    name: "Angular",
    category: "framework",
    html: ["ng-version", "ng-app", "angular"],
  },
  {
    id: "react",
    name: "React",
    category: "framework",
    html: ["data-reactroot", "data-reactroot", "react-dom"],
  },
  {
    id: "vue",
    name: "Vue",
    category: "framework",
    html: ["data-v-app", "__vue_app__", "vue.runtime"],
  },
  {
    id: "django",
    name: "Django",
    category: "framework",
    headers: { "x-frame-options": "" },
    cookies: ["csrftoken", "sessionid"],
  },
  {
    id: "rails",
    name: "Ruby on Rails",
    category: "framework",
    headers: { "x-powered-by": "rails" },
    cookies: ["_rails_session"],
  },
  {
    id: "laravel",
    name: "Laravel",
    category: "framework",
    headers: { "x-powered-by": "laravel" },
    cookies: ["laravel_session", "xsrftoken"],
  },
  {
    id: "express",
    name: "Express",
    category: "framework",
    headers: { "x-powered-by": "express" },
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    category: "cdn",
    headers: { server: "cloudflare", "cf-ray": "" },
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "cdn",
    headers: { server: "vercel", "x-vercel-id": "" },
  },
  {
    id: "netlify",
    name: "Netlify",
    category: "cdn",
    headers: { server: "netlify", "x-nf-request-id": "" },
  },
  {
    id: "fastly",
    name: "Fastly",
    category: "cdn",
    headers: { "x-served-by": "cache", "x-fastly": "" },
  },
  {
    id: "nginx",
    name: "nginx",
    category: "server",
    headers: { server: "nginx" },
  },
  {
    id: "apache",
    name: "Apache",
    category: "server",
    headers: { server: "apache" },
  },
  {
    id: "microsoft-iis",
    name: "Microsoft IIS",
    category: "server",
    headers: { server: "microsoft-iis" },
  },
];

export type HeaderSource = { get(name: string): string | null };

function headerValue(headers: HeaderSource, name: string): string {
  return (headers.get(name) ?? "").toLowerCase();
}

function findGenerator(html: string): string {
  const re = /<meta[^>]+name\s*=\s*["']generator["'][^>]*>/i;
  const tag = html.match(re)?.[0] ?? "";
  const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
  return content.toLowerCase();
}

/**
 * Detecteert stacks uit headers + HTML. Eén signature kan meerdere signalen
 * afgeven (header + html + generator); een stack wordt gerapporteerd zodra er
 * minstens één signaal is. Cookie-matching gebeurt optioneel via `cookies`.
 */
export function detectStack(
  headers: HeaderSource,
  html: string,
  cookies: string[] = [],
): StackMatch[] {
  const lowerHtml = html.toLowerCase();
  const generator = findGenerator(html);
  const lowerCookies = cookies.map((c) => c.toLowerCase());

  const matches: StackMatch[] = [];

  for (const sig of SIGNATURES) {
    const signals: string[] = [];

    if (sig.headers) {
      for (const [name, needle] of Object.entries(sig.headers)) {
        const value = headerValue(headers, name);
        if (value && (needle === "" || value.includes(needle))) {
          signals.push(`header ${name}: ${value.slice(0, 60)}`);
        }
      }
    }

    if (sig.generator && generator) {
      for (const needle of sig.generator) {
        if (generator.includes(needle)) {
          signals.push(`generator: ${generator.slice(0, 60)}`);
          break;
        }
      }
    }

    if (sig.html) {
      for (const needle of sig.html) {
        if (lowerHtml.includes(needle)) {
          signals.push(`html marker: ${needle}`);
          break;
        }
      }
    }

    if (sig.cookies) {
      for (const needle of sig.cookies) {
        if (lowerCookies.some((c) => c.startsWith(needle))) {
          signals.push(`cookie: ${needle}`);
          break;
        }
      }
    }

    if (signals.length > 0) {
      matches.push({
        id: sig.id,
        name: sig.name,
        category: sig.category,
        signals,
      });
    }
  }

  return matches;
}

export function stackDetectionEvidence(matches: StackMatch[]): StackDetectionEvidence {
  return {
    kind: "stack-detection",
    detected: matches.map((m) => ({
      id: m.id,
      name: m.name,
      category: m.category,
      signals: m.signals,
    })),
  };
}

export function evaluateStackDetection(matches: StackMatch[]): {
  status: "pass" | "warn" | "info";
  detail: string;
} {
  if (matches.length === 0) {
    return { status: "info", detail: "Geen CMS/framework/server herkend uit headers of HTML" };
  }
  const names = matches.map((m) => `${m.name} (${m.category})`);
  return {
    status: "pass",
    detail: `Gevonden: ${names.join(", ")}`,
  };
}
