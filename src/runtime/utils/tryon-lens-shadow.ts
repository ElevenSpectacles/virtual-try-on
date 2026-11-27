export function lensTransmission(
  tint: readonly [number, number, number] | null
): [number, number, number] {
  if (!tint) return [1, 1, 1]
  const max = Math.max(tint[0], tint[1], tint[2])
  if (max <= 0) return [1, 1, 1]
  return [tint[0] / max, tint[1] / max, tint[2] / max]
}

export function tintedShadowMultiply(
  frameLit: number,
  occluded: number,
  lensBlock: number,
  transmission: readonly [number, number, number]
): [number, number, number] {
  const base = frameLit * occluded
  return [0, 1, 2].map((c) => base * (1 - lensBlock * (1 - transmission[c]!))) as [
    number,
    number,
    number
  ]
}

export function tintedShadowComposite(
  video: readonly [number, number, number],
  multiply: readonly [number, number, number]
): { rgb: [number, number, number]; alpha: number } {
  const lowest = Math.min(multiply[0], multiply[1], multiply[2])
  const alpha = 1 - lowest
  const rgb = [0, 1, 2].map((c) =>
    alpha > 1e-3 ? (video[c]! * (multiply[c]! - lowest)) / alpha : 0
  ) as [number, number, number]
  return { rgb, alpha }
}

interface WritableMaterial {
  colorWrite: boolean
  depthWrite: boolean
}

export function shadowCasterFilter(lens: boolean, lensCamera: () => unknown) {
  let saved: [boolean, boolean] | null = null
  return {
    onBeforeShadow(
      _renderer: unknown,
      _object: unknown,
      _camera: unknown,
      shadowCamera: unknown,
      _geometry: unknown,
      depthMaterial: WritableMaterial
    ) {
      if ((shadowCamera === lensCamera()) === lens) return
      saved = [depthMaterial.colorWrite, depthMaterial.depthWrite]
      depthMaterial.colorWrite = false
      depthMaterial.depthWrite = false
    },
    onAfterShadow(
      _renderer: unknown,
      _object: unknown,
      _camera: unknown,
      _shadowCamera: unknown,
      _geometry: unknown,
      depthMaterial: WritableMaterial
    ) {
      if (!saved) return
      depthMaterial.colorWrite = saved[0]
      depthMaterial.depthWrite = saved[1]
      saved = null
    }
  }
}

export const TINTED_SHADOW_FRAGMENT = /* glsl */ `
  DirectionalLightShadow frameShadowLight = directionalLightShadows[ 0 ];
  float frameMask = getShadow( directionalShadowMap[ 0 ], frameShadowLight.shadowMapSize, frameShadowLight.shadowIntensity, frameShadowLight.shadowBias, frameShadowLight.shadowRadius, vDirectionalShadowCoord[ 0 ] );
  DirectionalLightShadow lensShadowLight = directionalLightShadows[ 1 ];
  float lensMask = getShadow( directionalShadowMap[ 1 ], lensShadowLight.shadowMapSize, lensShadowLight.shadowIntensity, lensShadowLight.shadowBias, lensShadowLight.shadowRadius, vDirectionalShadowCoord[ 1 ] );
  float frameLit = 1.0 - opacity * ( 1.0 - frameMask );
  float lensBlock = opacity * uLensShadowDensity * ( 1.0 - lensMask );
  vec3 shadowMultiply = tryOnTintedMultiply( frameLit, occluded, lensBlock, uLensTransmission );
  vec2 ndc = vTintClip.xy / vTintClip.w;
  vec2 screen = vec2( ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5 );
  vec2 media = tryOnScreenToMedia( screen, uWindow );
  vec3 cameraPixel = texture2D( uVideo, vec2( media.x, 1.0 - media.y ) ).rgb;
  gl_FragColor = tryOnTintedComposite( cameraPixel, shadowMultiply );
`

export const TINTED_SHADOW_GLSL = /* glsl */ `
vec3 tryOnTintedMultiply( float frameLit, float occluded, float lensBlock, vec3 transmission ) {
  return frameLit * occluded * ( 1.0 - lensBlock * ( 1.0 - transmission ) );
}
vec4 tryOnTintedComposite( vec3 video, vec3 multiply ) {
  float lowest = min( multiply.r, min( multiply.g, multiply.b ) );
  float alpha = 1.0 - lowest;
  return vec4( alpha > 0.001 ? video * ( multiply - lowest ) / alpha : vec3( 0.0 ), alpha );
}
`
