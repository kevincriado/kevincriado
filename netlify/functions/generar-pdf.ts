import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  try {
    // Esta función de prueba confirma que la nueva estructura funciona.
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "¡ÉXITO! La nueva estructura de función con TypeScript está funcionando.",
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "La función de prueba falló.",
        error: error.message,
      }),
    };
  }
};

export { handler };
