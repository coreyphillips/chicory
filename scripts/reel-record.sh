#!/bin/bash
# Records each shot of the reel (native-tests/Reel.tsx) from an iOS
# simulator as a clip of its own, keyed off the REEL lines the reel logs.
#
#   scripts/reel-record.sh <udid> <out-dir>
#
# Start it before launching the reel, with DEVELOPER_DIR pointing at Xcode.
# It streams the simulator's log, starts a recording as each shot's slate
# begins (REEL <n> <name>), stops it as the shot's hold ends (REEL DONE <n>)
# and exits after REEL COMPLETE. Clips land in <out-dir>/shot-<n>.mov, and
# <out-dir>/reel.log keeps every REEL and GALLERY line with its time, so a
# MISS or an ERROR in a shot is seen beside its clip.
#
# Job control is on so the recorder, a background job, still takes the
# SIGINT that finalises its file.
set -m
UDID=${1:?simulator udid}
OUT=${2:?clip directory}
mkdir -p "$OUT"
LOG="$OUT/reel.log"
: > "$LOG"
FIFO="$OUT/.lines"
rm -f "$FIFO"
mkfifo "$FIFO"

xcrun simctl spawn "$UDID" log stream --level info --style compact \
  --predicate 'eventMessage CONTAINS "REEL " OR eventMessage CONTAINS "GALLERY "' \
  > "$LOG" 2>&1 &
LOGPID=$!
tail -n 0 -F "$LOG" > "$FIFO" &
TAILPID=$!

rec=""
seen=""
stop() {
  if [ -n "$rec" ]; then
    kill -INT "$rec" 2>/dev/null
    wait "$rec" 2>/dev/null
    rec=""
  fi
}
cleanup() {
  stop
  kill "$TAILPID" "$LOGPID" 2>/dev/null
  rm -f "$FIFO"
}
trap cleanup EXIT

echo "recording $UDID into $OUT"
while IFS= read -r line; do
  case "$line" in
    *"REEL COMPLETE"*)
      echo "complete"
      stop
      break
      ;;
    *"REEL DONE "*)
      echo "done: $line"
      stop
      ;;
    *"REEL "[0-9]*)
      n=${line##*REEL }
      n=${n%% *}
      if [ "$seen" != "$n" ]; then
        seen=$n
        echo "shot $n: $line"
        stop
        xcrun simctl io "$UDID" recordVideo --codec=h264 --mask=ignored --force \
          "$OUT/shot-$n.mov" 2> "$OUT/shot-$n.stderr" &
        rec=$!
      fi
      ;;
  esac
done < "$FIFO"
