export default {
  virtualTryOn: {
    consent: {
      title: 'Virtual Try-On',
      subtitle: 'Voir en direct comment ce modèle te va.',
      cameraUse: 'Utilise ta caméra frontale',
      privacy: 'Ta vidéo ne quitte jamais ton appareil',
      noStorage: 'Aucun enregistrement n’est stocké',
      localProcessing:
        'Le suivi facial fonctionne localement dans ton navigateur',
      cta: 'Autoriser la caméra',
      whyWeAsk: 'Pourquoi nous demandons l’accès à la caméra',
      uploadFallback: 'Ou importer une photo'
    },
    denied: {
      title: 'Accès caméra refusé',
      body: 'Autorise l’accès à la caméra dans les paramètres de ton navigateur pour utiliser le Virtual Try-On.',
      retry: 'Réessayer'
    },
    noCamera: {
      title: 'Aucune caméra disponible',
      body: 'Cet appareil n’a pas de caméra utilisable, ou ton navigateur bloque l’accès.'
    },
    upload: {
      title: 'Importer une photo',
      body: 'Choisis une photo de face bien éclairée et nous placerons le modèle par-dessus. Ta photo ne quitte jamais ton appareil.',
      cta: 'Choisir une photo',
      acceptedFormats: 'JPG, PNG, WEBP',
      changePhoto: 'Changer de photo',
      useCamera: 'Utiliser la caméra'
    },
    guide: {
      noFace: 'Placez votre visage à l’intérieur du contour',
      tooFar: 'Rapprochez-vous',
      tooClose: 'Reculez un peu'
    },
    noFace: 'Aucun visage détecté – dirige la caméra vers ton visage',
    trackingConfidence: 'Détection du visage...',
    faceDetected: 'Visage détecté',
    stopCamera: 'Arrêter la caméra',
    startCamera: 'Démarrer la caméra',
    retryCamera: 'Réessayer la caméra',
    trackMyFace: 'Suivre mon visage (MediaPipe)',
    frame: 'Modèle',
    exposure: 'Exposition',
    frameScale: 'Échelle du modèle',
    frameYaw: 'Rotation du modèle',
    templeWidth: 'Largeur des branches',
    suggestions: {
      ariaLabel: 'Suggestions de montures',
      title: 'Essayer un autre look'
    }
  }
}
