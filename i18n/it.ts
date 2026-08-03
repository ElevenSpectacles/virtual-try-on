export default {
  virtualTryOn: {
    consent: {
      title: 'Virtual Try-On',
      subtitle: 'Vedi in tempo reale come ti sta questo modello.',
      cameraUse: 'Usa la fotocamera frontale',
      privacy: 'Il tuo video non lascia mai il dispositivo',
      noStorage: 'Nessuna registrazione viene salvata',
      localProcessing: 'Il tracking del viso avviene localmente nel browser',
      cta: 'Consenti accesso fotocamera',
      whyWeAsk: 'Perché chiediamo l’accesso alla fotocamera',
      uploadFallback: 'O carica una foto'
    },
    denied: {
      title: 'Accesso fotocamera negato',
      body: 'Consenti l’accesso alla fotocamera nelle impostazioni del browser per usare il Virtual Try-On.',
      retry: 'Riprova'
    },
    noCamera: {
      title: 'Nessuna fotocamera disponibile',
      body: 'Questo dispositivo non ha una fotocamera utilizzabile, o il browser blocca l’accesso.'
    },
    upload: {
      title: 'Carica una foto',
      body: 'Scegli una foto frontale ben illuminata e posizioneremo il modello sopra. La tua foto non lascia mai il dispositivo.',
      cta: 'Scegli foto',
      acceptedFormats: 'JPG, PNG, WEBP',
      changePhoto: 'Cambia foto',
      useCamera: 'Usa la fotocamera'
    },
    guide: {
      noFace: 'Posiziona il viso all’interno del contorno',
      tooFar: 'Avvicinati',
      tooClose: 'Allontanati un po’'
    },
    noFace: 'Nessun viso rilevato – punta la fotocamera verso il tuo viso',
    trackingConfidence: 'Rilevamento volto...',
    faceDetected: 'Volto rilevato',
    stopCamera: 'Ferma fotocamera',
    startCamera: 'Avvia fotocamera',
    retryCamera: 'Riprova fotocamera',
    trackMyFace: 'Traccia il mio viso (MediaPipe)',
    frame: 'Modello',
    exposure: 'Esposizione',
    frameScale: 'Scala modello',
    frameYaw: 'Rotazione modello',
    templeWidth: 'Larghezza aste',
    prototypeBadge: 'Prototipo',
    modal: {
      title: 'Prova virtuale',
      close: 'Chiudi',
      privacy: {
        title: 'La tua privacy è importante',
        body: 'La prova virtuale usa la fotocamera o una foto. La tua immagine viene elaborata interamente sul tuo dispositivo e non viene mai caricata, condivisa o salvata.',
        cta: 'Continua con la prova virtuale',
        policy: {
          before: 'Leggi la nostra',
          link: 'Informativa sulla privacy',
          after: 'per maggiori dettagli.'
        },
        noStorage: {
          title: 'Nessuna registrazione viene salvata',
          body: 'Non salviamo mai foto, video o dati del viso.'
        },
        localProcessing: {
          title: 'Elaborata sul tuo dispositivo',
          body: 'Il tracking del viso avviene localmente nel browser.'
        },
        noAccount: {
          title: 'Nessun account richiesto',
          body: 'Prova i modelli senza registrazione o login.'
        },
        youControl: {
          title: 'Hai il controllo della fotocamera',
          body: 'Ferma la fotocamera quando vuoi.'
        }
      }
    },
    suggestions: {
      ariaLabel: 'Suggerimenti modelli',
      title: 'Prova un altro look'
    }
  }
}
