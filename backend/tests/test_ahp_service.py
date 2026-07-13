import copy
import math
import unittest

from app.config.defaults import DEFAULT_AHP_MATRIX
from app.services.ahp_service import calculate_ahp


class TestAHPService(unittest.TestCase):
    def test_default_matrix_matches_reference_results(self) -> None:
        result = calculate_ahp(DEFAULT_AHP_MATRIX)

        expected_column_sums = [
            3.033333333333333,
            3.5833333333333335,
            13.0,
            8.5,
            9.5,
            13.0,
        ]
        expected_weights = [
            0.345840266244903,
            0.2655036781683769,
            0.07938496931584987,
            0.11718407351642285,
            0.11260531893766827,
            0.07948169381677914,
        ]

        for actual, expected in zip(
            result["column_sums"], expected_column_sums, strict=True
        ):
            self.assertAlmostEqual(actual, expected, places=12)
        for actual, expected in zip(
            result["weights"], expected_weights, strict=True
        ):
            self.assertAlmostEqual(actual, expected, places=10)

        self.assertEqual(len(result["normalized_matrix"]), 6)
        for column in range(6):
            normalized_column_sum = sum(
                row[column] for row in result["normalized_matrix"]
            )
            self.assertAlmostEqual(normalized_column_sum, 1.0, places=12)

        self.assertAlmostEqual(result["lambda_max"], 6.124083002113046, places=10)
        self.assertAlmostEqual(
            result["consistency_index"], 0.024816600422609268, places=10
        )
        self.assertEqual(result["random_index"], 1.24)
        self.assertAlmostEqual(
            result["consistency_ratio"], 0.02001338743758812, places=10
        )
        self.assertEqual(result["status"], "ACCEPTABLE")

    def test_rejects_non_square_matrix(self) -> None:
        with self.assertRaisesRegex(ValueError, "must be square"):
            calculate_ahp([[1.0, 2.0], [0.5]])

    def test_rejects_square_matrix_that_is_not_six_by_six(self) -> None:
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
        matrix = [[1.0 for _ in range(6)] for _ in range(6)]
        matrix[0][1] = 9.0
        matrix[1][0] = 1 / 9

        result = calculate_ahp(matrix)

        self.assertGreater(result["consistency_ratio"], 0.10)
        self.assertEqual(result["status"], "REVIEW REQUIRED")


if __name__ == "__main__":
    unittest.main()
