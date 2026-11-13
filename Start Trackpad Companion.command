#!/bin/bash
# Double-click in Finder to run the my-prophecy trackpad companion.
# Leave the Terminal window open while using the website.
set -e
cd "$(dirname "$0")"
./companion/trackpad-midi/build.sh
clear
echo "Starting my-prophecy trackpad companion…"
echo "Leave this window open. Use Enable/Disable on the website."
echo ""
exec ./bin/trackpad-midi --daemon --out MidiLink
