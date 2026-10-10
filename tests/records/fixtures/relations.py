"""Relation query protocol for snapshot doubles; native SQL is tested separately."""

import copy


def select_relations(values, *, kinds=None, from_refs=None, to_refs=None, include_body=True):
    def endpoint(edge, side, refs):
        return refs is not None and any(edge[side + "_id"] == identity and
                (revision is None or edge[side + "_revision"] == revision)
                for identity, revision in refs)

    selected = []
    for edge in values:
        if kinds is not None and edge["kind"] not in kinds:
            continue
        if any(value is not None for value in (from_refs, to_refs)) and not (
                endpoint(edge, "from", from_refs) or endpoint(edge, "to", to_refs)):
            continue
        selected.append({key: copy.deepcopy(value) for key, value in edge.items()
                         if include_body or key != "body"})
    return selected
