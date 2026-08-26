import copy
import math
import unittest

from app.config.defaults import DEFAULT_AHP_MATRIX
from app.services.ahp_service import calculate_ahp


class TestAHPService(unittest.TestCase):
    def test_default_matrix_matches_reference_results(self) -> None:
        result = calculate_ahp(DEFAULT_AHP_MATRIX)

        expected_column_sums = [
            2.783333333333333,
            3.0833333333333335,
            11.0,
            7.5,
            12.0,
        ]
        expected_weights = [
            0.37278175835062066,
            0.3127817583506206,
            0.09569543958765515,
            0.13456634642263382,
            0.08417469728846974,
        ]

        for actual, expected in zip(
            result["column_sums"], expected_column_sums, strict=True
        ):
            self.assertAlmostEqual(actual, expected, places=12)
        for actual, expected in zip(
            result["weights"], expected_weights, strict=True
        ):
            self.assertAlmostEqual(actual, expected, places=10)

        self.assertEqual(len(result["normalized_matrix"]), 5)
        for column in range(5):
            normalized_column_sum = sum(
                row[column] for row in result["normalized_matrix"]
            )
            self.assertAlmostEqual(normalized_column_sum, 1.0, places=12)

        self.assertAlmostEqual(result["lambda_max"], 5.069277703, places=8)
        self.assertAlmostEqual(
            result["consistency_index"], 0.017319426, places=8
        )
        self.assertEqual(result["random_index"], 1.12)
        self.assertAlmostEqual(
            result["consistency_ratio"], 0.015463773, places=8
        )
        self.assertEqual(result["status"], "ACCEPTABLE")

    def test_rejects_non_square_matrix(self) -> None:
        with self.assertRaisesRegex(ValueError, "must be square"):
            calculate_ahp([[1.0, 2.0], [0.5]])

    def test_perfectly_consistent_matrix_has_near_zero_consistency_ratio(self) -> None:
        priorities = [9.0, 6.0, 4.0, 2.0, 1.0]
        matrix = [
            [row_priority / column_priority for column_priority in priorities]
            for row_priority in priorities
        ]

        result = calculate_ahp(matrix)

        self.assertAlmostEqual(result["consistency_ratio"], 0.0, places=12)
        self.assertEqual(result["status"], "ACCEPTABLE")

    def test_rejects_square_matrix_that_is_not_five_by_five(self) -> None:
        with self.assertRaisesRegex(ValueError, "configured criteria"):
            calculate_ahp([[1.0, 1.0], [1.0, 1.0]])

    def test_rejects_non_positive_values(self) -> None:
        for invalid_value in (0.0, -1.0, math.inf, math.nan):
            with self.subTest(invalid_value=invalid_value):
                matrix = copy.deepcopy(DEFAULT_AHP_MATRIX)
                matrix[0][1] = invalid_value
                with self.assertRaisesRegex(ValueError, "must be positive"):
                    calculate_ahp(matrix)

    def test_rejects_diagonal_value_other_than_one(self) -> None:
        matrix = copy.deepcopy(DEFAULT_AHP_MATRIX)
        matrix[0][0] = 2.0

        with self.assertRaisesRegex(ValueError, "diagonal value"):
            calculate_ahp(matrix)

    def test_rejects_non_reciprocal_matrix(self) -> None:
        matrix = copy.deepcopy(DEFAULT_AHP_MATRIX)
        matrix[0][1] = 2.0

        with self.assertRaisesRegex(ValueError, "not reciprocal"):
            calculate_ahp(matrix)

    def test_marks_inconsistent_matrix_for_review(self) -> None:
        matrix = [[1.0 for _ in range(5)] for _ in range(5)]
        matrix[0][1] = 9.0
        matrix[1][0] = 1 / 9

        result = calculate_ahp(matrix)

        self.assertGreater(result["consistency_ratio"], 0.10)
        self.assertEqual(result["status"], "REVIEW REQUIRED")


if __name__ == "__main__":
    unittest.main()
