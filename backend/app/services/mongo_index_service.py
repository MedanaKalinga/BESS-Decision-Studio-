"""Small compatibility helpers for evolving MongoDB indexes safely."""

from __future__ import annotations

from typing import Any, Sequence


def ensure_compatible_index(
    collection: Any,
    keys: Sequence[tuple[str, int]],
    **options: object,
) -> object:
    """Reuse an existing index with identical keys before creating a new one.

    Legacy databases may have the same non-unique compound index with a
    different ``sparse`` option. Either variant supports project/job lookups,
    so retaining it avoids a destructive index migration during startup.
    """

    index_information = getattr(collection, "index_information", None)
    if callable(index_information):
        expected_keys = list(keys)
        for name, specification in index_information().items():
            if list(specification.get("key", [])) == expected_keys:
                return name
    return collection.create_index(list(keys), **options)
