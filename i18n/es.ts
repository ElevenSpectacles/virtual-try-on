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
      whyWeAsk: 'Por qué pedimos acceso a la cámara',
      uploadFallback: 'O sube una foto'
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
    upload: {
      title: 'Subir una foto',
      body: 'Elige una foto frontal bien iluminada y colocaremos el modelo encima. Tu foto nunca sale de tu dispositivo.',
      cta: 'Elegir foto',
      acceptedFormats: 'JPG, PNG, WEBP',
      changePhoto: 'Cambiar foto',
      useCamera: 'Usar la cámara'
    },
    guide: {
      noFace: 'Coloca tu rostro dentro del contorno',
      tooFar: 'Acércate',
      tooClose: 'Aléjate un poco'
    },
    noFace: 'No se detecta ningún rostro — apunta la cámara a tu cara',
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
    suggestions: {
      ariaLabel: 'Sugerencias de modelos',
      title: 'Prueba otro look'
    }
  }
}
