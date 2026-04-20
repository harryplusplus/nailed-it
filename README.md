# Nailed It!

```sh
tmux new -s hs-api 'uv run --env-file .env hs_api.py'
tmux new -s hs-web 'pnpm run --filter @nailed-it/hs-web start'
```
