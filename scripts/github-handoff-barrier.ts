import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export type RequiredCheck = {
  name: string;
  bucket: string;
  state: string;
  workflow: string;
};

export type ReviewBarrierSnapshot = {
  repository: string;
  pullRequest: number;
  head: string;
  base: string;
  state: string;
  isDraft: boolean;
  mergedAt: string | null;
  autoMergeArmed: boolean;
  pageComplete: boolean;
  triggers: Array<{
    id: string;
    login: string;
    body: string;
    createdAt: string;
    reactions: Array<{
      content: string;
      login: string;
      createdAt: string;
    }>;
  }>;
  reviews: Array<{
    id: string;
    login: string;
    state: string;
    submittedAt: string;
    commit: string;
  }>;
  threads: Array<{
    id: string;
    isResolved: boolean;
    isOutdated: boolean;
    comments: Array<{
      id: string;
      login: string;
      createdAt: string;
    }>;
  }>;
  requiredChecks: RequiredCheck[];
};

export type BarrierDecision =
  | { status: "ready"; fingerprint: string }
  | { status: "pending"; reason: string; fingerprint: string }
  | { status: "blocked"; reason: string; fingerprint: string }
  | { status: "merged"; fingerprint: string };

type BarrierExpectation = {
  repository: string;
  pullRequest: number;
  head: string;
  base: string;
  provider: string;
  triggerActor: string;
};

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type CommandRunner = (command: string, args: string[]) => CommandResult;

