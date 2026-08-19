export default {
  virtualTryOn: {
    consent: {
      title: 'Virtual Try-On',
      subtitle: 'Sieh live, wie dieses Modell dir steht.',
      cameraUse: 'Nutzt deine Frontkamera',
      privacy: 'Dein Video verlässt niemals dein Gerät',
      noStorage: 'Es werden keine Aufnahmen gespeichert',
      localProcessing: 'Gesichtserkennung läuft lokal im Browser',
      cta: 'Kamerazugriff erlauben',
      whyWeAsk: 'Warum wir Kamerazugriff brauchen'
    },
    denied: {
      title: 'Kamerazugriff verweigert',
      body: 'Erlaube den Kamerazugriff in den Browsereinstellungen, um Virtual Try-On zu nutzen.',
      retry: 'Erneut versuchen'
    },
    noCamera: {
      title: 'Keine Kamera verfügbar',
      body: 'Dieses Gerät hat keine nutzbare Kamera, oder der Browser blockiert den Zugriff.'
    },
    guide: {
      noFace: 'Positioniere dein Gesicht innerhalb der Umrisslinie',
      tooFar: 'Komm näher',
      tooClose: 'Geh etwas zurück'
    },
    noFace: 'Kein Gesicht erkannt – halte die Kamera auf dein Gesicht',
    tryOnProduct: '{product} virtuell anprobieren',
    trackingConfidence: 'Gesicht wird erkannt...',
    faceDetected: 'Gesicht erkannt',
    stopCamera: 'Kamera stoppen',
    startCamera: 'Kamera starten',
    retryCamera: 'Kamera erneut versuchen',
    trackMyFace: 'Mein Gesicht tracken (MediaPipe)',
    frame: 'Modell',
    exposure: 'Belichtung',
    frameScale: 'Modell-Skala',
    frameYaw: 'Modell-Drehung',
    templeWidth: 'Bügelbreite',
    prototypeBadge: 'Prototyp',
    modal: {
      title: 'Virtual Try-On',
      close: 'Schließen',
      privacy: {
        title: 'Deine Privatsphäre zählt',
        body: 'Virtual Try-On nutzt deine Kamera. Dein Video wird ganz auf deinem Gerät verarbeitet – ohne Upload, Teilen oder Speichern.',
        cta: 'Weiter zum Virtual Try-On',
        policy: {
          before: 'Lies unsere',
          link: 'Datenschutzerklärung',
          after: 'für Details.'
        },
        noStorage: {
          title: 'Keine Aufnahmen gespeichert',
          body: 'Wir speichern keine Fotos, Videos oder Gesichtsdaten.'
        },
        localProcessing: {
          title: 'Lokal auf deinem Gerät verarbeitet',
          body: 'Gesichtserkennung läuft lokal in deinem Browser.'
        },
        noAccount: {
          title: 'Kein Account nötig',
          body: 'Probiere Modelle ohne Registrierung oder Login an.'
        },
        youControl: {
          title: 'Du hast die Kontrolle',
          body: 'Stoppe die Kamera jederzeit.'
        }
      }
    },
    suggestions: {
      ariaLabel: 'Modellvorschläge',
      title: 'Einen anderen Look probieren'
    }
  }
}
