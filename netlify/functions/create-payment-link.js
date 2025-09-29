// --- Netlify Serverless Function for Wompi Payment Link Creation ---

// Esta función se ejecuta en el servidor de Netlify, no en el navegador del usuario.
// Su trabajo es recibir los datos de la cita y crear un enlace de pago seguro en Wompi.

exports.handler = async function (event, context) {
  // 1. Obtener los datos enviados desde el formulario (frontend)
  const data = JSON.parse(event.body);

  // 2. Variables de entorno (¡MUY IMPORTANTE!)
  // Debes configurar estas llaves en la configuración de tu sitio en Netlify.
  // Ve a Site settings > Build & deploy > Environment > Environment variables.
  const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY;
  // NOTA: Para crear enlaces de pago, solo necesitas la Llave Pública.
  // ¡No expongas tu llave privada aquí!

  // Validar que la llave pública esté configurada
  if (!WOMPI_PUBLIC_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: "La llave pública de Wompi no está configurada en el servidor." }),
    };
  }
  
  // 3. Crear una referencia única para la transacción.
  const reference = `kc-psicologia-${Date.now()}`;

  // 4. Estructurar los datos para la API de Wompi (Endpoint de Enlaces de Pago)
  // El monto debe estar en centavos (ej: 50000 COP = 5000000 centavos)
  const wompiData = {
    name: data.serviceName,
    description: `Agendamiento para ${data.dateTime}`,
    single_use: true, // El enlace solo se puede usar una vez
    amount_in_cents: data.price * 100,
    currency: "COP",
    // URL a la que Wompi redirigirá al usuario después del pago.
    // ¡Asegúrate de que esta URL exista! Puedes crear una página de "gracias.html".
    redirect_url: "https://TU_DOMINIO.com/gracias", 
    // Puedes recolectar el nombre del cliente en el checkout de Wompi
    collect_customer_name: true,
  };

  try {
    // 5. Realizar la llamada a la API de Wompi para crear el enlace de pago
    const response = await fetch("https://production.wompi.co/v1/payment_links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // La autorización usa tu Llave Pública
        "Authorization": `Bearer ${WOMPI_PUBLIC_KEY}`,
      },
      body: JSON.stringify(wompiData),
    });

    const responseData = await response.json();

    if (responseData.error) {
      throw new Error(JSON.stringify(responseData.error.messages));
    }

    // 6. Si todo sale bien, Wompi nos da el ID del enlace de pago.
    const paymentLinkId = responseData.data.id;
    
    // Devolvemos una respuesta exitosa al frontend con el ID del enlace.
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        success: true, 
        linkId: paymentLinkId 
      }),
    };

  } catch (error) {
    // 7. Si algo falla, devolvemos un error claro.
    console.error("Error creando el enlace de pago en Wompi:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: error.message }),
    };
  }
};