type WaitOptions = {
  expectation: BarrierExpectation;
  load: () => ReviewBarrierSnapshot;
  settleMs: number;
  timeoutMs: number;
  pollMs: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const MARKER_PREFIX = "trade-final-head-review";
const PASSING_CHECK_BUCKET = "pass";

function marker(head: string): string {
  return `<!-- ${MARKER_PREFIX}:${head} -->`;
}

export function triggerBody(head: string): string {
  return `@codex review\n\n${marker(head)}`;
}

function stableFingerprint(snapshot: ReviewBarrierSnapshot): string {
  const activity = {
    triggers: snapshot.triggers,
    reviews: snapshot.reviews,
    threads: snapshot.threads,
  };
  return createHash("sha256")
    .update(JSON.stringify(activity))
    .digest("hex");
}

function exactTrigger(
  snapshot: ReviewBarrierSnapshot,
  expectation: BarrierExpectation,
): ReviewBarrierSnapshot["triggers"] {
  const expectedMarker = marker(expectation.head);
  return snapshot.triggers.filter((trigger) =>
    trigger.login === expectation.triggerActor &&
    trigger.body.includes(expectedMarker),
  );
}

export function inspectBarrier(
  snapshot: ReviewBarrierSnapshot,
  expectation: BarrierExpectation,
): BarrierDecision {
  const fingerprint = stableFingerprint(snapshot);

  if (
    snapshot.repository !== expectation.repository ||
    snapshot.pullRequest !== expectation.pullRequest
  ) {
    return { status: "blocked", reason: "repository or PR changed", fingerprint };
  }
  if (snapshot.head !== expectation.head || snapshot.base !== expectation.base) {
    return { status: "blocked", reason: "head or base changed", fingerprint };
  }
  if (snapshot.mergedAt) {
    return { status: "merged", fingerprint };
  }
  if (snapshot.state !== "OPEN" || snapshot.isDraft) {
    return { status: "blocked", reason: "PR is not open and ready", fingerprint };
  }
  if (snapshot.autoMergeArmed) {
    return { status: "blocked", reason: "auto-merge is already armed", fingerprint };
  }
  if (!snapshot.pageComplete) {
    return { status: "blocked", reason: "GitHub activity is not fully paginated", fingerprint };
  }

  const triggers = exactTrigger(snapshot, expectation);
  if (triggers.length !== 1) {
    return {
      status: triggers.length === 0 ? "pending" : "blocked",
      reason:
        triggers.length === 0
          ? "exact-head Codex review has not been triggered"
          : "multiple exact-head Codex triggers are ambiguous",
      fingerprint,
    };
  }

  const trigger = triggers[0]!;
  const reviews = snapshot.reviews.filter(
    (review) =>
      review.login === expectation.provider &&
      review.commit === expectation.head &&
      review.submittedAt > trigger.createdAt,
  );
  const thumbsUp = trigger.reactions.filter(
    (reaction) =>
      reaction.login === expectation.provider &&
      reaction.content === "THUMBS_UP" &&
      reaction.createdAt > trigger.createdAt,
  );
  const terminalSignals = reviews.length + thumbsUp.length;

  if (terminalSignals === 0) {
    return {
      status: "pending",
      reason: "exact-head Codex review is still outstanding",
      fingerprint,
    };
  }
  if (terminalSignals !== 1) {
    return {
      status: "blocked",
      reason: "Codex review completion is ambiguous",
      fingerprint,
    };
  }

  const unresolved = snapshot.threads.filter((thread) => !thread.isResolved);
  if (unresolved.length > 0) {
    return {
      status: "blocked",
      reason: `${unresolved.length} review thread(s) remain unresolved`,
      fingerprint,
    };
  }

  if (snapshot.requiredChecks.length === 0) {
    return {
      status: "pending",
      reason: "required checks are not available",
      fingerprint,
    };
  }
  const failedChecks = snapshot.requiredChecks.filter((check) =>
    ["fail", "cancel"].includes(check.bucket),
  );
  if (failedChecks.length > 0) {
    return {
      status: "blocked",
      reason: `required check failed: ${failedChecks.map((check) => check.name).join(", ")}`,
      fingerprint,
    };
  }
  if (
    snapshot.requiredChecks.some(
      (check) => check.bucket !== PASSING_CHECK_BUCKET,
    )
  ) {
    return {
      status: "pending",
      reason: "required checks are still pending",
      fingerprint,
    };
  }

  return { status: "ready", fingerprint };
}

export async function waitForBarrier({
  expectation,
  load,
  settleMs,
  timeoutMs,
  pollMs,
  now = Date.now,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
}: WaitOptions): Promise<BarrierDecision> {
  const deadline = now() + timeoutMs;
  let settledFingerprint = "";
  let settledSince = 0;

  while (now() <= deadline) {
    const decision = inspectBarrier(load(), expectation);
    if (decision.status === "blocked" || decision.status === "merged") {
      return decision;
    }
    if (decision.status === "ready") {
      if (decision.fingerprint !== settledFingerprint) {
        settledFingerprint = decision.fingerprint;
        settledSince = now();
      } else if (now() - settledSince >= settleMs) {
        return decision;
      }
    } else {
      settledFingerprint = "";
      settledSince = 0;
    }
    await sleep(pollMs);
  }

  return {
    status: "pending",
    reason: "review barrier timed out",
    fingerprint: settledFingerprint,
  };
}

export function mergeArguments(
  expectation: BarrierExpectation,
): string[] {
  return [
    "pr",
    "merge",
    "--repo",
    expectation.repository,
    "--auto",
    "--squash",
    "--match-head-commit",
    expectation.head,
    String(expectation.pullRequest),
  ];
}

const defaultRun: CommandRunner = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

function requireSuccess(result: CommandResult, description: string): string {
  if (result.status !== 0) {
    throw new Error(
      `${description} failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result.stdout;
}

function readRequiredChecks(
  expectation: BarrierExpectation,
  run: CommandRunner,
): RequiredCheck[] {
  const result = run("gh", [
    "pr",
    "checks",
    String(expectation.pullRequest),
    "--repo",
    expectation.repository,
    "--required",
    "--json",
    "name,state,bucket,workflow",
  ]);
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) {
      throw new Error("required checks response is not an array");
    }
    return parsed as RequiredCheck[];
  } catch (error) {
    throw new Error(
      `required checks could not be read: ${result.stderr.trim() || String(error)}`,
      { cause: error },
    );
  }
}

const SNAPSHOT_QUERY = `
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      number
      headRefOid
      baseRefOid
      state
      isDraft
      mergedAt
      autoMergeRequest{enabledAt}
      comments(first:100){
        pageInfo{hasNextPage}
        nodes{
          id body createdAt author{login}
          reactions(first:100){
            pageInfo{hasNextPage}
            nodes{content createdAt user{login}}
          }
        }
      }
      reviews(first:100){
        pageInfo{hasNextPage}
        nodes{id state submittedAt author{login} commit{oid}}
      }
      reviewThreads(first:100){
        pageInfo{hasNextPage}
        nodes{
          id isResolved isOutdated
          comments(first:100){
            pageInfo{hasNextPage}
            nodes{id createdAt author{login}}
          }
        }
      }
    }
  }
}`;

type GraphPage<T> = {
  pageInfo: { hasNextPage: boolean };
  nodes: T[];
};

type GraphPullRequest = {
  number: number;
  headRefOid: string;
  baseRefOid: string;
  state: string;
  isDraft: boolean;
  mergedAt: string | null;
  autoMergeRequest: { enabledAt: string } | null;
  comments: GraphPage<{
    id: string;
    body: string;
    createdAt: string;
    author: { login: string } | null;
    reactions: GraphPage<{
      content: string;
      createdAt: string;
      user: { login: string } | null;
    }>;
  }>;
  reviews: GraphPage<{
    id: string;
    state: string;
    submittedAt: string;
    author: { login: string } | null;
    commit: { oid: string } | null;
  }>;
  reviewThreads: GraphPage<{
    id: string;
    isResolved: boolean;
    isOutdated: boolean;
    comments: GraphPage<{
      id: string;
      createdAt: string;
      author: { login: string } | null;
    }>;
  }>;
};

type GraphResponse = {
  data?: {
    repository?: {
      pullRequest?: GraphPullRequest | null;
    } | null;
  };
};

function splitRepository(repository: string): [string, string] {
  const [owner, name, extra] = repository.split("/");
  if (!owner || !name || extra) {
    throw new Error("--repo must be owner/name");
  }
  return [owner, name];
}

export function loadSnapshot(
  expectation: BarrierExpectation,
  run: CommandRunner = defaultRun,
): ReviewBarrierSnapshot {
  const [owner, name] = splitRepository(expectation.repository);
  const output = requireSuccess(
    run("gh", [
      "api",
      "graphql",
      "-f",
      `query=${SNAPSHOT_QUERY}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `number=${expectation.pullRequest}`,
    ]),
    "GitHub snapshot",
  );
  const response = JSON.parse(output) as GraphResponse;
  const pullRequest = response.data?.repository?.pullRequest;
  if (!pullRequest) {
    throw new Error("pull request was not found");
  }

  const comments = pullRequest.comments;
  const reviews = pullRequest.reviews;
  const threads = pullRequest.reviewThreads;
  const triggerNodes = comments.nodes;
  const threadNodes = threads.nodes;
  const pageComplete =
    !comments.pageInfo?.hasNextPage &&
    !reviews.pageInfo?.hasNextPage &&
    !threads.pageInfo?.hasNextPage &&
    triggerNodes.every(
      (comment) => !comment.reactions?.pageInfo?.hasNextPage,
    ) &&
    threadNodes.every(
      (thread) => !thread.comments?.pageInfo?.hasNextPage,
    );

  return {
    repository: expectation.repository,
    pullRequest: pullRequest.number,
    head: pullRequest.headRefOid,
    base: pullRequest.baseRefOid,
    state: pullRequest.state,
    isDraft: pullRequest.isDraft,
    mergedAt: pullRequest.mergedAt,
    autoMergeArmed: pullRequest.autoMergeRequest !== null,
    pageComplete,
    triggers: triggerNodes.map((comment) => ({
      id: comment.id,
      login: comment.author?.login ?? "",
      body: comment.body,
      createdAt: comment.createdAt,
      reactions: comment.reactions.nodes.map((reaction) => ({
          content: reaction.content,
          login: reaction.user?.login ?? "",
          createdAt: reaction.createdAt,
        })),
    })),
    reviews: reviews.nodes.map((review) => ({
      id: review.id,
      login: review.author?.login ?? "",
      state: review.state,
      submittedAt: review.submittedAt,
      commit: review.commit?.oid ?? "",
    })),
    threads: threadNodes.map((thread) => ({
      id: thread.id,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      comments: thread.comments.nodes.map((comment) => ({
          id: comment.id,
          login: comment.author?.login ?? "",
          createdAt: comment.createdAt,
        })),
    })),
    requiredChecks: readRequiredChecks(expectation, run),
  };
}

