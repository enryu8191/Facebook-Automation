// Run with Node.js to generate PNG icons from SVG
// node generate-icons.js
// Icons are embedded as base64 PNGs in the extension

const fs = require('fs');
const { createCanvas } = require('canvas');

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background gradient (dark purple to blue)
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#1a0533');
  grad.addColorStop(1, '#0d1b4b');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.2);
  ctx.fill();

  // Play button triangle (white)
  const cx = size * 0.5;
  const cy = size * 0.5;
  const r = size * 0.3;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, cy - r);
  ctx.lineTo(cx - r * 0.5, cy + r);
  ctx.lineTo(cx + r, cy);
  ctx.closePath();
  ctx.fill();

  // Grok "G" letter accent
  ctx.fillStyle = '#a855f7';
  ctx.font = `bold ${size * 0.2}px Arial`;
  ctx.textAlign = 'right';
  ctx.fillText('G', size * 0.92, size * 0.22);

  return canvas.toBuffer('image/png');
}

[16, 48, 128].forEach(size => {
  fs.writeFileSync(`icon${size}.png`, drawIcon(size));
  console.log(`Generated icon${size}.png`);
});
