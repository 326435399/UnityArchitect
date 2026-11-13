/* Build circular app icons from any source image, using Electron's canvas.
   Usage: electron tools/build-icon.js <sourceImage> [--out assets]
   Center square crop -> circular mask -> PNG (512..16) -> assets/icon.ico */
'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const SRC = process.argv[2];
if (!SRC) { console.error('Usage: electron tools/build-icon.js <sourceImage>'); app.exit(1); }
const root = path.join(__dirname, '..');
const OUT = path.join(root, 'assets');
const SIZES = [16, 32, 48, 64, 128, 256, 512];

function packIco(pngBySize) {
  const sizes = SIZES.filter((s) => pngBySize[s]);
  const count = sizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + count * 16;
  const blobs = [];
  for (const s of sizes) {
    const data = pngBySize[s];
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0);       // width (0 = 256)
    e.writeUInt8(s >= 256 ? 0 : s, 1);       // height
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);  // palette, reserved
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); // planes, bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e); blobs.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...blobs]);
}

app.whenReady().then(async () => {
  if (!fs.existsSync(SRC)) { console.error('source image not found: ' + SRC); app.exit(1); }
  const win = new BrowserWindow({ width: 640, height: 480, show: false });
  await win.loadURL('data:text/html,<canvas id=c></canvas>');
  const imgDataUrl = 'data:image/' + (/\.(png|jpg|jpeg)$/i.exec(SRC) || ['', 'png'])[1] + ';base64,' +
    fs.readFileSync(SRC).toString('base64');
  const result = await win.webContents.executeJavaScript(`(async function(){
    const img = new Image();
    img.src = ${JSON.stringify(imgDataUrl)};
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const fx = (img.naturalWidth - side) / 2, fy = (img.naturalHeight - side) / 2;
    const out = {};
    for (const s of ${JSON.stringify(SIZES)}) {
      const c = document.createElement('canvas');
      c.width = s; c.height = s;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); g.clip();
      g.drawImage(img, fx, fy, side, side, 0, 0, s, s);
      out[s] = c.toDataURL('image/png');
    }
    return out;
  })()`);
  win.destroy();

  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(OUT, 'icons'), { recursive: true });
  const pngBySize = {};
  for (const s of SIZES) {
    const buf = Buffer.from(String(result[s]).split(',')[1], 'base64');
    pngBySize[s] = buf;
    fs.writeFileSync(path.join(OUT, 'icons', 'icon-' + s + '.png'), buf);
  }
  fs.writeFileSync(path.join(OUT, 'icons', 'icon-512.png'), pngBySize[512]);
  fs.copyFileSync(path.join(OUT, 'icons', 'icon-512.png'), path.join(OUT, 'icon.png'));
  fs.writeFileSync(path.join(OUT, 'icon.ico'), packIco(pngBySize));
  console.log('icons written: assets/icon.png (512), assets/icon.ico (' +
    SIZES.join('/') + '), assets/icons/icon-*.png');
  app.exit(0);
});
