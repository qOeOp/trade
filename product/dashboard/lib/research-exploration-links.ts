import type { ResearchReadbackExplorationV1 } from "./research-readback-gateway.ts";

export type ResearchExplorationLinksV1 = Readonly<{
  composerRun: string;
  exploratoryReplay: string;
}>;

// The two admitted routes an exploration's facts open, with exactly the query each route reads. The
// identities are the verified view's; nothing here derives one.
export function researchExplorationLinksV1(exploration: ResearchReadbackExplorationV1): ResearchExplorationLinksV1 {
  return {
    composerRun: `/rd/composer?${new URLSearchParams({ requestIdentity: exploration.composerRequestIdentity })}`,
    exploratoryReplay: `/backtest?${new URLSearchParams({
      replayRequestIdentity: exploration.replayRequestIdentity,
      meaningDigest: exploration.replayMeaningDigest,
    })}`,
  };
}
