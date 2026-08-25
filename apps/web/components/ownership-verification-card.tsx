"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ownershipSchema,
  ownershipVerificationResponseSchema,
  ownershipVerificationStatus,
  type Ownership,
  type OwnershipCheckReason,
} from "@scanpal/shared";

type Props = {
  siteId: string;
};

const REASON_MESSAGES: Record<OwnershipCheckReason, string> = {
  "record-not-found": "The TXT record was not found yet. DNS changes can take time to propagate.",
  "dns-lookup-failed": "DNS could not be reached. Try again in a moment.",
  "token-missing": "No verification token is available for this site.",
  "invalid-site-url": "This site does not have a valid domain for DNS verification.",
  "site-not-found": "This site is no longer available.",
  "token-rotated": "The token changed during verification. Publish the new record and try again.",
};

export function OwnershipVerificationCard({ siteId }: Props) {
  const [ownership, setOwnership] = useState<Ownership | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"verify" | "rotate" | null>(null);
  const [copied, setCopied] = useState<"name" | "value" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/sites/${siteId}/ownership`)
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? "Unable to load ownership verification.");
        }
        const parsed = ownershipSchema.safeParse(body);
        if (!parsed.success) {
          throw new Error("Ownership verification returned an invalid response.");
        }
        return parsed.data;
      })
      .then((data) => {
        if (active) setOwnership(data);
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load ownership verification.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [siteId]);

  const status = useMemo(
    () => ownershipVerificationStatus(ownership?.verified_at ?? null),
    [ownership?.verified_at],
  );

  async function verify() {
    setBusy("verify");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/sites/${siteId}/verify-ownership`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Verification failed. Try again.");
      }
      const parsed = ownershipVerificationResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error("Verification returned an invalid response.");
      }
      if (parsed.data.verified) {
        const verifiedAt = parsed.data.verified_at;
        setOwnership((current) =>
          current ? { ...current, verified_at: verifiedAt } : current,
        );
        setMessage(
          "Domain ownership verified. High-risk scans will still re-check DNS live.",
        );
      } else {
        setOwnership((current) =>
          current ? { ...current, verified_at: null } : current,
        );
        setMessage(REASON_MESSAGES[parsed.data.reason]);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Verification failed. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function rotate() {
    setBusy("rotate");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/sites/${siteId}/ownership-token-rotations`,
        { method: "POST" },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Token rotation failed. Try again.");
      }
      const parsed = ownershipSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error("Token rotation returned an invalid response.");
      }
      setOwnership(parsed.data);
      setMessage(
        "Token rotated. Replace the old TXT value before verifying again.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Token rotation failed. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string, field: "name" | "value") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setMessage(
        "Clipboard access is blocked. Select and copy the visible value manually.",
      );
    }
  }

  if (loading) {
    return (
      <section className="site-detail-section ownership-verification-card">
        <h2>Domain ownership</h2>
        <p className="site-detail-message" role="status">
          Loading verification instructions…
        </p>
      </section>
    );
  }

  if (!ownership) {
    return (
      <section className="site-detail-section ownership-verification-card">
        <h2>Domain ownership</h2>
        <p className="site-detail-message is-error" role="alert">
          {error ?? "Ownership verification is unavailable."}
        </p>
      </section>
    );
  }

  return (
    <section className="site-detail-section ownership-verification-card">
      <div className="site-detail-section-heading ownership-heading">
        <div>
          <h2>Domain ownership</h2>
          <p>
            Publish this TXT record at the domain apex to unlock
            ownership-gated scans.
          </p>
        </div>
        <span className={`ownership-status is-${status}`}>
          {status === "verified"
            ? "Verified"
            : status === "expired"
              ? "Expired"
              : "Not verified"}
        </span>
      </div>

      <div className="ownership-records">
        <div>
          <span>Record name</span>
          <div className="site-detail-code-row">
            <code>{ownership.record_name}</code>
            <button
              type="button"
              onClick={() => void copy(ownership.record_name, "name")}
              className="site-detail-code-action"
            >
              {copied === "name" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <div>
          <span>TXT value</span>
          <div className="site-detail-code-row">
            <code>{ownership.record_value}</code>
            <button
              type="button"
              onClick={() => void copy(ownership.record_value, "value")}
              className="site-detail-code-action"
            >
              {copied === "value" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      </div>

      <div className="ownership-actions">
        <button
          type="button"
          onClick={() => void verify()}
          disabled={busy !== null}
          className="site-detail-primary-action"
        >
          {busy === "verify" ? "Checking DNS…" : "Verify now"}
        </button>
        <button
          type="button"
          onClick={() => void rotate()}
          disabled={busy !== null}
          className="site-detail-secondary-action"
        >
          {busy === "rotate" ? "Rotating…" : "Rotate token"}
        </button>
        {ownership.verified_at && (
          <span className="ownership-verified-at">
            Last verified{" "}
            {new Date(ownership.verified_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        )}
      </div>

      {message && (
        <p
          className={`site-detail-message ${
            status === "verified" ? "is-success" : "is-warning"
          }`}
          role="status"
        >
          {message}
        </p>
      )}
      {error && (
        <p className="site-detail-message is-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
