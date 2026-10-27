// 顔認識（MediaPipe）のプログラム本体を public/ にコピーする。
// npm install した版と必ず同じものが使われるので、版ズレが起きない
import { cpSync } from 'node:fs'

cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe', { recursive: true })
