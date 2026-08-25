/**
 * Gedeelde, ReDoS-veilige extractie van `<loc>`-waarden uit een sitemap-body
 * (urlset óf sitemapindex). Eén bron voor alle sitemap-parsers zodat de
 * onderstaande regex-hardening niet per call-site opnieuw hoeft te gebeuren.
 */

/**
 * Extraheert de `<loc>`-waarden uit een sitemap-XML-body.
 *
 * ReDoS-veilig: gebruikt één quantifier (`[^<]*`) i.p.v. de eerder verspreide
 * `<loc>\s*([^<]+?)\s*<\/loc>`-vorm. Die laatste combineerde drie overlappende
 * variabele-lengte-quantifiers (`\s*` … `[^<]+?` … `\s*`) en gaf daardoor
 * catastrophic (kubisch) backtracking: een aanvaller-gecontroleerde sitemap
 * (`<loc>` gevolgd door duizenden spaties zónder sluittag) liet de regex
 * synchroon minuten draaien en pinde de event-loop van de worker — een
 * multi-tenant DoS. `[^<]*` matcht lineair en de literal `<\/loc>` begint met
 * een teken dat de klasse uitsluit, dus er is geen ambiguïteit om op terug te
 * backtracken.
 *
 * Waarden worden getrimd; lege/whitespace-only waarden worden overgeslagen.
 *
 * @param xml   de (reeds byte-begrensde) sitemap-body.
 * @param limit maximum aantal terug te geven `<loc>`-waarden (bescherming tegen
 *              enorme sitemaps). Default onbegrensd.
 */
export function extractSitemapLocs(
  xml: string,
  limit = Number.POSITIVE_INFINITY,
): string[] {
  const locRe = /<loc>([^<]*)<\/loc>/gi;
  const locs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = locRe.exec(xml)) !== null) {
    const value = match[1].trim();
    if (value) locs.push(value);
    if (locs.length >= limit) break;
  }
  return locs;
}
