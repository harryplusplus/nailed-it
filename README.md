# Nailed It!

```sh
tmux new -s hs-api 'uv run --env-file .env hindsight-api'
tmux new -s hs-web 'pnpm run --filter @nailed-it/hs-web start'
```
