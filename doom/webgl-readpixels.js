// [SITE] UZDoom grabs save thumbnails with glReadPixels(GL_RGB, GL_UNSIGNED_BYTE).
// WebGL rejects that pair (only RGBA + UNSIGNED_BYTE is legal), so the read
// fails and the save stores the uninitialized buffer — the colored static
// in the load menu. Rewrite those reads: pull RGBA, then pack RGB into the
// buffer the engine already allocated. PACK_ALIGNMENT is honored so the
// row stride matches what the engine will scan.

const GL_RGB = 0x1907;
const GL_RGBA = 0x1908;
const GL_UNSIGNED_BYTE = 0x1401;
const GL_PACK_ALIGNMENT = 0x0d05;

/**
 * @param {unknown[]} [prototypes] WebGL context prototypes. Defaults to the
 *   browser's WebGL 1 and WebGL 2 prototypes when they exist.
 */
export function installWebGLReadPixelsShim(prototypes) {
  const list = prototypes || defaultPrototypes();
  for (const proto of list) patchReadPixels(proto);
}

function defaultPrototypes() {
  const found = [];
  if (typeof WebGLRenderingContext !== 'undefined') found.push(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== 'undefined') found.push(WebGL2RenderingContext.prototype);
  return found;
}

/**
 * @param {object} proto
 */
function patchReadPixels(proto) {
  if (!proto || proto.__heymingReadPixels) return;
  const orig = proto.readPixels;
  if (typeof orig !== 'function') return;
  proto.__heymingReadPixels = true;

  proto.readPixels = function (x, y, width, height, format, type, dst, dstOffset) {
    const dest = rgbDestination(format, type, width, height, dst, dstOffset);
    if (!dest) return orig.call(this, x, y, width, height, format, type, dst, dstOffset);

    const alignment = packAlignment(this);
    const rgba = new Uint8Array(width * height * 4);
    if (alignment !== 1) this.pixelStorei(GL_PACK_ALIGNMENT, 1);
    orig.call(this, x, y, width, height, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
    if (alignment !== 1) this.pixelStorei(GL_PACK_ALIGNMENT, alignment);

    packRgb(rgba, dest.bytes, dest.offset, width, height, alignment);
  };
}

/**
 * RGB + UNSIGNED_BYTE into a byte view. Anything else, including a pack
 * buffer offset, is left for the real readPixels.
 * @returns {{ bytes: Uint8Array, offset: number } | null}
 */
function rgbDestination(format, type, width, height, dst, dstOffset) {
  if (format !== GL_RGB || type !== GL_UNSIGNED_BYTE) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (!ArrayBuffer.isView(dst) || dst instanceof DataView) return null;
  const bytes = new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength);
  const offset = typeof dstOffset === 'number' ? dstOffset : 0;
  if (offset < 0) return null;
  return { bytes, offset };
}

function packAlignment(gl) {
  const value = gl.getParameter(GL_PACK_ALIGNMENT);
  return value === 1 || value === 2 || value === 4 || value === 8 ? value : 4;
}

function rowStride(width, alignment) {
  const row = width * 3;
  return (row + alignment - 1) & ~(alignment - 1);
}

function packRgb(rgba, bytes, offset, width, height, alignment) {
  const stride = rowStride(width, alignment);
  const end = offset + (height - 1) * stride + width * 3;
  if (end > bytes.length) {
    console.warn('[doom] screenshot buffer is shorter than the RGB read');
    return;
  }
  if (stride === width * 3) {
    let d = offset;
    const pixels = width * height;
    for (let i = 0, s = 0; i < pixels; i++, s += 4) {
      bytes[d++] = rgba[s];
      bytes[d++] = rgba[s + 1];
      bytes[d++] = rgba[s + 2];
    }
    return;
  }
  for (let row = 0; row < height; row++) {
    const src = row * width * 4;
    let d = offset + row * stride;
    for (let col = 0; col < width; col++) {
      const s = src + col * 4;
      bytes[d++] = rgba[s];
      bytes[d++] = rgba[s + 1];
      bytes[d++] = rgba[s + 2];
    }
  }
}
