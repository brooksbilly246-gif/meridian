#!/bin/bash
# Calls the Kairos strategy tick endpoint. Runs every 60s via LaunchAgent.
curl -s --max-time 30 http://localhost:3000/api/strategy/tick >> /Users/billybrooks/kairos-fx/tick.log 2>&1
echo "" >> /Users/billybrooks/kairos-fx/tick.log
