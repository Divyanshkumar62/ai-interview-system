import React, { useEffect, useRef, useState } from "react";
import { FaceMesh } from "@mediapipe/face_mesh";
import { Pose } from "@mediapipe/pose";
import { Hands } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";

function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);

  const latestFaceLandmarks = useRef(null);
  const latestPoseLandmarks = useRef(null);
  const latestHandsLandmarks = useRef(null);

  const [feedbackMsgs, setFeedbackMsgs] = useState([]);
  const lastHandPositions = useRef([]);
  const feedbackTimers = useRef({});

  useEffect(() => {
    let faceMesh, pose, hands, camera;
    let blinkCount = 0;
    let lastBlinkTime = performance.now();
    let blinkHistory = [];
    let yawnCount = 0;
    let isYawning = false;

    function getEAR(upper, lower) {
      return Math.abs(upper.y - lower.y);
    }

    function distance(a, b) {
      return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
    }

    function detectBlinkAndYawn(landmarks) {
      if (!landmarks) return;
      const leftEAR = getEAR(landmarks[159], landmarks[145]);
      const rightEAR = getEAR(landmarks[386], landmarks[374]);
      const avgEAR = (leftEAR + rightEAR) / 2;
      const blinkThreshold = 0.23;
      const now = performance.now();
      if (avgEAR < blinkThreshold) {
        if (now - lastBlinkTime > 300) {
          blinkCount++;
          lastBlinkTime = now;
          blinkHistory.push(now);
        }
      }
      blinkHistory = blinkHistory.filter((t) => now - t < 60000);
      const mouthOpen = distance(landmarks[13], landmarks[14]);
      const yawnThreshold = 0.05;
      if (mouthOpen > yawnThreshold && !isYawning) {
        yawnCount++;
        isYawning = true;
      } else if (mouthOpen <= yawnThreshold) {
        isYawning = false;
      }
    }

    // Results handlers
    function onFaceMeshResults(results) {
      latestFaceLandmarks.current = results.multiFaceLandmarks;
      draw();
    }
    function onPoseResults(results) {
      latestPoseLandmarks.current = results.poseLandmarks;
      draw();
    }
    function onHandsResults(results) {
      latestHandsLandmarks.current = results.multiHandLandmarks;
      draw();
    }

    function draw() {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      // Draw face landmarks
      if (latestFaceLandmarks.current?.[0]) {
        ctx.fillStyle = "lime";
        for (const landmark of latestFaceLandmarks.current[0]) {
          ctx.beginPath();
          ctx.arc(
            landmark.x * canvas.width,
            landmark.y * canvas.height,
            2,
            0,
            2 * Math.PI
          );
          ctx.fill();
        }
        detectBlinkAndYawn(latestFaceLandmarks.current[0]);
      }

      if (latestPoseLandmarks.current) {
        drawPose(ctx, latestPoseLandmarks.current, canvas.width, canvas.height);
      }

      if (latestHandsLandmarks.current) {
        for (const hand of latestHandsLandmarks.current) {
          drawHand(ctx, hand, canvas.width, canvas.height);
        }
      }

      const currentFeedbacks = [];

      if (latestFaceLandmarks.current?.[0]) {
        const noseTip = latestFaceLandmarks.current[0][1];
        if (noseTip.x < 0.35)
          currentFeedbacks.push("Move slightly to your right.");
        else if (noseTip.x > 0.65)
          currentFeedbacks.push("Move slightly to your left.");

        const leftEyeInner = latestFaceLandmarks.current[0][133];
        const leftEyeOuter = latestFaceLandmarks.current[0][33];
        const leftIris = latestFaceLandmarks.current[0][468];
        const rightEyeInner = latestFaceLandmarks.current[0][362];
        const rightEyeOuter = latestFaceLandmarks.current[0][263];
        const rightIris = latestFaceLandmarks.current[0][473];

        if (
          leftEyeInner &&
          leftEyeOuter &&
          leftIris &&
          rightEyeInner &&
          rightEyeOuter &&
          rightIris
        ) {
          const leftEyeWidth = leftEyeOuter.x - leftEyeInner.x;
          const leftIrisPos = (leftIris.x - leftEyeInner.x) / leftEyeWidth;

          const rightEyeWidth = rightEyeOuter.x - rightEyeInner.x;
          const rightIrisPos = (rightIris.x - rightEyeInner.x) / rightEyeWidth;

          const avgIrisPos = (leftIrisPos + rightIrisPos) / 2;

          if (avgIrisPos < 0.35)
            currentFeedbacks.push("Looking left or off-screen");
          else if (avgIrisPos > 0.65)
            currentFeedbacks.push("Looking right or off-screen");
        }
      }

      if (latestPoseLandmarks.current) {
        const left = latestPoseLandmarks.current[11];
        const right = latestPoseLandmarks.current[12];
        if (left && right && Math.abs(left.y - right.y) > 0.1)
          currentFeedbacks.push("Sit straight, you're leaning.");
      }

      if (latestHandsLandmarks.current?.length) {
        const current = latestHandsLandmarks.current.map((hand) =>
          hand.map((lm) => ({ x: lm.x, y: lm.y }))
        );

        if (lastHandPositions.current.length) {
          let movement = 0;
          for (let i = 0; i < current.length; i++) {
            for (let j = 0; j < current[i].length; j++) {
              const dx =
                current[i][j].x - (lastHandPositions.current[i]?.[j]?.x || 0);
              const dy =
                current[i][j].y - (lastHandPositions.current[i]?.[j]?.y || 0);
              movement += dx * dx + dy * dy;
            }
          }
          if (movement > 0.02)
            currentFeedbacks.push("Avoid moving hands too much.");
        }

        lastHandPositions.current = current;
      }

      if (blinkHistory.length > 20) {
        currentFeedbacks.push(
          "High blink rate detected – possible nervousness"
        );
      }
      if (yawnCount > 2) {
        currentFeedbacks.push(
          "Yawning detected – possible drowsiness or low energy"
        );
      }

      updateMessages(currentFeedbacks);
      animationRef.current = requestAnimationFrame(drawLoop);
    }

    async function init() {
      faceMesh = new FaceMesh({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      faceMesh.onResults(onFaceMeshResults);

      pose = new Pose({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });
      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      pose.onResults(onPoseResults);

      hands = new Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      hands.onResults(onHandsResults);

      camera = new Camera(videoRef.current, {
        onFrame: async () => {
          await faceMesh.send({ image: videoRef.current });
          await pose.send({ image: videoRef.current });
          await hands.send({ image: videoRef.current });
        },
        width: 640,
        height: 480,
      });
      camera.start();
    }

    async function processFrame() {
      if (videoRef.current.readyState >= 2) {
        await faceMesh.send({ image: videoRef.current });
        await pose.send({ image: videoRef.current });
        await hands.send({ image: videoRef.current });
      }
    }

    function updateMessages(newMsgs) {
      const now = Date.now();
      const updated = { ...feedbackTimers.current };

      for (const msg of newMsgs) {
        updated[msg] = now + 3000;
      }

      for (const msg in updated) {
        if (updated[msg] < now) {
          delete updated[msg];
        }
      }

      feedbackTimers.current = updated;
      setFeedbackMsgs(Object.keys(updated));
    }

    async function drawLoop() {
      await processFrame();

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

      if (latestFaceLandmarks.current?.[0]) {
        for (const landmark of latestFaceLandmarks.current[0]) {
          ctx.beginPath();
          ctx.arc(
            landmark.x * canvas.width,
            landmark.y * canvas.height,
            2,
            0,
            2 * Math.PI
          );
          ctx.fillStyle = "lime";
          ctx.fill();
        }

        detectBlinkAndYawn(latestFaceLandmarks.current[0]);
      }

      if (latestPoseLandmarks.current) {
        drawPose(ctx, latestPoseLandmarks.current, canvas.width, canvas.height);
      }

      if (latestHandsLandmarks.current) {
        for (const hand of latestHandsLandmarks.current) {
          drawHand(ctx, hand, canvas.width, canvas.height);
        }
      }

      const currentFeedbacks = [];

      if (latestFaceLandmarks.current?.[0]) {
        const noseTip = latestFaceLandmarks.current[0][1];
        if (noseTip.x < 0.35)
          currentFeedbacks.push("Move slightly to your right.");
        else if (noseTip.x > 0.65)
          currentFeedbacks.push("Move slightly to your left.");

        const leftEyeInner = latestFaceLandmarks.current[0][133];
        const leftEyeOuter = latestFaceLandmarks.current[0][33];
        const leftIris = latestFaceLandmarks.current[0][468];
        const rightEyeInner = latestFaceLandmarks.current[0][362];
        const rightEyeOuter = latestFaceLandmarks.current[0][263];
        const rightIris = latestFaceLandmarks.current[0][473];

        if (
          leftEyeInner &&
          leftEyeOuter &&
          leftIris &&
          rightEyeInner &&
          rightEyeOuter &&
          rightIris
        ) {
          const leftEyeWidth = leftEyeOuter.x - leftEyeInner.x;
          const leftIrisPos = (leftIris.x - leftEyeInner.x) / leftEyeWidth;

          const rightEyeWidth = rightEyeOuter.x - rightEyeInner.x;
          const rightIrisPos = (rightIris.x - rightEyeInner.x) / rightEyeWidth;

          const avgIrisPos = (leftIrisPos + rightIrisPos) / 2;

          if (avgIrisPos < 0.35)
            currentFeedbacks.push("Looking left or off-screen");
          else if (avgIrisPos > 0.65)
            currentFeedbacks.push("Looking right or off-screen");
        }
      }

      if (latestPoseLandmarks.current) {
        const left = latestPoseLandmarks.current[11];
        const right = latestPoseLandmarks.current[12];
        if (left && right && Math.abs(left.y - right.y) > 0.1)
          currentFeedbacks.push("Sit straight, you're leaning.");
      }

      if (latestHandsLandmarks.current?.length) {
        const current = latestHandsLandmarks.current.map((hand) =>
          hand.map((lm) => ({ x: lm.x, y: lm.y }))
        );

        if (lastHandPositions.current.length) {
          let movement = 0;
          for (let i = 0; i < current.length; i++) {
            for (let j = 0; j < current[i].length; j++) {
              const dx =
                current[i][j].x - (lastHandPositions.current[i]?.[j]?.x || 0);
              const dy =
                current[i][j].y - (lastHandPositions.current[i]?.[j]?.y || 0);
              movement += dx * dx + dy * dy;
            }
          }
          if (movement > 0.02)
            currentFeedbacks.push("Avoid moving hands too much.");
        }

        lastHandPositions.current = current;
      }

      if (blinkHistory.length > 20) {
        currentFeedbacks.push(
          "High blink rate detected – possible nervousness"
        );
      }
      if (yawnCount > 2) {
        currentFeedbacks.push(
          "Yawning detected – possible drowsiness or low energy"
        );
      }

      updateMessages(currentFeedbacks);
      animationRef.current = requestAnimationFrame(drawLoop);
    }

    init();
    return () => {
      if (camera) camera.stop();
    };
  }, []);

  function drawPose(ctx, landmarks, width, height) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = "red";
    ctx.fillStyle = "red";
    for (const landmark of landmarks) {
      ctx.beginPath();
      ctx.arc(landmark.x * width, landmark.y * height, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
    const connections = [
      [11, 13],
      [13, 15],
      [12, 14],
      [14, 16],
      [11, 12],
      [23, 24],
      [11, 23],
      [12, 24],
      [23, 25],
      [25, 27],
      [24, 26],
      [26, 28],
    ];
    for (const [i, j] of connections) {
      const start = landmarks[i],
        end = landmarks[j];
      if (start && end) {
        ctx.beginPath();
        ctx.moveTo(start.x * width, start.y * height);
        ctx.lineTo(end.x * width, end.y * height);
        ctx.stroke();
      }
    }
  }

  function drawHand(ctx, landmarks, width, height) {
    ctx.strokeStyle = "yellow";
    ctx.lineWidth = 2;
    ctx.fillStyle = "yellow";
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * width, lm.y * height, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
    const connections = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [0, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [5, 9],
      [9, 10],
      [10, 11],
      [11, 12],
      [9, 13],
      [13, 14],
      [14, 15],
      [15, 16],
      [13, 17],
      [17, 18],
      [18, 19],
      [19, 20],
      [0, 17],
    ];
    for (const [i, j] of connections) {
      const a = landmarks[i],
        b = landmarks[j];
      if (a && b) {
        ctx.beginPath();
        ctx.moveTo(a.x * width, a.y * height);
        ctx.lineTo(b.x * width, b.y * height);
        ctx.stroke();
      }
    }
  }

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        background: "#000",
      }}
    >
      <h1 style={{ color: "#fff" }}>AI Interview Demo</h1>
      <div style={{ position: "relative", width: "640px", height: "480px" }}>
        <video
          ref={videoRef}
          width="640"
          height="480"
          autoPlay
          muted
          playsInline
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: 0,
            objectFit: "cover",
          }}
        />
        <canvas
          ref={canvasRef}
          width="640"
          height="480"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            zIndex: 1,
            pointerEvents: "none",
            border: "2px solid white",
          }}
        />
        {feedbackMsgs.length > 0 && (
          <div
            style={{
              position: "absolute",
              bottom: 10,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(0, 0, 0, 0.7)",
              color: "#fff",
              padding: "10px 20px",
              borderRadius: "8px",
              fontSize: "16px",
              zIndex: 20,
              textAlign: "center",
            }}
          >
            {feedbackMsgs.map((msg, idx) => (
              <div key={idx}>{msg}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
