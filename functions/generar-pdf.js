// Función de prueba ultra-simple en JavaScript
exports.handler = async (event) => {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "¡ÉXITO DEFINITIVO! La función se está desplegando y ejecutando correctamente.",
    }),
  };
};

