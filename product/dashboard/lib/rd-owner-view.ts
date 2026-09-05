const IDENTITY = /^[A-Za-z0-9._:/-]{1,192}$/;
const DIGEST = /^(?:sha256|blake3):[0-9a-f]{64}$/;

export type RdOwnerViewLocatorV1 = {
  schema_version: 1;
  source_owner: "source_intake_owner" | "research_owner" | "artifact_owner"
    | "formation_catalog_owner" | "iteration_decision_owner" | "exploratory_replay_owner"
    | "develop_composer_owner";
  href: string;
  action_label: "Resolve same identity" | "Open Owner catalog";
  identity_fields: Array<{ key: string; value: string }>;
};

export type RdOwnerViewRequestV1 =
  | { kind: "source"; sourceRequestIdentity: string }
  | { kind: "research"; requestIdentity: string }
  | { kind: "legacy_research"; requestIdentity: string }
  | { kind: "artifact"; researchRequestIdentity: string; buildRequestIdentity: string; attemptIdentity: string }
  | { kind: "decision"; trialFamilyIdentity: string }
  | { kind: "replay"; requestIdentity: string; meaningDigest: string }
  | { kind: "composer"; requestIdentity: string };

type InputField = { key: string; value: string };

function exactFields(fields: readonly InputField[], keys: readonly string[]): boolean {
  return fields.length === keys.length && fields.every((field, index) => (
    field.key === keys[index] && IDENTITY.test(field.value)
  ));
}

function query(pathname: string, fields: readonly InputField[]): string {
  const search = new URLSearchParams(fields.map(({ key, value }) => [key, value]));
  return `${pathname}?${search.toString()}`;
}

export function projectRdOwnerViewLocatorV1(
  operationId: string,
  fields: readonly InputField[],
): RdOwnerViewLocatorV1 | null {
  if (operationId === "source_intake.shadow_read.v1"
    && exactFields(fields, ["request_identity"])) {
    const identities = [{ key: "sourceRequestIdentity", value: fields[0].value }];
    return {
      schema_version: 1,
      source_owner: "source_intake_owner",
      href: query("/rd", identities),
      action_label: "Resolve same identity",
      identity_fields: fields.map(({ key, value }) => ({ key, value })),
    };
  }
  if (operationId === "research_goal.shadow_resolve.v1"
    && exactFields(fields, ["request_identity"])) {
    const identities = [{ key: "requestIdentity", value: fields[0].value }];
    return {
      schema_version: 1,
      source_owner: "research_owner",
      href: query("/rd/research", identities),
      action_label: "Resolve same identity",
      identity_fields: fields.map(({ key, value }) => ({ key, value })),
    };
  }
  if (operationId === "research_goal.legacy_quarantine_read.v1"
    && exactFields(fields, ["request_identity"])) {
    const identities = [{ key: "legacyV1RequestIdentity", value: fields[0].value }];
    return {
      schema_version: 1,
      source_owner: "research_owner",
      href: query("/rd/research", identities),
      action_label: "Resolve same identity",
      identity_fields: fields.map(({ key, value }) => ({ key, value })),
    };
  }
  if (operationId === "source_intake.research.submit_or_resolve.v1"
    && exactFields(fields, ["source_request_identity", "research_request_identity"])) {
    const identities = [{ key: "requestIdentity", value: fields[1].value }];
    return {
      schema_version: 1,
      source_owner: "research_owner",
      href: query("/rd/research", identities),
      action_label: "Resolve same identity",
      identity_fields: fields.map(({ key, value }) => ({ key, value })),
    };
  }
  if ((operationId === "artifact_build.shadow_resolve.v1"
    || operationId === "artifact_build.formation_execute.v1")
    && exactFields(fields, [
      "research_request_identity", "build_request_identity", "attempt_identity",
    ])) {
    const identities = [
      { key: "researchRequestIdentity", value: fields[0].value },
      { key: "buildRequestIdentity", value: fields[1].value },
      { key: "attemptIdentity", value: fields[2].value },
    ];
    return {
      schema_version: 1,
      source_owner: "artifact_owner",
      href: query("/rd/artifacts", identities),
      action_label: "Resolve same identity",
      identity_fields: fields.map(({ key, value }) => ({ key, value })),
    };
  }
  if (operationId === "rd_iteration_timeline.shadow_read.v1"
    && exactFields(fields, ["trial_family_identity"])) {
    const identities = [{ key: "trialFamilyIdentity", value: fields[0].value }];
    return {
      schema_version: 1,
      source_owner: "iteration_decision_owner",
      href: query("/rd/decisions", identities),
      action_label: "Resolve same identity",
      identity_fields: fields.map(({ key, value }) => ({ key, value })),
    };
  }
  if (operationId === "exploratory_replay.shadow_read.v2"
    && exactFields(fields, ["request_identity", "meaning_digest"])) {
    const identities = [
      { key: "replayRequestIdentity", value: fields[0].value },
      { key: "replayMeaningDigest", value: fields[1].value },
    ];
    return {
      schema_version: 1,
      source_owner: "exploratory_replay_owner",
      href: query("/rd/decisions", identities),
      action_label: "Resolve same identity",
      identity_fields: fields.map(({ key, value }) => ({ key, value })),
    };
  }
  if (operationId === "rd_formation_catalog.shadow_read.v1" && fields.length === 0) {
    return {
      schema_version: 1,
      source_owner: "formation_catalog_owner",
      href: "/rd/research",
      action_label: "Open Owner catalog",
      identity_fields: [],
    };
  }
  if (operationId === "develop_composer.shadow_read.v2"
    && exactFields(fields, ["request_identity"])) {
    const identities = [{ key: "requestIdentity", value: fields[0].value }];
    return {
      schema_version: 1,
      source_owner: "develop_composer_owner",
      href: query("/rd/composer", identities),
      action_label: "Resolve same identity",
      identity_fields: fields.map(({ key, value }) => ({ key, value })),
    };
  }
  return null;
}

