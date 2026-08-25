export function isSameOriginUrl(candidate: string, verifiedUrl: string): boolean {
  try {
    return new URL(candidate, verifiedUrl).origin === new URL(verifiedUrl).origin;
  } catch {
    return false;
  }
}

export function hasUnsanitizedTraversalEvidence(value: string): boolean {
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    if (/(^|[\\/])\.\.([\\/]|$)/.test(decoded) || decoded.includes("../") || decoded.includes("..\\")) {
      return true;
    }
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return /%2e%2e(?:%2f|%5c)/i.test(decoded);
}
