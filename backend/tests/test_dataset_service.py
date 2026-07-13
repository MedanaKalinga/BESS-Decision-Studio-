import csv
import unittest
from datetime import datetime, timedelta
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from app.main import app
from app.services.dataset_service import (
    DatasetDateError,
    DatasetDateNotFoundError,
    DatasetFileError,
    DatasetNotFoundError,
    DatasetUploadTooLargeError,
    DatasetValidationError,
    MAX_UPLOAD_BYTES,
    NO_TIMESTAMP_NOTICE,
    get_dataset_day,
    parse_and_validate_csv,
    validate_and_store_dataset,
)


def make_annual_csv() -> bytes:
    output = StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["timestamp", "P_PV_kW", "P_EV_kW", "tariff_Rs_per_kWh"])
    timestamp = datetime(2025, 1, 1)
    for index in range(35040):
        writer.writerow(
            [
                (timestamp + timedelta(minutes=15 * index)).isoformat(),
                "2.0",
                "1.0",
                "25.0",
            ]
        )
    return output.getvalue().encode("utf-8")


def make_csv(rows: list[list[str]], header: list[str] | None = None) -> bytes:
    output = StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(header or ["timestamp", "PV_kW", "EV_kW"])
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def make_timestampless_csv(
    row_count: int,
    header: list[str] | None = None,
) -> bytes:
    output = StringIO(newline="")
    writer = csv.writer(output)
    selected_header = header or ["PV_kW", "EV_kW"]
    writer.writerow(selected_header)
    for index in range(row_count):
        values = {
            "PV_kW": str(1 + index % 3),
            "EV_kW": str(2 + index % 2),
            "Solar Output": str(index % 5),
            "Charging Load": str(index % 4),
            "Rate": "24.5",
        }
        writer.writerow([values[column] for column in selected_header])
    return output.getvalue().encode("utf-8")


def error_codes(content: bytes) -> set[str]:
    with unittest.TestCase().assertRaises(DatasetValidationError) as context:
        parse_and_validate_csv(content)
    return {
        str(issue["code"])
        for issue in context.exception.validation_summary["errors"]
    }


