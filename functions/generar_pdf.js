const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  try {
    // 1. --- Validate Environment Variable ---
    const webhookUrl = process.env.ZAPIER_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error("Error de configuración: La variable de entorno 'ZAPIER_WEBHOOK_URL' no fue encontrada.");
    }

    // 2. --- Get Form Data ---
    if (!event.body) {
      throw new Error("No se recibieron datos en la solicitud.");
    }
    const data = JSON.parse(event.body);
    
    // --- *** THE FIX IS HERE *** ---
    // 3. --- Prepare Data for the Template ---
    // We must create the specific fields the template expects for consent.
    data['GRABACION_SI'] = data.autoriza_grabacion === 'SI' ? 'X' : ' ';
    data['GRABACION_NO'] = data.autoriza_grabacion === 'NO' ? 'X' : ' ';
    data['TRANSCRIPCION_SI'] = data.autoriza_transcripcion === 'SI' ? 'X' : ' ';
    data['TRANSCRIPCION_NO'] = data.autoriza_transcripcion === 'NO' ? 'X' : ' ';

    // 4. --- Send Prepared Data to Zapier ---
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Zapier respondió con un error: ${response.status} ${errorText}`);
    }

    // 5. --- Return a Success Message to the User ---
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: '¡Proceso iniciado con éxito! La historia clínica será enviada a tu correo en unos momentos.'
      })
    };

  } catch (error) {
    console.error("--- FUNCTION FAILED ---:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error interno del servidor.",
        error: error.message || "Ocurrió un error desconocido."
      })
    };
  }
};


