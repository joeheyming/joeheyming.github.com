'use strict';

import { getThemeColors } from './themes.js';
import { state } from './tiles.js';

var EXPORT_TILE_W = 120;
var EXPORT_TILE_H = 144;
var EXPORT_GAP = 10;
var EXPORT_LINE_GAP = 16;
var EXPORT_PAD = 20;

function drawTileOnCanvas(ctx, el, x, y) {
  var w = EXPORT_TILE_W;
  var h = EXPORT_TILE_H;
  var r = 12;
  var t = getThemeColors();
  var borderColor = el.unmatched
    ? t.unmatchedBorder
    : typeof t.border === 'function'
      ? t.border(el.category)
      : t.border;
  var fillColor = el.unmatched ? t.unmatchedBg : t.tileBg;

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = el.unmatched ? 2 : 2.5;
  if (el.unmatched) ctx.setLineDash([6, 4]);
  else ctx.setLineDash([]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (el.unmatched) {
    ctx.fillStyle = t.unmatchedText;
    ctx.font = 'bold 42px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(el.unmatched.toUpperCase(), x + w / 2, y + h / 2 - 6);

    ctx.fillStyle = t.unmatchedText;
    ctx.font = '600 9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('NO MATCH', x + w / 2, y + h / 2 + 24);
  } else {
    ctx.fillStyle = typeof t.number === 'function' ? t.number(el.category) : t.number;
    ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(String(el.number), x + 10, y + 8);

    ctx.fillStyle = t.symbol;
    ctx.font = 'bold 42px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(el.symbol, x + w / 2, y + h / 2 - 4);

    ctx.fillStyle = t.name;
    ctx.font = '600 9px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(el.name.toUpperCase(), x + w / 2, y + h / 2 + 24);

    ctx.fillStyle = t.mass;
    ctx.font = '500 8px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(String(el.mass), x + w / 2, y + h / 2 + 38);
  }
}

function measureWordWidth(items) {
  return items.length * EXPORT_TILE_W + (items.length - 1) * EXPORT_GAP;
}

export function exportPNG() {
  if (!state.lastDecomposition || state.lastDecomposition.length === 0) return;

  var wordRows = state.lastDecomposition;
  var maxRowW = 0;
  wordRows.forEach(function (items) {
    var rw = measureWordWidth(items);
    if (rw > maxRowW) maxRowW = rw;
  });

  var numRows = wordRows.length;
  var canvasW = EXPORT_PAD * 2 + maxRowW;
  var canvasH = EXPORT_PAD * 2 + numRows * EXPORT_TILE_H + (numRows - 1) * EXPORT_LINE_GAP;

  var canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  var ctx = canvas.getContext('2d');

  var transparent = document.getElementById('transparentBg').checked;
  if (!transparent) {
    ctx.fillStyle = getThemeColors().bg;
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  wordRows.forEach(function (items, rowIdx) {
    var rowW = measureWordWidth(items);
    var x = EXPORT_PAD + Math.floor((maxRowW - rowW) / 2);
    var y = EXPORT_PAD + rowIdx * (EXPORT_TILE_H + EXPORT_LINE_GAP);

    items.forEach(function (item, i) {
      if (i > 0) x += EXPORT_GAP;
      drawTileOnCanvas(ctx, item, x, y);
      x += EXPORT_TILE_W;
    });
  });

  var link = document.createElement('a');
  var rawText = document
    .getElementById('wordInput')
    .value.replace(/[^a-zA-Z\s]/g, '')
    .trim();
  var filename = rawText.replace(/\s+/g, '-').toLowerCase() || 'elements';
  link.download = 'periodic-' + filename + '.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}
