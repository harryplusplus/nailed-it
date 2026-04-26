# /// script
# requires-python = ">=3.14"
# dependencies = [
#   "httpx>=0.28.1",
#   "typer>=0.25.0",
# ]
# ///

import contextlib
import json
import os
import sys
from typing import Annotated

import httpx
import typer

API_BASE = "https://api.tavily.com"

app = typer.Typer(
    help="Tavily API CLI",
    no_args_is_help=True,
    add_completion=False,
)


def _get_api_key() -> str:
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        print(
            "오류: TAVILY_API_KEY 환경변수가 설정되지 않았습니다.",
            file=sys.stderr,
        )
        sys.exit(1)
    return key


def _handle_http_error(resp: httpx.Response) -> None:
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError:
        text = ""
        with contextlib.suppress(Exception):
            text = resp.text
        print(
            f"오류: API 요청 실패 (HTTP {resp.status_code})\n{text}",
            file=sys.stderr,
        )
        sys.exit(1)


@app.command()
def search(
    query: Annotated[str, typer.Argument(help="검색어")],
    max_results: Annotated[
        int,
        typer.Option("--max-results", "-n", min=1, max=20, help="최대 결과 개수"),
    ] = 5,
    search_depth: Annotated[
        str,
        typer.Option("--search-depth", "-d", help="검색 깊이 (basic 또는 advanced)"),
    ] = "basic",
    *,
    include_answer: Annotated[
        bool,
        typer.Option("--include-answer", "-a", help="AI 요약 포함 여부"),
    ] = False,
) -> None:
    key = _get_api_key()
    payload = {
        "api_key": key,
        "query": query,
        "max_results": max_results,
        "search_depth": search_depth,
        "include_answer": include_answer,
    }
    with httpx.Client() as client:
        resp = client.post(
            f"{API_BASE}/search",
            json=payload,
            timeout=30.0,
        )
    _handle_http_error(resp)
    data = resp.json()
    print(json.dumps(data, ensure_ascii=False, indent=2))


@app.command()
def extract(
    urls: Annotated[list[str], typer.Argument(help="추출할 URL 목록")],
    extract_depth: Annotated[
        str,
        typer.Option("--extract-depth", "-d", help="추출 깊이 (basic 또는 advanced)"),
    ] = "basic",
) -> None:
    key = _get_api_key()
    payload = {
        "api_key": key,
        "urls": urls,
        "extract_depth": extract_depth,
    }
    with httpx.Client() as client:
        resp = client.post(
            f"{API_BASE}/extract",
            json=payload,
            timeout=60.0,
        )
    _handle_http_error(resp)
    data = resp.json()
    print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    app()