function postTrigger(
  expectation: BarrierExpectation,
  run: CommandRunner,
): void {
  const snapshot = loadSnapshot(expectation, run);
  const decision = inspectBarrier(snapshot, expectation);
  if (decision.status === "merged") {
    return;
  }
  if (
    snapshot.head !== expectation.head ||
    snapshot.base !== expectation.base ||
    snapshot.state !== "OPEN" ||
    snapshot.isDraft ||
    snapshot.autoMergeArmed ||
    !snapshot.pageComplete ||
    snapshot.threads.some((thread) => !thread.isResolved)
  ) {
    throw new Error(`cannot trigger Codex review: ${decision.status} ${"reason" in decision ? decision.reason : ""}`);
  }

  const existing = exactTrigger(snapshot, expectation);
  if (existing.length === 1) {
    return;
  }
  if (existing.length > 1) {
    throw new Error("multiple exact-head Codex triggers are ambiguous");
  }

  requireSuccess(
    run("gh", [
      "api",
      `repos/${expectation.repository}/issues/${expectation.pullRequest}/comments`,
      "-f",
      `body=${triggerBody(expectation.head)}`,
    ]),
    "Codex review trigger",
  );
}

function parseArguments(arguments_: string[]): {
  expectation: BarrierExpectation;
  settleMs: number;
  timeoutMs: number;
  pollMs: number;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument: ${key ?? ""}`);
    }
    values.set(key.slice(2), value);
  }

  const repository = values.get("repo") ?? "";
  const pullRequest = Number(values.get("pr"));
  const head = values.get("head") ?? "";
  const base = values.get("base") ?? "";
  if (
    !repository ||
    !Number.isSafeInteger(pullRequest) ||
    pullRequest < 1 ||
    !/^[0-9a-f]{40}$/.test(head) ||
    !/^[0-9a-f]{40}$/.test(base)
  ) {
    throw new Error("--repo, --pr, --head and --base are required");
  }
  const settleMs = Number(values.get("settle-seconds") ?? "30") * 1000;
  const timeoutMs = Number(values.get("timeout-seconds") ?? "900") * 1000;
  const pollMs = Number(values.get("poll-seconds") ?? "10") * 1000;
  if (
    !Number.isFinite(settleMs) ||
    !Number.isFinite(timeoutMs) ||
    !Number.isFinite(pollMs) ||
    settleMs < 0 ||
    timeoutMs <= 0 ||
    pollMs <= 0
  ) {
    throw new Error("settle, timeout and poll seconds must be finite bounds");
  }

  return {
    expectation: {
      repository,
      pullRequest,
      head,
      base,
      provider: values.get("provider") ?? "chatgpt-codex-connector",
      triggerActor:
        values.get("actor") ??
        requireSuccess(
          defaultRun("gh", ["api", "user", "--jq", ".login"]),
          "GitHub actor lookup",
        ).trim(),
    },
    settleMs,
    timeoutMs,
    pollMs,
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  postTrigger(options.expectation, defaultRun);
  const decision = await waitForBarrier({
    ...options,
    load: () => loadSnapshot(options.expectation),
  });

  if (decision.status === "merged") {
    console.log(JSON.stringify(decision));
    return;
  }
  if (decision.status !== "ready") {
    console.error(JSON.stringify(decision));
    process.exitCode = decision.status === "blocked" ? 2 : 3;
    return;
  }

  const finalSnapshot = loadSnapshot(options.expectation);
  const finalDecision = inspectBarrier(finalSnapshot, options.expectation);
  if (
    finalDecision.status !== "ready" ||
    finalDecision.fingerprint !== decision.fingerprint
  ) {
    console.error(
      JSON.stringify({
        status: "blocked",
        reason: "activity changed during final refetch",
        fingerprint: finalDecision.fingerprint,
      }),
    );
    process.exitCode = 2;
    return;
  }

  requireSuccess(
    defaultRun("gh", mergeArguments(options.expectation)),
    "guarded auto-merge",
  );
  console.log(
    JSON.stringify({
      status: "merge-requested",
      head: options.expectation.head,
      base: options.expectation.base,
      fingerprint: decision.fingerprint,
    }),
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  }
}
