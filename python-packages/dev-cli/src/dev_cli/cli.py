import typer
from dev_cli.commands.models_dev import app as models_dev_app
from dev_cli.commands.setup.command import app as setup_app

app = typer.Typer(no_args_is_help=True, add_completion=False)
app.add_typer(setup_app, name="setup", help="Setup development environment")
app.add_typer(models_dev_app, name="models-dev", help="Query models.dev API")


def main() -> None:
    app()


if __name__ == "__main__":
    main()
