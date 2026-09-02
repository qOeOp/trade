use super::{
    CorrectionPolicyAuthenticatedInputsV1 as Inputs, CorrectionPolicyProjectionErrorV1 as Error,
    CorrectionPolicyProjectionV1 as Projection, codec,
};

fn nonzero(d: crate::owner::source_binding::BindingDigest) -> bool {
    d.as_bytes() != &[0; 32]
}

fn candidate(inputs: Inputs<'_>) -> Result<Projection, Error> {
    let c = inputs.coordinates.claim();
    let source = &c.source;
    let readback = inputs.source_binding;
    if !readback.is_admitted()
        || source.binding_identity != readback.binding_id()
        || source.binding_fact_digest != readback.fact_digest()
        || source.lineage_root != readback.lineage_root()
        || source.lineage_version != readback.lineage_version()
    {
        return Err(Error::DependencyMismatch);
    }
    if !nonzero(inputs.r0_coordinate_identity) || !nonzero(inputs.r0_coordinate_digest) {
        return Err(Error::DependencyMismatch);
    }
    if c.fact_clock.head_identity != c.pit.clock.head_identity
        || c.fact_clock.head_digest != c.pit.clock.head_digest
        || c.time.decision_cut != c.pit.decision_cut
    {
        return Err(Error::ClockCoordinateMismatch);
    }
    let mut p = Projection {
        stream_identity: c.correction.stream_identity.clone(),
        sequence: c.correction.sequence,
        successor_only: true,
        source_binding_identity: source.binding_identity,
        source_binding_fact_digest: source.binding_fact_digest,
        source_binding_lineage_root: source.lineage_root,
        source_binding_lineage_version: source.lineage_version,
        correction_frontier_digest: c.correction.digest,
        effective_from_ns: c.time.effective_from_ns,
        effective_until_ns: c.time.effective_until_ns,
        provider_available_ns: c.time.provider_available_ns,
        retrieval_ns: c.time.retrieval_ns,
        correction_publication_ns: c.time.correction_publication_ns,
        owner_observation_ns: c.time.owner_observation_ns,
        decision_cut: c.time.decision_cut,
        clock_head_identity: c.fact_clock.head_identity,
        clock_head_digest: c.fact_clock.head_digest,
        r0_coordinate_identity: inputs.r0_coordinate_identity,
        r0_coordinate_digest: inputs.r0_coordinate_digest,
        canonical_bytes: Box::new([]),
        identity: crate::owner::source_binding::BindingDigest::from_untrusted_bytes([0; 32]),
    };
    seal(&mut p)?;
    Ok(p)
}

fn seal(p: &mut Projection) -> Result<(), Error> {
    let bytes = codec::encode(p)?;
    p.identity = codec::identity(&bytes);
    p.canonical_bytes = bytes;
    Ok(())
}

pub(super) fn project_first_v1(inputs: Inputs<'_>) -> Result<Projection, Error> {
    let p = candidate(inputs)?;
    if p.source_binding_lineage_version != 1 || p.effective_until_ns.is_some() || p.sequence == 0 {
        return Err(Error::InvalidInput);
    }
    Ok(p)
}

pub(super) fn project_successor_v1(
    prior: &Projection,
    inputs: Inputs<'_>,
) -> Result<(Projection, Projection), Error> {
    join(prior, candidate(inputs)?)
}

fn join(prior: &Projection, mut next: Projection) -> Result<(Projection, Projection), Error> {
    if next.source_binding_lineage_root != prior.source_binding_lineage_root {
        return Err(Error::CrossSourceSplice);
    }
    if next.source_binding_identity != prior.source_binding_identity {
        return Err(Error::CrossSourceSplice);
    }
    if next.source_binding_lineage_version < prior.source_binding_lineage_version {
        return Err(Error::LineageRegression);
    }
    if next.source_binding_lineage_version == prior.source_binding_lineage_version {
        return Err(if next.stream_identity == prior.stream_identity {
            Error::LineageBranch
        } else {
            Error::StreamChanged
        });
    }
    if next.source_binding_lineage_version
        != prior
            .source_binding_lineage_version
            .checked_add(1)
            .ok_or(Error::LineageGap)?
    {
        return Err(Error::LineageGap);
    }
    if next.stream_identity != prior.stream_identity {
        return Err(Error::StreamChanged);
    }
    if next.sequence < prior.sequence {
        return Err(Error::FrontierRegression);
    }
    if next.sequence == prior.sequence {
        if next.correction_frontier_digest != prior.correction_frontier_digest {
            return Err(Error::LineageBranch);
        }
        next.effective_from_ns = prior.effective_from_ns;
        next.effective_until_ns = prior.effective_until_ns;
        next.provider_available_ns = prior.provider_available_ns;
        next.retrieval_ns = prior.retrieval_ns;
        next.correction_publication_ns = prior.correction_publication_ns;
        next.owner_observation_ns = prior.owner_observation_ns;
        next.decision_cut = prior.decision_cut;
        next.clock_head_identity = prior.clock_head_identity;
        next.clock_head_digest = prior.clock_head_digest;
        next.r0_coordinate_identity = prior.r0_coordinate_identity;
        next.r0_coordinate_digest = prior.r0_coordinate_digest;
        seal(&mut next)?;
        return Ok((next.clone(), next));
    }
    if next.sequence != prior.sequence.checked_add(1).ok_or(Error::FrontierGap)? {
        return Err(Error::FrontierGap);
    }
    if next.effective_from_ns <= prior.effective_from_ns || next.effective_until_ns.is_some() {
        return Err(Error::InvalidInterval);
    }
    let mut closed = prior.clone();
    closed.effective_until_ns = Some(next.effective_from_ns);
    seal(&mut closed)?;
    Ok((closed, next))
}

#[cfg(test)]
#[allow(clippy::too_many_arguments, reason = "compact exhaustive test fixture")]
pub(super) fn projection_for_test(
    lineage_root: u8,
    binding: u8,
    fact: u8,
    version: u64,
    stream: &[u8],
    sequence: u64,
    frontier: u8,
    from: i128,
) -> Projection {
    use crate::owner::source_binding::BindingDigest;
    let d = |v| BindingDigest::from_untrusted_bytes([v; 32]);
    let mut p = Projection {
        stream_identity: stream.into(),
        sequence,
        successor_only: true,
        source_binding_identity: d(binding),
        source_binding_fact_digest: d(fact),
        source_binding_lineage_root: d(lineage_root),
        source_binding_lineage_version: version,
        correction_frontier_digest: d(frontier),
        effective_from_ns: from,
        effective_until_ns: None,
        provider_available_ns: 10,
        retrieval_ns: 20,
        correction_publication_ns: 15,
        owner_observation_ns: 25,
        decision_cut: 30,
        clock_head_identity: d(8),
        clock_head_digest: d(9),
        r0_coordinate_identity: d(10),
        r0_coordinate_digest: d(11),
        canonical_bytes: Box::new([]),
        identity: d(0),
    };
    seal(&mut p).expect("valid test projection");
    p
}

#[cfg(test)]
pub(super) fn join_for_test(
    prior: &Projection,
    next: Projection,
) -> Result<(Projection, Projection), Error> {
    join(prior, next)
}

#[cfg(test)]
pub(super) fn first_for_test(p: Projection) -> Result<Projection, Error> {
    if p.source_binding_lineage_version != 1 || p.effective_until_ns.is_some() || p.sequence == 0 {
        Err(Error::InvalidInput)
    } else {
        Ok(p)
    }
}
