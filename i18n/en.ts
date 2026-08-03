export default {
  virtualTryOn: {
    consent: {
      title: 'Virtual Try-On',
      subtitle: 'See how this frame looks on you in real time.',
      cameraUse: 'Uses your front camera',
      privacy: 'Your video never leaves your device',
      noStorage: 'No recordings are stored',
      localProcessing: 'Face tracking runs locally in your browser',
      cta: 'Allow camera access',
      whyWeAsk: 'Why we ask for camera access',
      uploadFallback: 'Or upload a photo instead'
    },
    denied: {
      title: 'Camera access denied',
      body: 'Please allow camera access in your browser settings to use Virtual Try-On.',
      retry: 'Try again'
    },
    noCamera: {
      title: 'No camera available',
      body: 'This device does not have a usable camera, or your browser blocks camera access.'
    },
    upload: {
      title: 'Upload a photo',
      body: 'Choose a well-lit front-facing photo and we’ll place the frame over it. Your photo never leaves your device.',
      cta: 'Choose photo',
      acceptedFormats: 'JPG, PNG, WEBP',
      changePhoto: 'Change photo',
      useCamera: 'Use camera instead'
    },
    guide: {
      noFace: 'Position your face inside the outline',
      tooFar: 'Move closer',
      tooClose: 'Move back a little'
    },
    noFace: 'No face detected — point the camera at your face',
    trackingConfidence: 'Tracking face...',
    faceDetected: 'Face detected',
    stopCamera: 'Stop camera',
    startCamera: 'Start camera',
    retryCamera: 'Retry camera',
    trackMyFace: 'Track my face (MediaPipe)',
    frame: 'Frame',
    exposure: 'Exposure',
    frameScale: 'Frame scale',
    frameYaw: 'Frame yaw',
    templeWidth: 'Temple width',
    prototypeBadge: 'Prototype',
    modal: {
      title: 'Virtual Try-On',
      close: 'Close',
      privacy: {
        title: 'Your privacy matters',
        body: 'Virtual Try-On uses your camera or a photo. Your image is processed entirely on your device. It is never uploaded, shared, or stored.',
        cta: 'Continue to Virtual Try-On',
        policy: {
          before: 'Read our',
          link: 'Privacy Policy',
          after: 'for more details.'
        },
        noStorage: {
          title: 'No recordings stored',
          body: 'We never save photos, videos, or face data.'
        },
        localProcessing: {
          title: 'Processed on your device',
          body: 'Face tracking runs locally in your browser.'
        },
        noAccount: {
          title: 'No account required',
          body: 'Try on frames without registration or login.'
        },
        youControl: {
          title: 'You control the camera',
          body: 'Stop the camera at any time.'
        }
      }
    },
    suggestions: {
      ariaLabel: 'Frame suggestions',
      title: 'Try a different look'
    }
  }
}
