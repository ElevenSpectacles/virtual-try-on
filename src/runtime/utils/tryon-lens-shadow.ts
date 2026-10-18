/**
 * Tinted lens shadow (issue #88, step 3). Pure math, no three.js.
 *
 * Light through a tinted lens takes the lens's colour, so a brown lens
 * throws a warm shadow and a green one a green shadow (the HSV step in
 * Ditto's US10403036B2). The contact shadow is a multiply (PR #89): a black
 * canvas texel of alpha a leaves `video × (1 − a)`, which can only darken
 * all channels alike. A per-channel multiply needs the camera pixel itself,
 * so the tinted path samples the video in the shader. To stay robust to the
 * texture being a frame behind the DOM video, only the *colour* of the
 * shadow comes from that sample: the alpha does the darkening every channel
 * shares (`1 − min(multiply)`), against the real video, exactly as before,
 * and the colour residual is added on top (`tintedShadowComposite`).
 */

/**
 * Per-channel transmission of a lens colour, normalized so its brightest
 * channel passes everything: the colour's *hue* tints the shadow, its
 * darkness is the lens density's job. White (or no tint) is neutral.
 */
export function lensTransmission(
  tint: readonly [number, number, number] | null
): [number, number, number] {
  if (!tint) return [1, 1, 1]
  const max = Math.max(tint[0], tint[1], tint[2])
  if (max <= 0) return [1, 1, 1]
  return [tint[0] / max, tint[1] / max, tint[2] / max]
}

/**
 * The per-channel multiply on the skin: frame shadow and contact occlusion
 * (neutral, `frameLit` and `occluded` are the light they leave, 0…1) times
 * the lens shadow, which removes `lensBlock` (0…1) of the light the lens
 * does not transmit.
 */
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

/**
 * What the receiver writes, as the canvas premultiplies it over the video:
 * alpha darkens all channels by the smallest multiply, the colour carries
 * the rest from the video sample. Composited, `rgb·α_premultiplied + video ×
 * (1 − α)` equals `video × multiply` when the sample matches the video.
 * Returns the straight (non-premultiplied) colour the shader outputs.
 */
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

/** The bits of a depth material the per-light caster filter toggles. */
interface WritableMaterial {
  colorWrite: boolean
  depthWrite: boolean
}

/**
 * Shadow-pass hooks that make a mesh cast into only one of two shadow maps:
 * the lens light's (`lens` true) or the frame light's. three.js renders
 * every caster into every shadow map (its layer test uses the *viewing*
 * camera's layers, not the shadow camera's), so the hook turns the depth
 * material's writes off for the other light's draw and back on after it.
 * `lensCamera` is the lens light's shadow camera, compared by identity.
 */
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

/**
 * Fragment GLSL for the tinted path, placed where the receiver writes
 * `gl_FragColor`; expects `occluded` (contact occlusion's remaining light)
 * in scope. Directional shadow 0 is the frame's light, 1 the lens light
 * (the order the two shadow lights are in the scene). Mirrors
 * `tintedShadowMultiply` and `tintedShadowComposite`.
 */
export const TINTED_SHADOW_FRAGMENT = /* glsl */ `
  DirectionalLightShadow frameShadowLight = directionalLightShadows[ 0 ];
  float frameMask = getShadow( directionalShadowMap[ 0 ], frameShadowLight.shadowMapSize, frameShadowLight.shadowIntensity, frameShadowLight.shadowBias, frameShadowLight.shadowRadius, vDirectionalShadowCoord[ 0 ] );
  DirectionalLightShadow lensShadowLight = directionalLightShadows[ 1 ];
  float lensMask = getShadow( directionalShadowMap[ 1 ], lensShadowLight.shadowMapSize, lensShadowLight.shadowIntensity, lensShadowLight.shadowBias, lensShadowLight.shadowRadius, vDirectionalShadowCoord[ 1 ] );
  float frameLit = 1.0 - opacity * ( 1.0 - frameMask );
  float lensBlock = opacity * uLensShadowDensity * ( 1.0 - lensMask );
  vec3 shadowMultiply = frameLit * occluded * ( 1.0 - lensBlock * ( 1.0 - uLensTransmission ) );
  float lowest = min( shadowMultiply.r, min( shadowMultiply.g, shadowMultiply.b ) );
  float shadowAlpha = 1.0 - lowest;
  vec2 ndc = vTintClip.xy / vTintClip.w;
  vec2 screen = vec2( ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5 );
  // Mirrored preview, object-fit: cover window (as the hair occluder).
  vec2 media = vec2(
    uWindow.x + ( 1.0 - screen.x ) * ( uWindow.y - uWindow.x ),
    uWindow.z + screen.y * ( uWindow.w - uWindow.z )
  );
  vec3 cameraPixel = texture2D( uVideo, vec2( media.x, 1.0 - media.y ) ).rgb;
  gl_FragColor = vec4( shadowAlpha > 0.001 ? cameraPixel * ( shadowMultiply - lowest ) / shadowAlpha : vec3( 0.0 ), shadowAlpha );
`
