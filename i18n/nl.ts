export default {
  virtualTryOn: {
    consent: {
      title: 'Virtual Try-On',
      subtitle: 'Zie live hoe dit montuur je staat.',
      cameraUse: 'Gebruikt je frontcamera',
      privacy: 'Je video verlaat nooit je apparaat',
      noStorage: 'Er worden geen opnames opgeslagen',
      localProcessing: 'Gezichtsherkenning draait lokaal in je browser',
      cta: 'Cameratoegang toestaan',
      whyWeAsk: 'Waarom we cameratoegang vragen'
    },
    denied: {
      title: 'Cameratoegang geweigerd',
      body: 'Sta cameratoegang toe in je browserinstellingen om Virtual Try-On te gebruiken.',
      retry: 'Opnieuw proberen'
    },
    noCamera: {
      title: 'Geen camera beschikbaar',
      body: 'Dit apparaat heeft geen bruikbare camera, of je browser blokkeert de toegang.'
    },
    guide: {
      noFace: 'Plaats je gezicht binnen de omtrek',
      tooFar: 'Kom dichterbij',
      tooClose: 'Ga iets naar achteren'
    },
    noFace: 'Geen gezicht gedetecteerd – richt de camera op je gezicht',
    tryOnProduct: 'Pas {product} virtueel',
    trackingConfidence: 'Gezicht wordt herkend...',
    faceDetected: 'Gezicht gedetecteerd',
    stopCamera: 'Camera stoppen',
    startCamera: 'Camera starten',
    retryCamera: 'Camera opnieuw proberen',
    trackMyFace: 'Mijn gezicht tracken (MediaPipe)',
    frame: 'Montuur',
    exposure: 'Belichting',
    frameScale: 'Montuurschaal',
    frameYaw: 'Montuurdraaiing',
    templeWidth: 'Pootbreedte',
    prototypeBadge: 'Prototype',
    modal: {
      title: 'Virtual Try-On',
      close: 'Sluiten',
      privacy: {
        title: 'Je privacy telt',
        body: 'Virtual Try-On gebruikt je camera. Je video wordt volledig op je apparaat verwerkt – nooit geüpload, gedeeld of opgeslagen.',
        cta: 'Doorgaan naar Virtual Try-On',
        policy: {
          before: 'Lees ons',
          link: 'Privacybeleid',
          after: 'voor meer details.'
        },
        noStorage: {
          title: 'Geen opnames opgeslagen',
          body: "We bewaren nooit foto's, video's of gezichtsgegevens."
        },
        localProcessing: {
          title: 'Verwerkt op je apparaat',
          body: 'Gezichtsherkenning draait lokaal in je browser.'
        },
        noAccount: {
          title: 'Geen account nodig',
          body: 'Pas monturen zonder registratie of login.'
        },
        youControl: {
          title: 'Jij beheert de camera',
          body: 'Stop de camera op elk moment.'
        }
      }
    },
    suggestions: {
      ariaLabel: 'Monteursuggesties',
      title: 'Probeer een andere look'
    }
  }
}
