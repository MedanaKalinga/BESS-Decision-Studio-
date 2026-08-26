import math
from collections.abc import Sequence
from typing import TypedDict


AHP_MATRIX_SIZE = 5
AHP_RANDOM_INDEX = 1.12
AHP_MAX_ACCEPTABLE_CR = 0.10
AHP_ABSOLUTE_TOLERANCE = 1e-8
AHP_RELATIVE_TOLERANCE = 1e-5


class AHPCalculationResult(TypedDict):
    column_sums: list[float]
    normalized_matrix: list[list[float]]
    weights: list[float]
    lambda_max: float
    consistency_index: float
    random_index: float
    consistency_ratio: float
    status: str


def _as_float_matrix(
    matrix: Sequence[Sequence[float]],
) -> list[list[float]]:
    if isinstance(matrix, (str, bytes)) or not isinstance(matrix, Sequence):
        raise ValueError("The AHP pairwise-comparison matrix must be square.")

    rows: list[list[float]] = []
    for row in matrix:
        if isinstance(row, (str, bytes)) or not isinstance(row, Sequence):
            raise ValueError("The AHP pairwise-comparison matrix must be square.")
        rows.append(list(row))

    size = len(rows)
    if size == 0 or any(len(row) != size for row in rows):
        raise ValueError("The AHP pairwise-comparison matrix must be square.")

    try:
        return [[float(value) for value in row] for row in rows]
    except (TypeError, ValueError) as exc:
        raise ValueError(
            "Every AHP pairwise-comparison value must be numeric."
        ) from exc


def validate_ahp_pairwise_matrix(
    matrix: Sequence[Sequence[float]],
) -> list[list[float]]:
    values = _as_float_matrix(matrix)

    if any(
        not math.isfinite(value) or value <= 0.0
        for row in values
        for value in row
    ):
        raise ValueError(
            "Every AHP pairwise-comparison value must be positive."
        )

    if any(
        not math.isclose(
            values[index][index],
            1.0,
            rel_tol=AHP_RELATIVE_TOLERANCE,
            abs_tol=AHP_ABSOLUTE_TOLERANCE,
        )
        for index in range(len(values))
    ):
        raise ValueError("Every diagonal value in the AHP matrix must equal 1.")

    if any(
        not math.isclose(
            values[row][column] * values[column][row],
            1.0,
            rel_tol=AHP_RELATIVE_TOLERANCE,
            abs_tol=AHP_ABSOLUTE_TOLERANCE,
        )
        for row in range(len(values))
        for column in range(len(values))
    ):
        raise ValueError(
            "The AHP matrix is not reciprocal. Each a_ij must satisfy "
            "a_ji = 1/a_ij."
        )

    return values


def calculate_ahp(
    pairwise_matrix: Sequence[Sequence[float]],
) -> AHPCalculationResult:
    matrix = validate_ahp_pairwise_matrix(pairwise_matrix)
    size = len(matrix)

    if size != AHP_MATRIX_SIZE:
        raise ValueError(
            "AHP matrix size does not match the number of configured criteria."
        )

    column_sums = [
        sum(matrix[row][column] for row in range(size))
        for column in range(size)
    ]
    normalized_matrix = [
        [
            matrix[row][column] / column_sums[column]
            for column in range(size)
        ]
        for row in range(size)
    ]

    weights = [sum(row) / size for row in normalized_matrix]
    weight_sum = sum(weights)
    weights = [weight / weight_sum for weight in weights]

    weighted_sum_vector = [
        sum(matrix[row][column] * weights[column] for column in range(size))
        for row in range(size)
    ]
    consistency_vector = [
        weighted_sum_vector[index] / weights[index]
        for index in range(size)
    ]
    lambda_max = sum(consistency_vector) / size
    consistency_index = (lambda_max - size) / (size - 1)
    consistency_ratio = consistency_index / AHP_RANDOM_INDEX
    status = (
        "ACCEPTABLE"
        if consistency_ratio <= AHP_MAX_ACCEPTABLE_CR
        else "REVIEW REQUIRED"
    )

    return {
        "column_sums": column_sums,
        "normalized_matrix": normalized_matrix,
        "weights": weights,
        "lambda_max": lambda_max,
        "consistency_index": consistency_index,
        "random_index": AHP_RANDOM_INDEX,
        "consistency_ratio": consistency_ratio,
        "status": status,
    }
