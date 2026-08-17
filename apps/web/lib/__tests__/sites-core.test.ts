import { describe, it, expect, beforeEach } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";
import {
  createSite,
  listSitesWithStatus,
  updateSite,
  deleteSite,
  setSiteScanState,
  SiteError,
  type SiteRowWithStatus,
} from "../../lib/sites-core";

type Row = Record<string, unknown>;
type QueryResultLike = Partial<QueryResult<Row>>;

function makeSite(
  id: string,
  url: string,
  overrides: Partial<SiteRowWithStatus> = {},
): SiteRowWithStatus {
  return {
    id,
    team_id: "team-1",
    url,
    github_repo: null,
    label: null,
    public_status_slug: null,
    github_webhook_configured: false,
    last_scan_id: null,
    last_scan_status: null,
    last_scan_score: null,
    last_scanned_at: null,
    uptime_state: "unknown",
    scan_frequency: "none",
    next_scan_at: null,
    created_at: new Date("2026-08-15T10:00:00Z"),
    ...overrides,
  };
}

function fakePool() {
  let siteSeq = 0;
  const sites: SiteRowWithStatus[] = [];

  function handle(sql: string, params: unknown[] = []): QueryResultLike {
    const text = sql.replace(/\s+/g, " ").trim();
    const isList = text.startsWith("select") && text.includes("order by");

    if (text === "begin" || text === "commit" || text === "rollback") {
      return { rowCount: 1, rows: [] };
    }

    if (isList) {
      const [teamId] = params;
      const rows = sites
        .filter((s) => s.team_id === teamId)
        .sort((a, b) => {
          if (!a.last_scanned_at && !b.last_scanned_at) return 0;
          if (!a.last_scanned_at) return 1;
          if (!b.last_scanned_at) return -1;
          return b.last_scanned_at.getTime() - a.last_scanned_at.getTime();
        });
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith("select")) {
      const [teamId] = params;
      const rows = sites.filter((s) => s.team_id === teamId);
      return { rowCount: rows.length, rows };
    }

    if (text.startsWith("insert into sites")) {
      const [teamId, url, githubRepo, label] = params as [
        string,
        string,
        string | null,
        string | null,
      ];
      const site = makeSite(`site-${++siteSeq}`, url, {
        team_id: teamId,
        github_repo: githubRepo,
        label,
      });
      sites.push(site);
      return { rowCount: 1, rows: [{ ...site }] };
    }

    if (text.startsWith("update sites set last_scan_id")) {
      const [scanId, status, score] = params as [string, string, number | null];
      const [siteId] = params.slice(3) as [string];
      const site = sites.find((s) => s.id === siteId);
      if (!site) return { rowCount: 0, rows: [] };
      site.last_scan_id = scanId;
      site.last_scan_status = status as SiteRowWithStatus["last_scan_status"];
      if (score !== null) site.last_scan_score = score;
      site.last_scanned_at = new Date();
      return { rowCount: 1, rows: [] };
    }

    if (text.startsWith("update sites set")) {
      const assignments = text.match(/update sites set (.+?) where/)?.[1] ?? "";
      const cols = [...assignments.matchAll(/([a-z_]+)\s*=\s*\$\d+/g)].map(
        (m) => m[1],
      );
      const values = params.slice(0, cols.length);
      const [siteId, teamId] = params.slice(cols.length) as [string, string];
      const site = sites.find((s) => s.id === siteId && s.team_id === teamId);
      if (!site) return { rowCount: 0, rows: [] };
      cols.forEach((col, i) => {
        if (col === "label") site.label = values[i] as string | null;
        if (col === "github_repo") site.github_repo = values[i] as string | null;
        if (col === "public_status_slug")
          site.public_status_slug = values[i] as string | null;
      });
      return { rowCount: 1, rows: [{ ...site }] };
    }

    if (text.startsWith("delete from sites")) {
      const [siteId, teamId] = params as [string, string];
      const index = sites.findIndex(
        (s) => s.id === siteId && s.team_id === teamId,
      );
      if (index === -1) return { rowCount: 0, rows: [] };
      sites.splice(index, 1);
      return { rowCount: 1, rows: [] };
    }

    throw new Error(`Onverwachte query in test-fake: ${text}`);
  }

  const client = {
    query: async (sql: string, params: unknown[] = []) => handle(sql, params),
    release: () => {},
  } as unknown as PoolClient;

  const db = {
    connect: async () => client,
    query: async (sql: string, params: unknown[] = []) => handle(sql, params),
  } as unknown as Pool;

  return { db, client, sites, handle };
}

