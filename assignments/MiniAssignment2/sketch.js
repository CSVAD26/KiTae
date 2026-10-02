// Complimentary Color
// Mouse position changes base hue value. Two squares show complementary colors (base, base + 180).
// extended from Rune Madsen's Color Scheme Complimentary Example :https://printingcode.runemadsen.com/examples/color/scheme_complementary/index.html

let innerRadius = 100; // hole size
let outerRadius = 200; // hole size
let baseHue = 0;
let saturation = 0;

let steps = 360/15; // resolution

function setup() {
  createCanvas(800, 800);
  colorMode(HSB, 360, 100, 100);
  noStroke();
}

function draw() {
  background(100);
  drawRing();

  // Map mouseX to hue (0–360)
  // let baseHue = map(mouseX, 0, width, 0, 360);
  baseHue = (baseHue + 360) % 360; // ensure baseHue stays within 0-359 range

  let squareWidth = width/2;

  // Square 1: base hue
  fill((baseHue + 0) % 360, saturation, 100);
  rect(0, 0, squareWidth, height/4);
  drawColorPosition(baseHue);

  // Square 2: base + 30
  fill((baseHue + 180) % 360, saturation, 100);
  rect(squareWidth, 0, squareWidth, height/4);
  drawColorPosition(baseHue + 180);
}


function drawColorPosition(hue){
  push();
  translate(width / 2, height / 2); 
  let x1 = cos(radians(hue)) * (innerRadius+(outerRadius-innerRadius)/2);
  let y1 = sin(radians(hue)) * (innerRadius+(outerRadius-innerRadius)/2);
  fill(0);
  ellipse(x1, y1, 20,20);
  pop();
}

function drawRing(){
  push();
  translate(width / 2, height / 2); // center of canvas

  

  for (let angle = 0; angle < 360; angle+=steps) {
    let nextAngle = angle + steps;

    // Outer edge points
    let x1 = cos(radians(angle)) * outerRadius;
    let y1 = sin(radians(angle)) * outerRadius;
    let x2 = cos(radians(nextAngle)) * outerRadius;
    let y2 = sin(radians(nextAngle)) * outerRadius;

    // Inner edge points
    let x3 = cos(radians(nextAngle)) * innerRadius;
    let y3 = sin(radians(nextAngle)) * innerRadius;
    let x4 = cos(radians(angle)) * innerRadius;
    let y4 = sin(radians(angle)) * innerRadius;

    fill(angle, 100, 100);
    quad(x1, y1, x2, y2, x3, y3, x4, y4);
   
  }
  pop();

}

function mouseWheel(event){
  // console.log(event.delta);
  // baseHue += event.delta;
  baseHue += event.delta * 0.05;    // AI help: slow down hue change with reduced sensitivity
  // baseHue = Math.round(baseHue%360);
  // console.log(baseHue);
}

function mouseDragged(){
  saturation = map(mouseY, 0, height, 0, 100);
  // fill((baseHue + 0) % 360, saturation, 100);
}