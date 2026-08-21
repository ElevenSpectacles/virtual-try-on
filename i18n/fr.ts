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
      whyWeAsk: 'Pourquoi nous demandons l’accès à la caméra'
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
    guide: {
      noFace: 'Placez votre visage à l’intérieur du contour',
      tooFar: 'Rapprochez-vous',
      tooClose: 'Reculez un peu'
    },
    noFace: 'Aucun visage détecté – dirige la caméra vers ton visage',
    tryOnProduct: 'Essayer {product} virtuellement',
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
    prototypeBadge: 'Prototype',
    modal: {
      title: 'Essai virtuel',
      close: 'Fermer',
      privacy: {
        title: 'Ta vie privée compte',
        body: 'L’essai virtuel utilise ta caméra. Ta vidéo est traitée entièrement sur ton appareil. Elle n’est jamais téléchargée, partagée ni stockée.',
        cta: 'Continuer vers l’essai virtuel',
        policy: {
          before: 'Consulte notre',
          link: 'Politique de confidentialité',
          after: 'pour en savoir plus.'
        },
        noStorage: {
          title: 'Aucun enregistrement stocké',
          body: 'Nous ne conservons jamais de photos, vidéos ou données faciales.'
        },
        localProcessing: {
          title: 'Traité sur ton appareil',
          body: 'Le suivi facial fonctionne localement dans ton navigateur.'
        },
        noAccount: {
          title: 'Aucun compte requis',
          body: 'Essaye les montures sans inscription ni connexion.'
        },
        youControl: {
          title: 'Tu contrôles la caméra',
          body: 'Arrête la caméra à tout moment.'
        }
      }
    },
    experience: {
      fallback: 'Chargement en cours…'
    },
    suggestions: {
      ariaLabel: 'Suggestions de montures',
      title: 'Essayer un autre look'
    }
  }
}
