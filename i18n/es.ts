export default {
  virtualTryOn: {
    consent: {
      title: 'Virtual Try-On',
      subtitle: 'Ve en tiempo real cómo te queda este modelo.',
      cameraUse: 'Usa la cámara frontal',
      privacy: 'Tu vídeo nunca sale de tu dispositivo',
      noStorage: 'No se guardan grabaciones',
      localProcessing:
        'El seguimiento facial se procesa localmente en el navegador',
      cta: 'Permitir acceso a la cámara',
      whyWeAsk: 'Por qué pedimos acceso a la cámara'
    },
    denied: {
      title: 'Acceso a la cámara denegado',
      body: 'Permite el acceso a la cámara en la configuración de tu navegador para usar Virtual Try-On.',
      retry: 'Intentar de nuevo'
    },
    noCamera: {
      title: 'No hay cámara disponible',
      body: 'Este dispositivo no tiene una cámara utilizable, o tu navegador bloquea el acceso.'
    },
    guide: {
      noFace: 'Coloca tu rostro dentro del contorno',
      tooFar: 'Acércate',
      tooClose: 'Aléjate un poco'
    },
    noFace: 'No se detecta ningún rostro — apunta la cámara a tu cara',
    tryOnProduct: 'Probar {product} virtualmente',
    trackingConfidence: 'Detectando rostro...',
    faceDetected: 'Rostro detectado',
    stopCamera: 'Detener cámara',
    startCamera: 'Iniciar cámara',
    retryCamera: 'Reintentar cámara',
    trackMyFace: 'Seguir mi rostro (MediaPipe)',
    frame: 'Modelo',
    exposure: 'Exposición',
    frameScale: 'Escala del modelo',
    frameYaw: 'Rotación del modelo',
    templeWidth: 'Ancho de las patillas',
    prototypeBadge: 'Prototipo',
    modal: {
      title: 'Prueba virtual',
      close: 'Cerrar',
      privacy: {
        title: 'Tu privacidad importa',
        body: 'La prueba virtual usa tu cámara. Tu vídeo se procesa completamente en tu dispositivo. Nunca se sube, comparte ni almacena.',
        cta: 'Continuar con la prueba virtual',
        policy: {
          before: 'Lee nuestra',
          link: 'Política de privacidad',
          after: 'para más detalles.'
        },
        noStorage: {
          title: 'No se guardan grabaciones',
          body: 'Nunca guardamos fotos, vídeos o datos faciales.'
        },
        localProcessing: {
          title: 'Procesado en tu dispositivo',
          body: 'El seguimiento facial funciona localmente en tu navegador.'
        },
        noAccount: {
          title: 'No necesitas cuenta',
          body: 'Prueba modelos sin registrarte ni iniciar sesión.'
        },
        youControl: {
          title: 'Tú controlas la cámara',
          body: 'Puedes detener la cámara en cualquier momento.'
        }
      }
    },
    suggestions: {
      ariaLabel: 'Sugerencias de modelos',
      title: 'Prueba otro look'
    }
  }
}
