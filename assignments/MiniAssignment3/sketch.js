/*
 * 👋 Hello! This is an ml5.js example made and shared with ❤️.
 * Learn more about the ml5.js project: https://ml5js.org/
 * ml5.js license and Code of Conduct: https://github.com/ml5js/ml5-next-gen/blob/main/LICENSE.md
 *
 * This example demonstrates drawing skeletal connections through ml5.handPose.
 */

let handPose;
let video;
let hands = [];
let connections;

// Thumb tip and index tip closer than this (in pixels) counts as a pinch
let pinchThreshold = 40;

async function setup() {
  handPose = await ml5.handPose();
  
  createCanvas(640, 480);
  // Create the webcam video and hide it
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();
  // start detecting hands from the webcam video
  handPose.detectStart(video, gotHands);
  // Get the skeletal connection information
  connections = handPose.getConnections();
}

function draw() {
  // Draw the webcam video
  image(video, 0, 0, width, height);

  // Draw the skeletal connections
  for (let i = 0; i < hands.length; i++) {
    let hand = hands[i];
    for (let j = 0; j < connections.length; j++) {
      let pointAIndex = connections[j][0];
      let pointBIndex = connections[j][1];
      let pointA = hand.keypoints[pointAIndex];
      let pointB = hand.keypoints[pointBIndex];
      stroke(255, 0, 0);
      strokeWeight(2);
      line(pointA.x, pointA.y, pointB.x, pointB.y);
    }
  }

  // Draw all the tracked hand points
  for (let i = 0; i < hands.length; i++) {
    let hand = hands[i];
    for (let j = 0; j < hand.keypoints.length; j++) {
      let keypoint = hand.keypoints[j];
      fill(0, 255, 0);
      noStroke();
      circle(keypoint.x, keypoint.y, 10);
    }
  }

  // Detect a pinch on each hand: thumb tip and index finger tip close together
  for (let i = 0; i < hands.length; i++) {
    let hand = hands[i];
    let thumb = hand.thumb_tip;
    let finger = hand.index_finger_tip;
    let pinch = dist(thumb.x, thumb.y, finger.x, finger.y);

    // Print the distance twice a second to help tune pinchThreshold
    if (frameCount % 30 === 0) {
      console.log(hand.handedness, "pinch distance:", round(pinch));
    }

    if (pinch < pinchThreshold) {
      fill(255, 255, 0);
      textSize(32);
      text("PINCH", (thumb.x + finger.x) / 2, min(thumb.y, finger.y) - 10);
    }
  }
}

// Callback function for when handPose outputs data
function gotHands(results) {
  // save the output to the hands variable
  hands = results;
}