import ast
from pathlib import Path
import unittest

from app.services.promethee_service import type_iii_preference


REFERENCE_V2 = (
    Path(__file__).resolve().parents[2]
    / "scientific_reference"
    / "bess_ga_ahp_promethee_v2.py"
)


def load_preference_linear():
    """Load only the copied preference function without executing the full script."""
    source = REFERENCE_V2.read_text(encoding="utf-8")
    module = ast.parse(source, filename=str(REFERENCE_V2))
    function = next(
        node
        for node in module.body
        if isinstance(node, ast.FunctionDef) and node.name == "preference_linear"
    )
    namespace: dict[str, object] = {}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(REFERENCE_V2), "exec"), namespace)
    return namespace["preference_linear"]


class TestPrometheeTypeThreePreference(unittest.TestCase):
    def test_v_shape_preferences_span_the_full_observed_range(self) -> None:
        preference = load_preference_linear()
        p = 20.0

        self.assertEqual(preference(0.0, 0.0, p), 0.0)
        self.assertEqual(preference(0.25 * p, 0.0, p), 0.25)
        self.assertEqual(preference(0.50 * p, 0.0, p), 0.50)
        self.assertEqual(preference(p, 0.0, p), 1.0)
        self.assertEqual(preference(-1.0, 0.0, p), 0.0)
        for difference in (-1.0, 0.0, 0.25 * p, 0.50 * p, p, 2 * p):
            self.assertEqual(
                type_iii_preference(difference, p),
                preference(difference, 0.0, p),
            )
        self.assertEqual(type_iii_preference(1.0, 0.0), 0.0)


if __name__ == "__main__":
    unittest.main()
