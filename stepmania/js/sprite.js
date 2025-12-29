// Sprite module - ES Module

function LoaderProxy() {
  return {
    draw: function () {}, // noop function
    fill: function () {}, // noop function
    frame: function () {}, // noop function
    update: function () {}, // noop function
    width: null,
    height: null
  };
}

function createSprite(image, options) {
  if (!options) options = {};
  const sourceX = options.sourceX || 0;
  const sourceY = options.sourceY || 0;
  const width = options.width || image.width;
  const height = options.height || image.height;
  const frameWidth = options.frameWidth || width;
  const frameHeight = options.frameHeight || height;

  return {
    draw: function (canvas, frameIndex, x, y, scaleX, scaleY, rotationDegrees, alpha) {
      canvas.save();
      canvas.translate(Math.round(x), Math.round(y));
      if (rotationDegrees != 0) canvas.rotate((rotationDegrees * 3.14159265358) / 180);
      if ((scaleX != 0) | (scaleY != 0)) canvas.scale(scaleX, scaleY);
      canvas.globalAlpha = alpha;
      canvas.drawImage(
        image,
        sourceX + frameIndex * frameWidth,
        sourceY,
        frameWidth,
        frameHeight,
        -frameWidth / 2,
        -frameHeight / 2,
        frameWidth,
        frameHeight
      );
      canvas.restore();
    },

    fill: function (canvas, x, y, width, height, repeat) {
      repeat = repeat || 'repeat';
      const pattern = canvas.createPattern(image, repeat);
      canvas.fillColor(pattern);
      canvas.fillRect(x, y, width, height);
    },

    width: width,
    height: height
  };
}

// Load a sprite from URL
export function loadSprite(url, options) {
  const img = new Image();
  const proxy = LoaderProxy();

  img.onload = function () {
    const sprite = createSprite(this, options);

    // Extend proxy with sprite properties
    for (const key in sprite) {
      if (Object.hasOwn(sprite, key)) {
        proxy[key] = sprite[key];
      }
    }

    if (options && options.loadedCallback) {
      options.loadedCallback(proxy);
    }
  };

  img.src = url;

  return proxy;
}

// Main Sprite function - load from URL
export function Sprite(url, options) {
  return loadSprite(url, options);
}

// Empty sprite placeholder
Sprite.EMPTY = LoaderProxy();
Sprite.load = loadSprite;

// Default export
export default Sprite;
