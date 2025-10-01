// --- Main Handler Function for Testing ---
exports.handler = async (event) => {
  try {
    // This function ignores the form data and just returns a success message.
    // This tests if the connection between the frontend and the function is working.
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "¡La prueba funcionó! La comunicación con Netlify es correcta.",
      }),
    };

  } catch (error) {
    // If even this simple function fails, it will return an error.
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "La función de prueba falló.",
        error: error.message,
      }),
    };
  }
};
