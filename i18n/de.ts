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
      whyWeAsk: 'Warum wir Kamerazugriff brauchen',
      uploadFallback: 'Oder lade ein Foto hoch'
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
    upload: {
      title: 'Foto hochladen',
      body: 'Wähle ein gut ausgeleuchtetes Frontalfoto und wir platzieren das Modell darüber. Dein Foto verlässt niemals dein Gerät.',
      cta: 'Foto auswählen',
      acceptedFormats: 'JPG, PNG, WEBP',
      changePhoto: 'Foto ändern',
      useCamera: 'Stattdessen Kamera nutzen'
    },
    guide: {
      noFace: 'Positioniere dein Gesicht innerhalb der Umrisslinie',
      tooFar: 'Komm näher',
      tooClose: 'Geh etwas zurück'
    },
    noFace: 'Kein Gesicht erkannt – halte die Kamera auf dein Gesicht',
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
    suggestions: {
      ariaLabel: 'Modellvorschläge',
      title: 'Einen anderen Look probieren'
    }
  }
}
