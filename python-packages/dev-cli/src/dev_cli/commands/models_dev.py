import json
import sys
import urllib.error
import urllib.request
from typing import Any

import typer
from dev_cli.common import REPO_ROOT, check_repo_root

app = typer.Typer(no_args_is_help=True)

CONFIG_DIR = REPO_ROOT / ".nailed-it"
METADATA_PATH = CONFIG_DIR / "models-dev-metadata.json"
DATA_PATH = CONFIG_DIR / "models-dev-data.json"
API_URL = "https://models.dev/api.json"
_HTTP_NOT_MODIFIED = 304


def _fetch_data(
    *,
    attempt: int = 1,
    max_attempts: int = 3,
) -> dict[str, Any]:
    if attempt > max_attempts:
        msg = f"Failed to fetch models after {max_attempts} attempts."
        raise RuntimeError(msg)

    check_repo_root()

    metadata: dict[str, str] = {}
    try:
        metadata = json.loads(METADATA_PATH.read_text("utf-8"))
    except FileNotFoundError, json.JSONDecodeError:
        METADATA_PATH.unlink(missing_ok=True)

    headers: dict[str, str] = {
        "User-Agent": "dev-cli/0.0.0",
    }
    if etag := metadata.get("etag"):
        headers["If-None-Match"] = etag

    req = urllib.request.Request(API_URL, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data: dict[str, Any] = json.loads(resp.read())

            new_metadata: dict[str, str] = {}
            if etag := resp.headers.get("ETag"):
                new_metadata["etag"] = etag

            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            DATA_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False))
            METADATA_PATH.write_text(
                json.dumps(new_metadata, indent=2, ensure_ascii=False),
            )

            print("Models updated successfully.", file=sys.stderr)
            return data

    except urllib.error.HTTPError as e:
        if e.code == _HTTP_NOT_MODIFIED:
            try:
                data = json.loads(DATA_PATH.read_text("utf-8"))
            except FileNotFoundError, json.JSONDecodeError:
                DATA_PATH.unlink(missing_ok=True)
                METADATA_PATH.unlink(missing_ok=True)
                return _fetch_data(
                    attempt=attempt + 1,
                    max_attempts=max_attempts,
                )
            else:
                print("Models are up to date.", file=sys.stderr)
                return data

        text = e.read().decode("utf-8")
        msg = f"Failed to fetch models: {e.code} {e.reason} - {text}"
        raise RuntimeError(msg) from e


@app.command()
def providers() -> None:
    """List all provider names."""
    data = _fetch_data()
    providers_list = sorted(data)
    print(json.dumps(providers_list, indent=2, ensure_ascii=False))


@app.command()
def models(provider: str) -> None:
    """List model names for a provider."""
    data = _fetch_data()
    provider_data: dict[str, Any] = data.get(provider, {})
    models_list = sorted(provider_data.get("models", {}))
    print(json.dumps(models_list, indent=2, ensure_ascii=False))


@app.command()
def model(provider: str, model: str) -> None:
    """Show model details."""
    data = _fetch_data()
    provider_data: dict[str, Any] = data.get(provider, {})
    model_data: dict[str, Any] = provider_data.get("models", {}).get(model, {})
    print(json.dumps(model_data, indent=2, ensure_ascii=False))