describe("createSite", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
  });

  it("slaat de URL canoniek op en canonicaliseert het GitHub-repo", async () => {
    const { site, created } = await createSite(state.db, {
      teamId: "team-1",
      url: "https://www.example.com/foo/",
      githubRepo: "Owner/Repo",
      label: "  Mijn site  ",
    });

    expect(created).toBe(true);
    expect(site.url).toBe("example.com/foo");
    expect(site.github_repo).toBe("owner/repo");
    expect(site.label).toBe("Mijn site");
    expect(state.sites).toHaveLength(1);
  });

  it("gooit een duplicate-fout als de canonieke URL al bestaat", async () => {
    state.sites.push(makeSite("site-1", "example.com", { team_id: "team-1" }));

    await expect(
      createSite(state.db, {
        teamId: "team-1",
        url: "https://www.example.com",
      }),
    ).rejects.toMatchObject({ code: "duplicate" });
    expect(state.sites).toHaveLength(1);
  });

  it("behandelt protocol- en www-varianten als duplicaat", async () => {
    state.sites.push(makeSite("site-1", "example.com", { team_id: "team-1" }));

    await expect(
      createSite(state.db, {
        teamId: "team-1",
        url: "http://example.com",
      }),
    ).rejects.toBeInstanceOf(SiteError);
  });

  it("geeft met reuse de bestaande site terug zonder te inserten", async () => {
    const existing = makeSite("site-1", "example.com", { team_id: "team-1" });
    state.sites.push(existing);

    const { site, created } = await createSite(state.db, {
      teamId: "team-1",
      url: "https://example.com",
      reuse: true,
    });

    expect(created).toBe(false);
    expect(site.id).toBe("site-1");
    expect(state.sites).toHaveLength(1);
  });

  it("detecteert een github.com-repo in het url-veld als het veld leeg is", async () => {
    const { site, created } = await createSite(state.db, {
      teamId: "team-1",
      url: "https://github.com/Owner/Repo",
    });

    expect(created).toBe(true);
    expect(site.github_repo).toBe("owner/repo");
  });

  it("laat een expliciet github_repo voorrang krijgen op url-detectie", async () => {
    const { site, created } = await createSite(state.db, {
      teamId: "team-1",
      url: "https://github.com/Owner/Repo",
      githubRepo: "Ander/Repo",
    });

    expect(created).toBe(true);
    expect(site.github_repo).toBe("ander/repo");
  });

  it("houdt een website-URL zonder repo op github_repo null", async () => {
    const { site, created } = await createSite(state.db, {
      teamId: "team-1",
      url: "https://www.example.com/foo",
    });

    expect(created).toBe(true);
    expect(site.github_repo).toBeNull();
  });

  it("laat duplicaten van een ander team met rust", async () => {
    state.sites.push(makeSite("site-1", "example.com", { team_id: "team-2" }));

    const { site, created } = await createSite(state.db, {
      teamId: "team-1",
      url: "https://example.com",
    });

    expect(created).toBe(true);
    expect(site.team_id).toBe("team-1");
    expect(state.sites).toHaveLength(2);
  });
});

describe("listSitesWithStatus", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
  });

  it("geeft alleen sites van het team terug, laatste scan eerst", async () => {
    const later = new Date("2026-08-15T12:00:00Z");
    const earlier = new Date("2026-08-14T12:00:00Z");
    state.sites.push(
      makeSite("a", "early.example.com", {
        team_id: "team-1",
        last_scanned_at: earlier,
      }),
      makeSite("b", "never.example.com", { team_id: "team-1" }),
      makeSite("c", "late.example.com", {
        team_id: "team-1",
        last_scanned_at: later,
      }),
      makeSite("d", "other.example.com", { team_id: "team-2" }),
    );

    const sites = await listSitesWithStatus(state.db, "team-1");

    expect(sites.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });
});

