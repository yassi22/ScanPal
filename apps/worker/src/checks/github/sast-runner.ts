import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Features 46–48 — SAST-runner infra (AGENTS.md: containers worden via Docker
 * aangeroepen met read-only mounts van de geclonede repo; geen secrets als
 * args). Deze module is de enige plek met child_process/fs; worker-checks
 * importeren `cloneRepo` + `runSastTool`, zodat tests de module mocken
 * (vergelijkbaar met `fetchPage` in `checks/types.ts`).
 *
 * Clone-strategie: shallow clone naar een tempdir; voor private repo's wordt
 * het GITHUB_TOKEN via `GIT_ASKPASS` (env, niet als arg) doorgegeven — het
 * token staat nooit in de proces-args van `git` of de tool-container. Het
 * askpass-script woont in een *andere* tempdir dan de clone-target: schrijven
 * in de targetdir zou `git clone` op een niet-lege dir laten falen.
 *
 * Containers (semgrep/gitleaks/osv) draaien gehard: `--network none`,
 * `--memory`/`--cpus`/`--pids-limit`-caps, `--security-opt no-new-privileges`
 * en `--cap-drop ALL` — de tool draait op aanvaller-beïnvloede repo-content,
 * dus network/DoS/supply-chain-risico op de worker-host wordt geminimaliseerd.
 */

export type CloneResult =
  | { ok: true; dir: string; cleanup: () => Promise<void> }
  | { ok: false; error: string };

export async function cloneRepo(
  repoUrl: string,
  opts: { timeoutMs?: number } = {},
): Promise<CloneResult> {
  let dir: string;
  let auxDir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "scanpal-sast-"));
  } catch (err) {
    return { ok: false, error: `tempdir mislukt: ${errMessage(err)}` };
  }

  try {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
    const token = process.env.GITHUB_TOKEN ?? process.env.GITHUB_PAT;
    if (token) {
      auxDir = await mkdtemp(join(tmpdir(), "scanpal-askpass-"));
      const askpass = join(auxDir, "askpass.sh");
      await writeFile(askpass, "#!/bin/sh\necho \"$GITHUB_TOKEN\"\n");
      await chmod(askpass, 0o700);
      env.GIT_ASKPASS = askpass;
      env.GITHUB_TOKEN = token;
    }
    await execFileAsync("git", ["clone", "--depth", "1", repoUrl, dir], {
      timeout: opts.timeoutMs ?? 60_000,
      env,
      maxBuffer: 4 * 1024 * 1024,
    });
    const cleanup = async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      if (auxDir) await rm(auxDir, { recursive: true, force: true }).catch(() => {});
    };
    return { ok: true, dir, cleanup };
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    if (auxDir) await rm(auxDir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, error: `git clone mislukt: ${errMessage(err)}` };
  }
}

/** Container-resource-caps voor tool-runs (hardening, plan 46-48). */
export const CONTAINER_LIMITS = {
  memory: "512m",
  cpus: "1",
  pidsLimit: 64,
} as const;

export type ToolRunResult =
  | { ok: true; stdout: string; stderr: string; exitCode: number }
  | { ok: false; error: string };

/**
 * Draait een SAST-tool in een geharde Docker-container met een read-only mount
 * van de geclonede repo op `/repo`. `args` bevatten geen secrets (alleen
 * tool-flags + het `/repo`-pad). Netwerk is standaard uit (`none`); tools die
 * een externe API nodig hebben (semgrep-registry, OSV-API) zetten expliciet
 * `network: "default"` — de rest blijft volledig geïsoleerd.
 */
export async function runSastTool(opts: {
  image: string;
  repoDir: string;
  args: string[];
  timeoutMs?: number;
  network?: "none" | "default";
}): Promise<ToolRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        opts.network ?? "none",
        "--memory",
        CONTAINER_LIMITS.memory,
        "--cpus",
        CONTAINER_LIMITS.cpus,
        "--pids-limit",
        String(CONTAINER_LIMITS.pidsLimit),
        "--security-opt",
        "no-new-privileges",
        "--cap-drop",
        "ALL",
        "-v",
        `${opts.repoDir}:/repo:ro`,
        opts.image,
        ...opts.args,
      ],
      { timeout: opts.timeoutMs ?? 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    return { ok: true, stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message?: string;
    };
    if (typeof e.code === "number") {
      // Non-zero exit: tools zoals semgrep/osv gebruiken dit bij gevonden
      // issues — stdout bevat alsnog de JSON. Behandel als ok.
      return {
        ok: true,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? "",
        exitCode: e.code,
      };
    }
    return { ok: false, error: `docker run mislukt: ${errMessage(err)}` };
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
