import type { MeshPhongMaterial } from 'three';

// Keep SurfacePixels' luminance roll-off ahead of fog, sRGB conversion and
// bloom. Maps arrive already quantized; lighting itself stays continuous.
export function installSurfaceLook(material: MeshPhongMaterial) {
  const uniforms = {
    workshopUnlit: {
      value: false
    },
    workshopSpecularStrength: {
      value: 1
    }
  };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform bool workshopUnlit;
uniform float workshopSpecularStrength;
vec3 workshopLitColor(vec3 color) {
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  vec3 chroma = color / max(luma, 1e-4);
  float shaped = luma / (1.0 + max(luma - 0.35, 0.0) * 0.75);
  return chroma * shaped;
}`).replace('#include <specularmap_fragment>', `#include <specularmap_fragment>
// Scale the entire specular response, including Fresnel and reflections.
// Changing Phong's F0 color alone leaves a grazing highlight at strength zero.
specularStrength *= workshopSpecularStrength;
`).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= diffuseColor.rgb;').replace('#include <opaque_fragment>', `
// outgoingLight already includes diffuse light, specular, emission and envmap.
// Unlit shows the map itself, without the lighting roll-off or emission.
outgoingLight = workshopUnlit ? diffuseColor.rgb : workshopLitColor(outgoingLight);
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'workshop-surface-look-v4';
  return {
    setUnlit(unlit: boolean) {
      uniforms.workshopUnlit.value = unlit;
    },
    setSpecularStrength(strength: number) {
      uniforms.workshopSpecularStrength.value = strength;
    }
  };
}
