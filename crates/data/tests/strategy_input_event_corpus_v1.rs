use rstest::rstest;
use vibe_data::owner::{
    strategy_input_binding::StrategyInputBindingReceipt,
    strategy_input_event_corpus_v1::{
        StrategyInputEventCorpusCandidateV1, StrategyInputEventCorpusUnavailableV1,
        StrategyInputEventCorpusV1, StrategyInputEventSourceV1,
        issue_strategy_input_event_corpus_v1,
    },
};

type OwnerEventCorpusIssuerV1 =
    fn(
        StrategyInputEventSourceV1,
        &[StrategyInputBindingReceipt],
        Vec<StrategyInputEventCorpusCandidateV1>,
    ) -> Result<StrategyInputEventCorpusV1, StrategyInputEventCorpusUnavailableV1>;

fn accepts_move_only_corpus(_: impl FnOnce(StrategyInputEventCorpusV1)) {}

#[rstest]
fn public_seam_exposes_only_owner_validated_complete_corpus_issuance() {
    let issuer: OwnerEventCorpusIssuerV1 = issue_strategy_input_event_corpus_v1;
    let consumer = |corpus: StrategyInputEventCorpusV1| {
        let _count = corpus.expected_count();
        let _digest = corpus.digest();
    };

    let _owner_issuer = issuer;
    accepts_move_only_corpus(consumer);
}
