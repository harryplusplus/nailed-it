#!/bin/bash
# hs-api.sh - Hindsight API server launcher with auto-restart
# Usage: ./hs-api.sh

SESSION_NAME="hs-api"
CRASH_LOG="${PWD}/hs-api-crash.log"

# Check if tmux session already exists
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Session '$SESSION_NAME' already exists."
    echo "Attach: tmux attach -t $SESSION_NAME"
    echo "Kill:   tmux kill-session -t $SESSION_NAME"
    exit 1
fi

# Create new tmux session with auto-restart loop
tmux new-session -d -s "$SESSION_NAME" \
    "while true; do
        echo '=== Starting hs-api ===';
        uv run --env-file .env hindsight-api;
        EXIT_CODE=\$?;
        echo \"=== hs-api exited with code \$EXIT_CODE. Restarting in 5s... ===\";
        echo \"\$(date '+%Y-%m-%d %H:%M:%S') hs-api exited with code \$EXIT_CODE\" >> ${CRASH_LOG};
        sleep 5;
    done"

echo "Session '$SESSION_NAME' started."
echo "Attach:     tmux attach -t $SESSION_NAME"
echo "Logs:       tmux capture-pane -t $SESSION_NAME -p"
echo "Crash log:  tail -f ${CRASH_LOG}"
