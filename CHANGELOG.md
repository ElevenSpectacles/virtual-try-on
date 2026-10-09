# Changelog

## [4.7.0](https://github.com/ElevenSpectacles/virtual-try-on/compare/v4.6.0...v4.7.0) (2026-10-09)


### Features

* move the contact shadow down onto the cheeks ([505ca93](https://github.com/ElevenSpectacles/virtual-try-on/commit/505ca93fe94e9d81766f9c0d90933e1e5d9d014a))
* move the contact shadow down onto the cheeks ([#6](https://github.com/ElevenSpectacles/virtual-try-on/issues/6)) ([aa71a36](https://github.com/ElevenSpectacles/virtual-try-on/commit/aa71a36f4849c37745ebdbfbc12068d6e06b720b))


### Bug Fixes

* centre the contact shadow on the bridge contact, not the head ([20307f0](https://github.com/ElevenSpectacles/virtual-try-on/commit/20307f015d35f0eeb5211c0e4870bdae625dfb5e))

## [4.6.0](https://github.com/ElevenSpectacles/virtual-try-on/compare/v4.5.0...v4.6.0) (2026-10-09)


### Features

* device capability tiering with frame-time step-down ([ef666af](https://github.com/ElevenSpectacles/virtual-try-on/commit/ef666afb0f854080d5b525dfadbe05cb742ade2e))
* fixed-pose frame for a deterministic contact-shadow check ([#6](https://github.com/ElevenSpectacles/virtual-try-on/issues/6)) ([d25b594](https://github.com/ElevenSpectacles/virtual-try-on/commit/d25b59489ca4c56d67b5a6b04c33c9c925fb26ee))
* improve face tracking ([c8962e7](https://github.com/ElevenSpectacles/virtual-try-on/commit/c8962e7a71328c77b919ef9d0a7fd34e413c6c3a))
* light the frame from the room and add a contact shadow ([ea4fac2](https://github.com/ElevenSpectacles/virtual-try-on/commit/ea4fac2ef49a89c5d223a27c0ab9b14fd0167da7))
* opt-in session metrics event ([#17](https://github.com/ElevenSpectacles/virtual-try-on/issues/17)) ([1af61b3](https://github.com/ElevenSpectacles/virtual-try-on/commit/1af61b31ff3944d5bf3c319629057d2e1f0979ff))


### Bug Fixes

* apply the tier prop reactively ([a38eca9](https://github.com/ElevenSpectacles/virtual-try-on/commit/a38eca93949a3612f4771745f24a0cdfe52c1f6f))
* apply the tier prop reactively, not only at setup ([8db4e28](https://github.com/ElevenSpectacles/virtual-try-on/commit/8db4e285be4f0106920eaddb2d7a0cafce827ed2))


### Refactoring

* schedule detection through a camera-frame helper ([9eacbd9](https://github.com/ElevenSpectacles/virtual-try-on/commit/9eacbd927d7ff4c82b7737f446912c1e88579783))

## [4.5.0](https://github.com/ElevenSpectacles/virtual-try-on/compare/v4.4.0...v4.5.0) (2026-10-08)


### Features

* enable the face-mesh occluder by default, configurable globally ([2f6a1c8](https://github.com/ElevenSpectacles/virtual-try-on/commit/2f6a1c803e6a1e9c03ca804def433ee88b664c50))
* enable the face-mesh occluder by default, configurable globally ([e80c8b6](https://github.com/ElevenSpectacles/virtual-try-on/commit/e80c8b6a9a5d79942c08d37e95095a17260af4bb))
* hold frame scale on MediaPipe blink blendshapes; bump MediaPipe to 1.1.0 ([769878d](https://github.com/ElevenSpectacles/virtual-try-on/commit/769878dbef0c03e03a3d165f601d83877e4bc0f9))
* hold frame scale on MediaPipe blink blendshapes; bump MediaPipe to 1.1.0 ([6293095](https://github.com/ElevenSpectacles/virtual-try-on/commit/629309524f2cb648e31400216d8191c95cbdfb15)), closes [#7](https://github.com/ElevenSpectacles/virtual-try-on/issues/7)

## [4.4.0](https://github.com/ElevenSpectacles/virtual-try-on/compare/v4.2.0...v4.4.0) (2026-10-08)


### Features

* render the frame only on a tracked face and drop the VueUse peer ([127c6ef](https://github.com/ElevenSpectacles/virtual-try-on/commit/127c6efab3ba89f4ee3e521200be3b79ffbb8edf))
* render the frame only on a tracked face and drop the VueUse peer ([d29f869](https://github.com/ElevenSpectacles/virtual-try-on/commit/d29f86961a0b8608c557917c32a1dac67d7af3bc))


### Bug Fixes

* **deps:** update nuxt kit, TresJS and dev tooling to latest minors ([e2ec4c0](https://github.com/ElevenSpectacles/virtual-try-on/commit/e2ec4c093c76a64e3e920fadace77bc576ce6c1e))
* **deps:** update nuxt kit, TresJS and dev tooling to latest minors ([c2be24f](https://github.com/ElevenSpectacles/virtual-try-on/commit/c2be24fd59151977e497747fdc587233c22ba2cc))

## [4.2.0](https://github.com/ElevenSpectacles/virtual-try-on/compare/v4.1.0...v4.2.0) (2026-10-08)


### Features

* ship TresJS and three with the module ([b30f2f2](https://github.com/ElevenSpectacles/virtual-try-on/commit/b30f2f2346fc43d44b4bb0be89edc4c1e30a8991))
* ship TresJS and three with the module ([6d07391](https://github.com/ElevenSpectacles/virtual-try-on/commit/6d073912a69affa9675bff32755a0147fdbbfc73))


### Bug Fixes

* stand the frame off the face so it tracks turned heads ([f1f3671](https://github.com/ElevenSpectacles/virtual-try-on/commit/f1f3671cf42d853e4413f372b7d190d52df98f97))
* stand the frame off the face so it tracks turned heads ([46b1a82](https://github.com/ElevenSpectacles/virtual-try-on/commit/46b1a82f55544325cd60ebaa2a4fae275f4ebf4b))
* stop the occluder cutting off the near temple on turned heads ([0c55ac4](https://github.com/ElevenSpectacles/virtual-try-on/commit/0c55ac4fd4314215d76a31c0ca539b9a0d92dfe7))
* stop the occluder cutting off the near temple on turned heads ([6ec70ce](https://github.com/ElevenSpectacles/virtual-try-on/commit/6ec70ce85cff6a6ecd5c59ce0fa08feb7b7ace34))

## [4.1.0](https://github.com/ElevenSpectacles/virtual-try-on/compare/v4.0.0...v4.1.0) (2026-10-08)


### Features

* ship @mediapipe/tasks-vision as a pinned dependency ([ff9fbc0](https://github.com/ElevenSpectacles/virtual-try-on/commit/ff9fbc009869ff15063578230344d57fdd6ed099))
* ship @mediapipe/tasks-vision as a pinned dependency ([42d2d39](https://github.com/ElevenSpectacles/virtual-try-on/commit/42d2d39acfeb9458ba54e7f06e3d7027050d22eb))


### Documentation

* title the README Virtual Try-On ([22cbcef](https://github.com/ElevenSpectacles/virtual-try-on/commit/22cbcefc71d3fedb4691480d92a38fab9b4c0dbb))

## [4.0.0](https://github.com/ElevenSpectacles/virtual-try-on/compare/v3.0.1...v4.0.0) (2026-10-07)


### ⚠ BREAKING CHANGES

* $tryOnLogger, useTryOnLogger and the TryOnLogger type are removed. Log TRY_ON_ERROR events from your track handler instead.
* @tresjs/cientos is no longer a peer dependency; @tresjs/core (provided by @tresjs/nuxt) is.
* the built-in consent screen, error panel, guide overlay and tuning sliders are gone, simplifiedControls is removed, @nuxt/ui is no longer a peer, and the component fills its container instead of sizing itself. Hosts render their UI in the default slot and call start() (or pass auto-start).
* @nuxtjs/i18n and vue-i18n are no longer peer dependencies and virtualTryOn.* messages are no longer registered. Hosts that overrode those keys must drop the overrides.

### Features

* drop @tresjs/cientos for three's own loaders ([76a9b72](https://github.com/ElevenSpectacles/virtual-try-on/commit/76a9b729eed4d231712d0e67444cc7123d5e4975))
* drop i18n, ship English-only copy ([25e0e35](https://github.com/ElevenSpectacles/virtual-try-on/commit/25e0e3569c94dc99f765c5b6ce3ebc0c43bc27ad))
* drop the logger; report failures through track ([aade811](https://github.com/ElevenSpectacles/virtual-try-on/commit/aade811a7489e22ee487cf287edbf08acab907ec))
* make VirtualTryOnExperience headless ([036d433](https://github.com/ElevenSpectacles/virtual-try-on/commit/036d433e321b886c3c9cb0cab146b9a360635122))


### Bug Fixes

* dedupe vue, three and tres peers to the host's copy ([56943db](https://github.com/ElevenSpectacles/virtual-try-on/commit/56943dbeeab44da9da36c5822ec527c0f79beb7c))


### Documentation

* link the Eleven Spectacles website ([710865d](https://github.com/ElevenSpectacles/virtual-try-on/commit/710865de0e929b0588576437488f20ebf8c75580))

## [3.0.1](https://github.com/ElevenSpectacles/virtual-try-on/compare/v3.0.0...v3.0.1) (2026-10-07)


### Bug Fixes

* publish to npm as a public package ([e417964](https://github.com/ElevenSpectacles/virtual-try-on/commit/e4179649c105da6b819cb693c21edb2b30e70707))
* publish to npm as a public package ([6a8affa](https://github.com/ElevenSpectacles/virtual-try-on/commit/6a8affaa8b5708c44a3dd1d68cdbee8273c85ad9))

## [3.0.0](https://github.com/ElevenSpectacles/virtual-try-on/compare/v2.0.0...v3.0.0) (2026-10-07)


### ⚠ BREAKING CHANGES

* hosts must point `modules` at the package (or `src/module` for local checkouts), import types from the package entry, own the modal UI, and provide `$tryOnLogger` instead of `useLogger()`.

### Features

* add safeguards ([1e12d4e](https://github.com/ElevenSpectacles/virtual-try-on/commit/1e12d4ea822f77423962c1576a5d0a7c3fa3ae80))
* add safeguards ([9c8b99d](https://github.com/ElevenSpectacles/virtual-try-on/commit/9c8b99d053a8e0f74c235229037d3b247b5cce9b))
* improve typesafety ([fb0b33a](https://github.com/ElevenSpectacles/virtual-try-on/commit/fb0b33adf078df1f814a08ddfb496e300aab8b6d))
* improve typesafety ([9a362e6](https://github.com/ElevenSpectacles/virtual-try-on/commit/9a362e6c30173f11af2fcac12664fce895991ce0))
* publish to npm via @nuxt/module-builder ([959b580](https://github.com/ElevenSpectacles/virtual-try-on/commit/959b580b3ef6ab9b82376b23ac2a06b093b7c8ee))


### Bug Fixes

* add explicit imports for host without auto-imports ([a2e23e7](https://github.com/ElevenSpectacles/virtual-try-on/commit/a2e23e7068165625961196730a01ecfc404110af))
* add explicit imports for host without auto-imports ([1117ec6](https://github.com/ElevenSpectacles/virtual-try-on/commit/1117ec6d16fc84c6404bd3c837a0ef94e614bfa6))
* **modal:** link the privacy policy by path for typed host routes ([c0e50e4](https://github.com/ElevenSpectacles/virtual-try-on/commit/c0e50e422df4c41ea15e64e0c8a94f674b28db3d))
* **modal:** link the privacy policy by path for typed host routes ([7f73d7b](https://github.com/ElevenSpectacles/virtual-try-on/commit/7f73d7bfbe6969a54df2849bee4a0356f9515fee))
* publish under the [@eleven](https://github.com/eleven).spectacles npm scope ([eef1c33](https://github.com/ElevenSpectacles/virtual-try-on/commit/eef1c33eb69508466fa8d7340e8870451a7292ac))
* publish under the [@eleven](https://github.com/eleven).spectacles npm scope ([24ebe39](https://github.com/ElevenSpectacles/virtual-try-on/commit/24ebe399ce40c98e3c7ee111b118ec2b2d2732b8))
* **TryOnScene:** dispose occluder geometry and bbox helper ([dea8f14](https://github.com/ElevenSpectacles/virtual-try-on/commit/dea8f14e94f11bb16120e1458854e929c8a32bbf))


### Documentation

* mark GLB compression resolved and fix host script paths ([002e7cf](https://github.com/ElevenSpectacles/virtual-try-on/commit/002e7cf4a1a47322a14076ac3010360812e43a9a))
* mark GLB compression resolved, fix host script paths ([ff9e572](https://github.com/ElevenSpectacles/virtual-try-on/commit/ff9e5727c3e10803a5acf0bea9a752a541eb640b))

## [2.0.0](https://github.com/ElevenSpectacles/virtual-try-on/compare/virtual-try-on-v1.0.0...virtual-try-on-v2.0.0) (2026-10-07)


### ⚠ BREAKING CHANGES

* hosts must point `modules` at the package (or `src/module` for local checkouts), import types from the package entry, own the modal UI, and provide `$tryOnLogger` instead of `useLogger()`.

### Features

* add safeguards ([1e12d4e](https://github.com/ElevenSpectacles/virtual-try-on/commit/1e12d4ea822f77423962c1576a5d0a7c3fa3ae80))
* add safeguards ([9c8b99d](https://github.com/ElevenSpectacles/virtual-try-on/commit/9c8b99d053a8e0f74c235229037d3b247b5cce9b))
* improve typesafety ([fb0b33a](https://github.com/ElevenSpectacles/virtual-try-on/commit/fb0b33adf078df1f814a08ddfb496e300aab8b6d))
* improve typesafety ([9a362e6](https://github.com/ElevenSpectacles/virtual-try-on/commit/9a362e6c30173f11af2fcac12664fce895991ce0))
* publish to npm via @nuxt/module-builder ([959b580](https://github.com/ElevenSpectacles/virtual-try-on/commit/959b580b3ef6ab9b82376b23ac2a06b093b7c8ee))


### Bug Fixes

* add explicit imports for host without auto-imports ([a2e23e7](https://github.com/ElevenSpectacles/virtual-try-on/commit/a2e23e7068165625961196730a01ecfc404110af))
* add explicit imports for host without auto-imports ([1117ec6](https://github.com/ElevenSpectacles/virtual-try-on/commit/1117ec6d16fc84c6404bd3c837a0ef94e614bfa6))
* **modal:** link the privacy policy by path for typed host routes ([c0e50e4](https://github.com/ElevenSpectacles/virtual-try-on/commit/c0e50e422df4c41ea15e64e0c8a94f674b28db3d))
* **modal:** link the privacy policy by path for typed host routes ([7f73d7b](https://github.com/ElevenSpectacles/virtual-try-on/commit/7f73d7bfbe6969a54df2849bee4a0356f9515fee))
* **TryOnScene:** dispose occluder geometry and bbox helper ([dea8f14](https://github.com/ElevenSpectacles/virtual-try-on/commit/dea8f14e94f11bb16120e1458854e929c8a32bbf))


### Documentation

* mark GLB compression resolved and fix host script paths ([002e7cf](https://github.com/ElevenSpectacles/virtual-try-on/commit/002e7cf4a1a47322a14076ac3010360812e43a9a))
* mark GLB compression resolved, fix host script paths ([ff9e572](https://github.com/ElevenSpectacles/virtual-try-on/commit/ff9e5727c3e10803a5acf0bea9a752a541eb640b))
