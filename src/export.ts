import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';
import { canvasOf, MAPS } from './maps';
import type { Studio } from './studio';
export async function createArchive(studio: Studio, processed: boolean) {
  studio.endStroke();
  const files: Record<string, Uint8Array> = {};
  const maps = processed ? studio.processed : studio.maps;
  for (const kind of MAPS) {
    const c = canvasOf(processed ? maps[kind] : studio.sourceForExport(kind));
    const blob = await new Promise<Blob>((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(Error('Could not create the PNG.')), 'image/png'));
    files[`${kind}.png`] = new Uint8Array(await blob.arrayBuffer());
  }
  files['material.json'] = strToU8(JSON.stringify({
    version: 3,
    model: studio.modelName,
    export: processed ? 'processed' : 'original',
    processing: studio.processing,
    sourceSizes: Object.fromEntries(MAPS.map(k => [k, [studio.maps[k].width, studio.maps[k].height]])),
    exportSizes: Object.fromEntries(MAPS.map(k => [k, [maps[k].width, maps[k].height]])),
    specularStrength: studio.specStrength,
    glowStrength: studio.glowStrength,
    shininess: 65,
    glowColor: 'diffuse RGB multiplied by glow mask',
    colorSpace: {
      diffuse: 'sRGB',
      spec: 'linear intensity',
      glow: 'linear intensity'
    },
    sampling: 'nearest, clamp, no mipmaps',
    uvPadding: 'Colors and alpha extended into unused UV gutters for the selected grid. Island contents and editable source buffers are unchanged.',
    dither: {
      pattern: 'Bayer 8x8',
      stage: 'before-lighting',
      maps: MAPS,
      coordinates: 'shared texture grid, top-left origin',
      levels: 'per RGB channel, including black and white; nearest rounding with centered Bayer thresholds',
      bakedIntoTextures: processed && studio.processing.enabled,
      alpha: 'unchanged'
    },
    toneCurve: 'SurfacePixels luminance roll-off after lighting; no additional ACES curve or post-lighting dithering',
    unitySurfacePixels: {
      _TexelsPerPixel: processed || !studio.processing.enabled ? 1 : studio.processing.texels,
      _Dither: 0,
      _ColorLevels: 256
    },
    note: processed
      ? 'PNGs match the current map previews. Enabled grid sampling, color levels and dithering are baked into diffuse, spec and glow. Do not apply them again at runtime.'
      : 'PNGs retain source colors and resolution. To match the processed preview, apply the saved grid sampling, color levels and dithering to all three maps before lighting. The Unity SurfacePixels after-lighting dither is disabled because it does not reproduce this texture processing.'
  }, null, 2));
  return zipSync(files, {
    level: 6
  });
}
export async function exportMaps(studio: Studio, processed: boolean) {
  const blob = new Blob([new Uint8Array(await createArchive(studio, processed))], {
      type: 'application/zip'
    }),
    url = URL.createObjectURL(blob),
    link = document.createElement('a');
  const name = studio.modelName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  link.href = url;
  link.download = `${name || 'material'}_${processed ? 'pixel' : 'source'}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  // Texture export does not save the model, editor settings, camera or history.
}
