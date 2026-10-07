"""첫 관리자 지정: 이미 가입한 계정에 관리자 권한을 준다. 그 뒤로는 관리자 페이지에서 지정·해제한다.

사용법:
    DATABASE_URL=postgres://... python scripts/grant_admin.py <아이디>
"""

from __future__ import annotations

import os
import sys

import psycopg


def main(username: str) -> None:
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        cur = conn.execute("UPDATE users SET is_admin = TRUE WHERE username = %s", (username.strip().lower(),))
        conn.commit()
    if cur.rowcount != 1:
        sys.exit(f"아이디 '{username}' 계정이 없습니다. 사이트에서 먼저 가입하세요.")
    print(f"{username} 계정을 관리자로 지정했습니다.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("사용법: python scripts/grant_admin.py <아이디>")
    main(sys.argv[1])
