import { describe, expect, it } from "vitest";
import {
  deployWebhookSetupResponseSchema,
  githubDeploymentStatusPayloadSchema,
  githubDeploymentSucceeded,
  githubPushIsOnDefaultBranch,
  githubPushPayloadSchema,
  githubRepoMatches,
  githubWebhookEventSchema,
  vercelUrlMatchesSite,
  vercelWebhookSchema,
} from "../deploy-webhooks";

const PUSH = {
  ref: "refs/heads/main",
  repository: { full_name: "Owner/Repo", default_branch: "main" },
};

const DEPLOYMENT = {
  deployment_status: {
    state: "success",
    environment: "production",
  },
  repository: { full_name: "Owner/Repo" },
};

describe("githubWebhookEventSchema", () => {
  it("accepteert push en deployment_status", () => {
    expect(githubWebhookEventSchema.parse("push")).toBe("push");
    expect(githubWebhookEventSchema.parse("deployment_status")).toBe(
      "deployment_status",
    );
  });

  it("wijst onbekende events af", () => {
    expect(githubWebhookEventSchema.safeParse("ping").success).toBe(false);
    expect(githubWebhookEventSchema.safeParse("issues").success).toBe(false);
  });
});

describe("github schemas", () => {
  it("parset een push-payload", () => {
    const payload = githubPushPayloadSchema.parse(PUSH);
    expect(payload.repository.full_name).toBe("Owner/Repo");
  });

  it("wijst een push-payload zonder default_branch af", () => {
    expect(
      githubPushPayloadSchema.safeParse({ ref: "refs/heads/main", repository: { full_name: "a/b" } })
        .success,
    ).toBe(false);
  });

  it("parset een deployment_status-payload", () => {
    const payload = githubDeploymentStatusPayloadSchema.parse(DEPLOYMENT);
    expect(payload.deployment_status.state).toBe("success");
    expect(payload.deployment_status.environment).toBe("production");
  });

  it("laat environment weg als het ontbreekt", () => {
    const { deployment_status } = DEPLOYMENT;
    const payload = githubDeploymentStatusPayloadSchema.parse({
      deployment_status: { state: "success" },
      repository: { full_name: "a/b" },
    });
    expect(payload.deployment_status.environment).toBeUndefined();
    expect(deployment_status).toBeDefined();
  });
});

describe("vercelWebhookSchema", () => {
  it("parset een deployment.completed-payload", () => {
    const payload = vercelWebhookSchema.parse({
      type: "deployment.completed",
      payload: { project: { name: "myapp" }, url: "myapp.vercel.app" },
    });
    expect(payload.payload.project.name).toBe("myapp");
    expect(payload.payload.url).toBe("myapp.vercel.app");
  });

  it("wijst een ander type af", () => {
    expect(
      vercelWebhookSchema.safeParse({
        type: "deployment.created",
        payload: { project: { name: "x" }, url: "x.vercel.app" },
      }).success,
    ).toBe(false);
  });
});

describe("deployWebhookSetupResponseSchema", () => {
  it("accepteert url + secret", () => {
    const value = deployWebhookSetupResponseSchema.parse({
      url: "https://scanpal.dev/api/webhooks/github",
      secret: "geheim",
    });
    expect(value.secret).toBe("geheim");
  });

  it("wijst een leeg secret af", () => {
    expect(
      deployWebhookSetupResponseSchema.safeParse({ url: "https://x.dev", secret: "" })
        .success,
    ).toBe(false);
  });
});

describe("githubRepoMatches", () => {
  it("matcht case-insensitief", () => {
    expect(githubRepoMatches("Owner/Repo", "owner/repo")).toBe(true);
    expect(githubRepoMatches("OWNER/REPO", "owner/repo")).toBe(true);
  });

  it("wijst een andere repo af", () => {
    expect(githubRepoMatches("Owner/Repo", "owner/other")).toBe(false);
  });
});

describe("githubPushIsOnDefaultBranch", () => {
  it("accepteert de default branch", () => {
    expect(githubPushIsOnDefaultBranch(githubPushPayloadSchema.parse(PUSH))).toBe(true);
  });

  it("wijst andere branches/PR's af", () => {
    const payload = githubPushPayloadSchema.parse({
      ref: "refs/heads/feature/x",
      repository: { full_name: "a/b", default_branch: "main" },
    });
    expect(githubPushIsOnDefaultBranch(payload)).toBe(false);
  });
});

describe("githubDeploymentSucceeded", () => {
  it("accepteert state=success", () => {
    const payload = githubDeploymentStatusPayloadSchema.parse(DEPLOYMENT);
    expect(githubDeploymentSucceeded(payload)).toBe(true);
  });

  it("wijst failure/pending af", () => {
    for (const state of ["failure", "pending", "in_progress", "error"]) {
      const payload = githubDeploymentStatusPayloadSchema.parse({
        deployment_status: { state },
        repository: { full_name: "a/b" },
      });
      expect(githubDeploymentSucceeded(payload)).toBe(false);
    }
  });
});

describe("vercelUrlMatchesSite", () => {
  it("matcht een vercel.app-host op de site-URL", () => {
    expect(vercelUrlMatchesSite("myapp.vercel.app", "myapp.vercel.app")).toBe(true);
  });

  it("matcht met protocol en www", () => {
    expect(vercelUrlMatchesSite("https://www.example.com", "example.com")).toBe(true);
    expect(vercelUrlMatchesSite("www.example.com", "https://example.com")).toBe(true);
  });

  it("matcht case-insensitief", () => {
    expect(vercelUrlMatchesSite("MyApp.Vercel.App", "myapp.vercel.app")).toBe(true);
  });

  it("negeert een pad op de site-URL", () => {
    expect(vercelUrlMatchesSite("example.com", "example.com/shop")).toBe(true);
  });

  it("wijst een andere host af", () => {
    expect(vercelUrlMatchesSite("other.vercel.app", "myapp.vercel.app")).toBe(false);
  });

  it("wijst ongeldige urls af", () => {
    expect(vercelUrlMatchesSite("not a url", "example.com")).toBe(false);
    expect(vercelUrlMatchesSite("example.com", "not a url")).toBe(false);
  });
});