"""제출 CSV 파싱과 검증.

검증 순서: 파일 크기 → UTF-8 → 헤더 → 행 수 → id 순서 → price 숫자.
첫 실패 지점에서 SubmissionError를 던진다. 행 번호는 헤더를 1행으로 센 파일 기준 번호다.
"""

from __future__ import annotations

import csv
import io
import math
from dataclasses import dataclass

MAX_FILE_BYTES = 2 * 1024 * 1024
EXPECTED_HEADER = ["id", "price"]


class SubmissionError(Exception):
    def __init__(self, code: str, message: str, row: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.row = row

    def to_dict(self) -> dict:
        body = {"error_code": self.code, "message": self.message}
        if self.row is not None:
            body["row"] = self.row
        return body


@dataclass(frozen=True)
class ParsedSubmission:
    ids: list[int]
    prices: list[float]


def _normalize_id(raw: str, row: int) -> int:
    text = raw.strip()
    try:
        value = float(text)
    except ValueError:
        raise SubmissionError("bad_id", f"{row}행의 id '{raw}'가 정수가 아닙니다.", row)
    if not value.is_integer():
        raise SubmissionError("bad_id", f"{row}행의 id '{raw}'가 정수가 아닙니다.", row)
    return int(value)


def _normalize_price(raw: str, row: int) -> float:
    text = raw.strip()
    if text == "":
        raise SubmissionError("bad_price", f"{row}행의 price가 비어 있습니다.", row)
    try:
        value = float(text)
    except ValueError:
        raise SubmissionError("bad_price", f"{row}행의 price '{raw}'가 숫자가 아닙니다.", row)
    if not math.isfinite(value):
        raise SubmissionError("bad_price", f"{row}행의 price '{raw}'가 유한한 숫자가 아닙니다.", row)
    return value


def parse_submission(data: bytes, expected_ids: list[int]) -> ParsedSubmission:
    """제출 파일 바이트를 검증하고 id·price 목록으로 돌려준다.

    expected_ids는 정답의 id를 행 순서대로 담은 목록이다. 제출 파일의 id는
    이 목록과 같은 순서로 완전히 일치해야 한다(채점은 위치 기준).
    """
    if len(data) > MAX_FILE_BYTES:
        raise SubmissionError(
            "file_too_large",
            f"파일이 {MAX_FILE_BYTES // (1024 * 1024)} MB를 넘습니다. 정상 제출은 약 0.5 MB입니다.",
        )
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise SubmissionError("not_utf8", "파일을 UTF-8 텍스트로 읽을 수 없습니다.")

    reader = csv.reader(io.StringIO(text, newline=""))
    try:
        header = next(reader)
    except StopIteration:
        raise SubmissionError("empty", "파일이 비어 있습니다.")
    if [h.strip() for h in header] != EXPECTED_HEADER:
        raise SubmissionError(
            "bad_header",
            f"헤더는 정확히 'id,price'여야 합니다. 받은 헤더: '{','.join(header)}'",
            1,
        )

    rows: list[list[str]] = []
    for line_no, row in enumerate(reader, start=2):
        if not row or all(cell.strip() == "" for cell in row):
            continue  # 끝의 빈 줄은 무시한다
        if len(row) != 2:
            raise SubmissionError(
                "bad_row",
                f"{line_no}행의 열 개수가 {len(row)}개입니다. 'id,price' 두 열이어야 합니다.",
                line_no,
            )
        rows.append(row)

    expected_n = len(expected_ids)
    if len(rows) != expected_n:
        raise SubmissionError(
            "row_count",
            f"데이터 행 수가 {len(rows)}개입니다. test.csv와 같은 {expected_n}개여야 합니다.",
        )

    ids: list[int] = []
    prices: list[float] = []
    for i, (raw_id, raw_price) in enumerate(rows):
        row_no = i + 2
        sub_id = _normalize_id(raw_id, row_no)
        if sub_id != expected_ids[i]:
            raise SubmissionError(
                "id_mismatch",
                f"{row_no}행의 id가 {sub_id}인데 test.csv의 같은 위치 id는 {expected_ids[i]}입니다. "
                "행 순서를 바꾸지 말고 test.csv 순서 그대로 제출하세요.",
                row_no,
            )
        ids.append(sub_id)
        prices.append(_normalize_price(raw_price, row_no))

    return ParsedSubmission(ids=ids, prices=prices)