describe("updateSite", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
  });

  it("wijzigt label en github_repo", async () => {
    state.sites.push(makeSite("site-1", "example.com", { team_id: "team-1" }));

    const site = await updateSite(state.db, {
      teamId: "team-1",
      siteId: "site-1",
      label: "Nieuw label",
      githubRepo: "o/r",
    });

    expect(site.label).toBe("Nieuw label");
    expect(site.github_repo).toBe("o/r");
  });

  it("kan label en github_repo wissen met null", async () => {
    state.sites.push(
      makeSite("site-1", "example.com", {
        team_id: "team-1",
        label: "oud",
        github_repo: "o/r",
      }),
    );

    const site = await updateSite(state.db, {
      teamId: "team-1",
      siteId: "site-1",
      label: null,
      githubRepo: "",
    });

    expect(site.label).toBeNull();
    expect(site.github_repo).toBeNull();
  });

  it("gooit not_found voor een site van een ander team", async () => {
    state.sites.push(makeSite("site-1", "example.com", { team_id: "team-2" }));

    await expect(
      updateSite(state.db, {
        teamId: "team-1",
        siteId: "site-1",
        label: "x",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("genereert een slug bij 'publiek maken'", async () => {
    state.sites.push(makeSite("site-1", "example.com", { team_id: "team-1" }));

    const site = await updateSite(state.db, {
      teamId: "team-1",
      siteId: "site-1",
      publicStatus: { enabled: true },
    });

    expect(site.public_status_slug).toMatch(/^[0-9a-f]{16}$/);
  });

  it("behoudt een bestaande slug bij her-activeren", async () => {
    state.sites.push(
      makeSite("site-1", "example.com", {
        team_id: "team-1",
        public_status_slug: "abc123def4567890",
      }),
    );

    const site = await updateSite(state.db, {
      teamId: "team-1",
      siteId: "site-1",
      publicStatus: { enabled: true },
      currentSlug: "abc123def4567890",
    });

    expect(site.public_status_slug).toBe("abc123def4567890");
  });

  it("verwijdert de slug bij 'niet meer publiek'", async () => {
    state.sites.push(
      makeSite("site-1", "example.com", {
        team_id: "team-1",
        public_status_slug: "abc123def4567890",
      }),
    );

    const site = await updateSite(state.db, {
      teamId: "team-1",
      siteId: "site-1",
      publicStatus: { enabled: false },
    });

    expect(site.public_status_slug).toBeNull();
  });
});

describe("deleteSite", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
  });

  it("verwijdert de site van het eigen team", async () => {
    state.sites.push(makeSite("site-1", "example.com", { team_id: "team-1" }));

    const deleted = await deleteSite(state.db, {
      teamId: "team-1",
      siteId: "site-1",
    });

    expect(deleted).toBe(true);
    expect(state.sites).toHaveLength(0);
  });

  it("verwijdert niets voor een site van een ander team", async () => {
    state.sites.push(makeSite("site-1", "example.com", { team_id: "team-2" }));

    const deleted = await deleteSite(state.db, {
      teamId: "team-1",
      siteId: "site-1",
    });

    expect(deleted).toBe(false);
    expect(state.sites).toHaveLength(1);
  });
});

describe("setSiteScanState", () => {
  let state: ReturnType<typeof fakePool>;

  beforeEach(() => {
    state = fakePool();
  });

  it("werkt de denormaliseerde status-cache bij", async () => {
    state.sites.push(makeSite("site-1", "example.com", { team_id: "team-1" }));

    await setSiteScanState(state.client, "site-1", {
      scanId: "scan-1",
      status: "queued",
    });
    await setSiteScanState(state.client, "site-1", {
      scanId: "scan-1",
      status: "completed",
      score: 82,
    });

    const site = state.sites[0];
    expect(site.last_scan_id).toBe("scan-1");
    expect(site.last_scan_status).toBe("completed");
    expect(site.last_scan_score).toBe(82);
    expect(site.last_scanned_at).not.toBeNull();
  });

  it("laat een oude score staan bij een scan zonder score", async () => {
    state.sites.push(
      makeSite("site-1", "example.com", {
        team_id: "team-1",
        last_scan_score: 41,
      }),
    );

    await setSiteScanState(state.client, "site-1", {
      scanId: "scan-2",
      status: "queued",
    });

    expect(state.sites[0].last_scan_score).toBe(41);
  });
});