class TestDatasetService(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.annual_csv = make_annual_csv()

    def test_valid_annual_dataset_is_stored_and_summarized(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            storage_dir = Path(temporary_directory)
            response = validate_and_store_dataset(
                self.annual_csv,
                "annual-profile.csv",
                storage_dir,
            )

            self.assertEqual(response["filename"], "annual-profile.csv")
            validation = response["validation_summary"]
            self.assertTrue(validation["valid"])
            self.assertEqual(validation["row_count"], 35040)
            self.assertEqual(validation["interval_minutes"], 15)
            self.assertEqual(validation["dataset_type"], "normal_year")
            self.assertEqual(validation["duration_days"], 365)
            self.assertFalse(validation["timestamps_generated"])
            self.assertEqual(validation["timestamp_source"], "uploaded")
            self.assertEqual(
                validation["detected_columns"],
                {
                    "timestamp": "timestamp",
                    "pv": "P_PV_kW",
                    "ev": "P_EV_kW",
                    "tariff": "tariff_Rs_per_kWh",
                },
            )

            summary = response["summary"]
            self.assertAlmostEqual(summary["annual_pv_energy_kwh"], 17520.0)
            self.assertAlmostEqual(summary["annual_ev_energy_kwh"], 8760.0)
            self.assertEqual(summary["pv_peak_kw"], 2.0)
            self.assertEqual(summary["ev_peak_kw"], 1.0)
            self.assertEqual(summary["start_date"], "2025-01-01")
            self.assertEqual(summary["end_date"], "2025-12-31")

            dataset_id = response["dataset_id"]
            self.assertTrue((storage_dir / f"{dataset_id}.csv").is_file())
            self.assertTrue((storage_dir / f"{dataset_id}.json").is_file())

    def test_day_explorer_returns_96_points_and_daily_metrics(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            storage_dir = Path(temporary_directory)
            upload = validate_and_store_dataset(
                self.annual_csv,
                "annual.csv",
                storage_dir,
            )

            result = get_dataset_day(
                str(upload["dataset_id"]),
                "2025-06-15",
                storage_dir,
            )

            self.assertEqual(len(result["points"]), 96)
            self.assertEqual(result["interval_minutes"], 15)
            self.assertAlmostEqual(result["summary"]["pv_energy_kwh"], 48.0)
            self.assertAlmostEqual(result["summary"]["ev_energy_kwh"], 24.0)
            self.assertAlmostEqual(result["summary"]["surplus_energy_kwh"], 24.0)
            self.assertAlmostEqual(result["summary"]["deficit_energy_kwh"], 0.0)
            self.assertEqual(result["summary"]["pv_peak_kw"], 2.0)
            self.assertEqual(result["summary"]["ev_peak_kw"], 1.0)
            self.assertEqual(result["points"][0]["tariff_rs_per_kwh"], 25.0)

    def test_missing_timestamp_requires_explicit_confirmation(self) -> None:
        content = make_csv(
            [["0", "0"]],
            header=["PV_kW", "EV_kW"],
        )
        with self.assertRaises(DatasetValidationError) as context:
            parse_and_validate_csv(content)

        validation = context.exception.validation_summary
        codes = {str(issue["code"]) for issue in validation["errors"]}
        self.assertIn("TIMESTAMP_CONFIRMATION_REQUIRED", codes)
        self.assertNotIn("MISSING_COLUMN", codes)
        self.assertEqual(validation["notice"], NO_TIMESTAMP_NOTICE)
        self.assertEqual(validation["available_columns"], ["PV_kW", "EV_kW"])

    def test_rejects_missing_pv_or_ev_column(self) -> None:
        content = make_csv(
            [["2025-01-01T00:00:00", "0"]],
            header=["timestamp", "PV_kW"],
        )
        self.assertIn("MISSING_COLUMN", error_codes(content))

    def test_accepts_whitespace_padded_reference_headers(self) -> None:
        content = self.annual_csv.replace(
            b"timestamp,P_PV_kW,P_EV_kW,tariff_Rs_per_kWh",
            b" timestamp , P_PV_kW , P_EV_kW , tariff_Rs_per_kWh ",
            1,
        )
        _, validation, _ = parse_and_validate_csv(content)

        self.assertTrue(validation["valid"])
        self.assertEqual(validation["detected_columns"]["timestamp"], " timestamp ")

    def test_rejects_duplicate_headers(self) -> None:
        content = make_csv(
            [["2025-01-01T00:00:00", "1", "2", "3"]],
            header=["timestamp", "PV", "PV", "EV"],
        )
        self.assertIn("DUPLICATE_HEADER", error_codes(content))

    def test_rejects_missing_and_non_numeric_values(self) -> None:
        content = make_csv(
            [
                ["2025-01-01T00:00:00", "", "1"],
                ["2025-01-01T00:15:00", "2", "not-a-number"],
            ]
        )
        codes = error_codes(content)
        self.assertIn("MISSING_VALUE", codes)
        self.assertIn("NON_NUMERIC_VALUE", codes)

    def test_rejects_duplicate_and_non_15_minute_timestamps(self) -> None:
        duplicate = make_csv(
            [
                ["2025-01-01T00:00:00", "0", "1"],
                ["2025-01-01T00:00:00", "0", "1"],
            ]
        )
        invalid_interval = make_csv(
            [
                ["2025-01-01T00:00:00", "0", "1"],
                ["2025-01-01T00:30:00", "0", "1"],
            ]
        )

        duplicate_codes = error_codes(duplicate)
        self.assertIn("DUPLICATE_TIMESTAMP", duplicate_codes)
        self.assertIn("INVALID_INTERVAL", duplicate_codes)
        self.assertIn("INVALID_INTERVAL", error_codes(invalid_interval))

    def test_rejects_negative_pv_and_ev_values(self) -> None:
        content = make_csv(
            [["2025-01-01T00:00:00", "-0.1", "-1"]]
        )
        with self.assertRaises(DatasetValidationError) as context:
            parse_and_validate_csv(content)

        summary = context.exception.validation_summary
        self.assertEqual(summary["negative_pv_values"], 1)
        self.assertEqual(summary["negative_ev_values"], 1)
        self.assertIn("NEGATIVE_VALUE", {e["code"] for e in summary["errors"]})

    def test_rejects_invalid_row_count(self) -> None:
        content = make_csv(
            [["2025-01-01T00:00:00", "0", "1"]]
        )
        self.assertIn("INVALID_ROW_COUNT", error_codes(content))

    def test_generated_partial_dataset_preserves_order_and_day_lookup(self) -> None:
        content = make_timestampless_csv(192)
        with TemporaryDirectory() as temporary_directory:
            storage_dir = Path(temporary_directory)
            upload = validate_and_store_dataset(
                content,
                "partial.csv",
                storage_dir,
                start_date="2025-04-02",
                generate_timestamps=True,
            )

            validation = upload["validation_summary"]
            self.assertTrue(validation["valid"])
            self.assertEqual(validation["dataset_type"], "partial")
            self.assertEqual(validation["duration_days"], 2)
            self.assertTrue(validation["timestamps_generated"])
            self.assertEqual(validation["timestamp_source"], "generated")
            self.assertEqual(validation["notice"], NO_TIMESTAMP_NOTICE)
            self.assertIsNone(validation["detected_columns"]["timestamp"])
            self.assertEqual(upload["summary"]["start_date"], "2025-04-02")
            self.assertEqual(upload["summary"]["end_date"], "2025-04-03")

            result = get_dataset_day(
                str(upload["dataset_id"]), "2025-04-03", storage_dir
            )
            self.assertEqual(len(result["points"]), 96)
            self.assertEqual(
                result["points"][0]["timestamp"], "2025-04-03T00:00:00"
            )
            self.assertEqual(result["points"][0]["pv_kw"], 1.0)
            self.assertEqual(result["points"][1]["pv_kw"], 2.0)

            stored_header = (storage_dir / f'{upload["dataset_id"]}.csv').read_text(
                encoding="utf-8"
            ).splitlines()[0]
            self.assertEqual(stored_header, "PV_kW,EV_kW")

    def test_manual_mapping_uses_exact_headers_and_optional_tariff(self) -> None:
        content = make_timestampless_csv(
            96, ["Solar Output", "Charging Load", "Rate"]
        )
        with TemporaryDirectory() as temporary_directory:
            storage_dir = Path(temporary_directory)
            upload = validate_and_store_dataset(
                content,
                "manual.csv",
                storage_dir,
                use_manual_mapping=True,
                pv_column="Solar Output",
                ev_column="Charging Load",
                tariff_column="Rate",
                timestamp_column=None,
                start_date="2025-05-01",
                generate_timestamps=True,
            )
            self.assertEqual(
                upload["validation_summary"]["detected_columns"],
                {
                    "timestamp": None,
                    "pv": "Solar Output",
                    "ev": "Charging Load",
                    "tariff": "Rate",
                },
            )
            day = get_dataset_day(
                str(upload["dataset_id"]), "2025-05-01", storage_dir
            )
            self.assertEqual(day["points"][0]["pv_kw"], 0.0)
            self.assertEqual(day["points"][1]["pv_kw"], 1.0)
            self.assertEqual(day["points"][0]["tariff_rs_per_kwh"], 24.5)

    def test_manual_mapping_rejects_unknown_or_duplicate_columns(self) -> None:
        content = make_timestampless_csv(96)
        with self.assertRaises(DatasetValidationError) as unknown_context:
            parse_and_validate_csv(
                content,
                use_manual_mapping=True,
                pv_column="missing",
                ev_column="EV_kW",
                start_date="2025-01-01",
                generate_timestamps=True,
            )
        unknown_codes = {
            issue["code"]
            for issue in unknown_context.exception.validation_summary["errors"]
        }
        self.assertIn("INVALID_COLUMN_MAPPING", unknown_codes)

        with self.assertRaises(DatasetValidationError) as duplicate_context:
            parse_and_validate_csv(
                content,
                use_manual_mapping=True,
                pv_column="PV_kW",
                ev_column="PV_kW",
                start_date="2025-01-01",
                generate_timestamps=True,
            )
        duplicate_codes = {
            issue["code"]
            for issue in duplicate_context.exception.validation_summary["errors"]
        }
        self.assertIn("DUPLICATE_COLUMN_MAPPING", duplicate_codes)

    def test_timestamp_generation_requires_strict_start_date(self) -> None:
        content = make_timestampless_csv(96)
        for invalid_date in (None, "", "01-01-2025", "2025-02-30"):
            with self.subTest(start_date=invalid_date):
                with self.assertRaises(DatasetValidationError) as context:
                    parse_and_validate_csv(
                        content,
                        start_date=invalid_date,
                        generate_timestamps=True,
                    )
                codes = {
                    issue["code"]
                    for issue in context.exception.validation_summary["errors"]
                }
                self.assertIn("INVALID_START_DATE", codes)

    def test_no_confirmation_stores_nothing(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            storage_dir = Path(temporary_directory)
            with self.assertRaises(DatasetValidationError):
                validate_and_store_dataset(
                    make_timestampless_csv(96),
                    "unconfirmed.csv",
                    storage_dir,
                    start_date="2025-01-01",
                )
            self.assertEqual(list(storage_dir.iterdir()), [])

    def test_normal_and_leap_year_row_counts_are_classified(self) -> None:
        normal_content = make_timestampless_csv(35040)
        _, normal_validation, _ = parse_and_validate_csv(
            normal_content,
            start_date="2025-01-01",
            generate_timestamps=True,
        )
        self.assertEqual(normal_validation["dataset_type"], "normal_year")
        self.assertEqual(normal_validation["duration_days"], 365)

        leap_content = make_timestampless_csv(35136)
        _, leap_validation, _ = parse_and_validate_csv(
            leap_content,
            start_date="2024-01-01",
            generate_timestamps=True,
        )
        self.assertEqual(leap_validation["dataset_type"], "leap_year")
        self.assertEqual(leap_validation["duration_days"], 366)

    def test_rejects_non_daily_or_oversized_row_counts(self) -> None:
        self.assertIn("INVALID_ROW_COUNT", error_codes(make_timestampless_csv(97)))
        oversized = make_timestampless_csv(35232)
        with self.assertRaises(DatasetValidationError) as context:
            parse_and_validate_csv(
                oversized,
                start_date="2025-01-01",
                generate_timestamps=True,
            )
        self.assertIn(
            "INVALID_ROW_COUNT",
            {issue["code"] for issue in context.exception.validation_summary["errors"]},
        )

    def test_timestamped_partial_dataset_keeps_strict_interval_behavior(self) -> None:
        rows: list[list[str]] = []
        start = datetime(2025, 7, 1)
        for index in range(96):
            rows.append(
                [
                    (start + timedelta(minutes=15 * index)).isoformat(),
                    "1.0",
                    "2.0",
                ]
            )
        _, validation, summary = parse_and_validate_csv(make_csv(rows))
        self.assertEqual(validation["dataset_type"], "partial")
        self.assertFalse(validation["timestamps_generated"])
        self.assertEqual(summary["start_date"], "2025-07-01")
        self.assertEqual(summary["end_date"], "2025-07-01")

    def test_rejects_invalid_file_inputs(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            storage_dir = Path(temporary_directory)
            with self.assertRaises(DatasetFileError):
                validate_and_store_dataset(b"content", "profile.txt", storage_dir)
            with self.assertRaises(DatasetFileError):
                validate_and_store_dataset(b"", "profile.csv", storage_dir)
            with self.assertRaises(DatasetUploadTooLargeError):
                validate_and_store_dataset(
                    b"x" * (MAX_UPLOAD_BYTES + 1),
                    "profile.csv",
                    storage_dir,
                )

    def test_rejects_unknown_dataset_and_invalid_or_missing_date(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            storage_dir = Path(temporary_directory)
            with self.assertRaises(DatasetNotFoundError):
                get_dataset_day("not-a-uuid", "2025-01-01", storage_dir)

            upload = validate_and_store_dataset(
                self.annual_csv,
                "annual.csv",
                storage_dir,
            )
            dataset_id = str(upload["dataset_id"])
            with self.assertRaises(DatasetDateError):
                get_dataset_day(dataset_id, "15-06-2025", storage_dir)
            with self.assertRaises(DatasetDateError):
                get_dataset_day(dataset_id, "20250615", storage_dir)
            with self.assertRaises(DatasetDateNotFoundError):
                get_dataset_day(dataset_id, "2026-01-01", storage_dir)

    def test_dataset_routes_are_registered(self) -> None:
        paths = app.openapi()["paths"]
        self.assertIn("post", paths["/api/datasets/upload"])
        self.assertIn("get", paths["/api/datasets/{dataset_id}/day"])


if __name__ == "__main__":
    unittest.main()
