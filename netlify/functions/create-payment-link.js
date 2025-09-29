// --- Netlify Serverless Function for Wompi Payment Link Creation (Improved Error Handling) ---

exports.handler = async function (event, context) {
  // 1. Validar que la petición sea POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);

    // 2. Variables de entorno con validación robusta
    const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY;

    if (!WOMPI_PUBLIC_KEY) {
      console.error("Error: La variable de entorno WOMPI_PUBLIC_KEY no está definida.");
      return {
        statusCode: 500,
        body: JSON.stringify({ success: false, message: "Error de configuración del servidor: La llave pública no fue encontrada." }),
      };
    }
    
    // 3. Crear una referencia única para la transacción
    const reference = `kc-psicologia-${Date.now()}`;

    // 4. Estructurar los datos para la API de Wompi
    const wompiData = {
      name: data.serviceName,
      description: `Agendamiento para ${data.dateTime}`,
      single_use: true,
      amount_in_cents: data.price * 100,
      currency: "COP",
      redirect_url: "https://TU_DOMINIO.com/gracias",
      collect_customer_name: true,
    };

    // 5. Realizar la llamada a la API de Wompi
    const response = await fetch("https://production.wompi.co/v1/payment_links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${WOMPI_PUBLIC_KEY}`,
      },
      body: JSON.stringify(wompiData),
    });

    const responseData = await response.json();

    if (!response.ok || responseData.error) {
       console.error("Respuesta de error de Wompi:", responseData);
       const errorMessage = responseData.error ? JSON.stringify(responseData.error.messages) : `Error HTTP ${response.status}`;
       throw new Error(`Wompi respondió con un error: ${errorMessage}`);
    }

    // 6. Si todo sale bien, devolver el ID del enlace.
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        linkId: responseData.data.id 
      }),
    };

  } catch (error) {
    console.error("Error en la función de Netlify:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error.message }),
    };
  }
};
