"""Relation query protocol for snapshot doubles; native SQL is tested separately."""

import copy


def select_relations(values, *, kinds=None, from_refs=None, to_refs=None,
                     ids=None, scope_refs=None, include_body=True):
    def endpoint(edge, side, refs):
        return refs is not None and any(edge[side + "_id"] == identity and
                (revision is None or edge[side + "_revision"] == revision)
                for identity, revision in refs)

    def scoped(edge):
        scope = edge.get("body", {}).get("scope")
        if scope_refs is None or not isinstance(scope, dict):
            return False
        entries = scope.get("retained_research_decisions", [])
        for entry in entries:
            retained = entry.get("object_ref")
            for ref in scope_refs or ():
                if isinstance(ref, dict) and isinstance(retained, dict):
                    if all(retained.get(key) == value for key, value in ref.items()):
                        return True
                elif ref == retained:
                    return True
        return False

    selected = []
    for edge in values:
        if kinds is not None and edge["kind"] not in kinds or ids is not None and edge["id"] not in ids:
            continue
        if any(value is not None for value in (from_refs, to_refs, scope_refs)) and not (
                endpoint(edge, "from", from_refs) or endpoint(edge, "to", to_refs) or scoped(edge)):
            continue
        selected.append({key: copy.deepcopy(value) for key, value in edge.items()
                         if include_body or key != "body"})
    return selected
