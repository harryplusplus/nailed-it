import typer
from dev_cli.commands.setup.git_submodules import setup_git_submodules
from dev_cli.commands.setup.hermes_config import setup_hermes_config
from dev_cli.commands.setup.opencode_config import setup_opencode_config
from dev_cli.commands.setup.pg_config import setup_pg_config
from dev_cli.commands.setup.pi_config import setup_pi_config

app = typer.Typer(no_args_is_help=True)


@app.command()
def git_submodules() -> None:
    setup_git_submodules()


@app.command()
def hermes() -> None:
    setup_hermes_config()


@app.command()
def opencode() -> None:
    setup_opencode_config()


@app.command()
def pg() -> None:
    setup_pg_config()


@app.command()
def pi() -> None:
    setup_pi_config()
