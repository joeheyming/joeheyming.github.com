import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IMG2IMG_STEPS,
  addNoise,
  coverCrop,
  eulerSchedule,
  eulerUpdate,
  latentMean,
  rgbaToModelInput,
  float16BitsToFloat32,
  float32ToFloat16Bits,
  scaleLatent,
  scaleModelInputs,
  strengthStart,
  unitNoise
} from '../imagine/sd-turbo-math.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('sd-turbo scheduler', () => {
  it('matches the one-step sigma the text-to-image path already uses', () => {
    const one = eulerSchedule(1);
    assert.deepEqual(one.timesteps, [999]);
    assert.ok(Math.abs(one.sigmas[0] - 14.614641229333643) < 1e-9);
    assert.equal(one.sigmas[1], 0);
  });

  it('starts image-to-image later in a 4-step schedule as strength drops', () => {
    const four = eulerSchedule(IMG2IMG_STEPS);
    assert.deepEqual(four.timesteps, [999, 749, 499, 249]);
    assert.equal(strengthStart(4, 1), 0);
    assert.equal(strengthStart(4, 0.55), 2);
    assert.equal(strengthStart(4, 0.1), 3);
    assert.ok(four.sigmas[2] < four.sigmas[0]);
  });

  it('reduces a final Euler step to the text-to-image update', () => {
    const sample = Float32Array.from([10, -4]);
    const pred = Float32Array.from([0.5, -0.25]);
    const sigma = 14.6146;
    const out = eulerUpdate(sample, pred, sigma, 0);
    assert.ok(Math.abs(out[0] - (sample[0] - sigma * pred[0])) < 1e-4);
    assert.ok(Math.abs(out[1] - (sample[1] - sigma * pred[1])) < 1e-4);
  });

  it('adds noise at the chosen sigma and scales the UNet input', () => {
    const latents = Float32Array.from([0.2, -0.2]);
    const noise = unitNoise(2, 7);
    const noisy = addNoise(latents, noise, 2);
    assert.ok(Math.abs(noisy[0] - (0.2 + noise[0] * 2)) < 1e-6);
    const scaled = scaleModelInputs(noisy, 2);
    const divi = Math.sqrt(4 + 1);
    assert.ok(Math.abs(scaled[0] - noisy[0] / divi) < 1e-6);
  });
});

describe('sd-turbo image prep', () => {
  it('packs RGBA into NCHW in [-1, 1]', () => {
    const rgba = Uint8ClampedArray.from([255, 0, 128, 255, 0, 255, 0, 255]);
    const nchw = rgbaToModelInput(rgba, 2, 1);
    assert.equal(nchw.length, 6);
    assert.ok(Math.abs(nchw[0] - 1) < 1e-6);
    assert.ok(Math.abs(nchw[2] - -1) < 1e-6);
    assert.ok(Math.abs(nchw[3] - 1) < 1e-6);
  });

  it('cover-crops a wide image to the center', () => {
    const crop = coverCrop(1000, 500, 512);
    assert.ok(crop.dw >= 512 && crop.dh >= 512);
    assert.ok(crop.dx < 0);
    assert.equal(crop.dy, 0);
  });

  it('keeps a 4-channel latent and scales it', () => {
    const mean = latentMean(Float32Array.from([1, 2, 3, 4]), [1, 4, 1, 1]);
    assert.equal(mean.length, 4);
    const scaled = scaleLatent(mean, 0.5);
    assert.equal(scaled[0], 0.5);
  });

  it('takes the mean half of an 8-channel latent', () => {
    const data = Float32Array.from([1, 2, 3, 4, 9, 9, 9, 9]);
    const mean = latentMean(data, [1, 8, 1, 1]);
    assert.deepEqual(Array.from(mean), [1, 2, 3, 4]);
  });

  it('round-trips the values the VAE encoder sees through float16 bits', () => {
    const values = Float32Array.from([0, -0, 1, -1, 0.5, -0.5, 2, 0.18215]);
    const bits = float32ToFloat16Bits(values);
    assert.equal(bits[2], 0x3c00);
    assert.equal(bits[3], 0xbc00);
    assert.equal(bits[4], 0x3800);
    const back = float16BitsToFloat32(bits);
    assert.equal(back[2], 1);
    assert.equal(back[3], -1);
    assert.ok(Math.abs(back[7] - 0.18215) < 0.001);
    assert.equal(float16BitsToFloat32(values), values);
    assert.equal(
      float16BitsToFloat32(float32ToFloat16Bits(Float32Array.of(Infinity)))[0],
      Infinity
    );
    assert.ok(Number.isNaN(float16BitsToFloat32(float32ToFloat16Bits(Float32Array.of(NaN)))[0]));
    const engine = readFileSync(path.join(ROOT, 'imagine/sd-turbo.js'), 'utf8');
    assert.match(engine, /new ort\.Tensor\('float16', float32ToFloat16Bits/);
  });
});
