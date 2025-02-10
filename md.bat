@echo off
// cd /d C:\Users\degol\OneDrive\Desktop\multiplayer-desmos

:: Start the Node server
start cmd /k "node server.cjs"

:: Start the development server
start cmd /k "npm run dev"

:: Start the WebRTC signaling server
start cmd /k "cd node_modules\.bin && y-webrtc-signaling.cmd"
