function setup() {
  createCanvas(400, 400);
}

function draw() {
  background(220);

  // face
  fill(255, 220, 180);
  circle(200, 200, 300);

  // eyes
  fill(0);
  circle(150, 170, 20);
  circle(250, 170, 20);

  // smile (AI used: Asked Claude code for assistance)
  noFill();
  strokeWeight(4);
  arc(200, 230, 120, 80, 0, PI);
}