type SearchParams = Record<string, string | string[] | undefined>;

function exactSearch(search: SearchParams, keys: readonly string[]): boolean {
  const actual = Object.keys(search).filter((key) => search[key] !== undefined).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    && keys.every((key) => typeof search[key] === "string" && IDENTITY.test(search[key] as string));
}

export function parseRdOwnerViewRequestV1(
  route: string,
  search: SearchParams,
): RdOwnerViewRequestV1 | null {
  if (route === "/rd" && exactSearch(search, ["sourceRequestIdentity"])) {
    return { kind: "source", sourceRequestIdentity: search.sourceRequestIdentity as string };
  }
  if ((route === "/rd/research" || route === "/rd/hypotheses")
    && exactSearch(search, ["requestIdentity"])) {
    return { kind: "research", requestIdentity: search.requestIdentity as string };
  }
  if (route === "/rd/research" && exactSearch(search, ["legacyV1RequestIdentity"])) {
    return { kind: "legacy_research", requestIdentity: search.legacyV1RequestIdentity as string };
  }
  if (route === "/rd/artifacts" && exactSearch(search, [
    "researchRequestIdentity", "buildRequestIdentity", "attemptIdentity",
  ])) {
    return {
      kind: "artifact",
      researchRequestIdentity: search.researchRequestIdentity as string,
      buildRequestIdentity: search.buildRequestIdentity as string,
      attemptIdentity: search.attemptIdentity as string,
    };
  }
  if (route === "/rd/decisions" && exactSearch(search, ["trialFamilyIdentity"])) {
    return { kind: "decision", trialFamilyIdentity: search.trialFamilyIdentity as string };
  }
  if (route === "/rd/decisions" && exactSearch(search, [
    "replayRequestIdentity", "replayMeaningDigest",
  ]) && DIGEST.test(search.replayMeaningDigest as string)) {
    return {
      kind: "replay",
      requestIdentity: search.replayRequestIdentity as string,
      meaningDigest: search.replayMeaningDigest as string,
    };
  }
  if (route === "/rd/composer" && exactSearch(search, ["requestIdentity"])) {
    return { kind: "composer", requestIdentity: search.requestIdentity as string };
  }
  return null;
}
