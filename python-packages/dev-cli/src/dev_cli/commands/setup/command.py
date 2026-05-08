import typer
from dev_cli.commands.setup.git_submodules import setup_git_submodules
from dev_cli.commands.setup.global_skills import setup_global_skills
from dev_cli.commands.setup.hermes_config import setup_hermes_config
from dev_cli.commands.setup.hs_api import setup_hs_api
from dev_cli.commands.setup.hs_web import setup_hs_web
from dev_cli.commands.setup.ll_hs import setup_ll_hs
from dev_cli.commands.setup.opencode_config import setup_opencode_config
from dev_cli.commands.setup.pg_config import setup_pg_config
from dev_cli.commands.setup.pi_config import setup_pi_config

app = typer.Typer(no_args_is_help=True)


@app.command()
def git_submodules() -> None:
    """Initialize and update git submodules (hermes-agent, hindsight)."""
    setup_git_submodules()


@app.command()
def hermes_config() -> None:
    """Link hermes config and binary, check hermes command."""
    setup_hermes_config()


@app.command()
def hs_api() -> None:
    """Set up Hindsight API server (uv tool)."""
    setup_hs_api()


@app.command()
def hs_web() -> None:
    """Set up Hindsight Control Plane (Web UI)."""
    setup_hs_web()


@app.command()
def ll_hs() -> None:
    """Set up LiteLLM proxy for Hindsight."""
    setup_ll_hs()


@app.command()
def opencode_config() -> None:
    """Link OpenCode config files and plugins."""
    setup_opencode_config()


@app.command()
def pg_config() -> None:
    """Build and install PostgreSQL extensions (VectorChord, pg_tokenizer, bm25)."""
    setup_pg_config()


@app.command()
def global_skills() -> None:
    """Clean broken symlinks and link global skills from skills-src/."""
    setup_global_skills()


@app.command()
def pi_config() -> None:
    """Link pi agent config, install pi package, check environment."""
    setup_pi_config()
