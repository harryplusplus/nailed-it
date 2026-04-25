import typer
from dev_cli.commands.setup.command import app as setup_app

from .commands.models_dev import run_models_dev

app = typer.Typer(no_args_is_help=True, add_completion=False)
app.add_typer(setup_app, name="setup", help="Setup development environment")


@app.command()
def models_dev():
    run_models_dev()


def main():
    app()


if __name__ == "__main__":
    main()
