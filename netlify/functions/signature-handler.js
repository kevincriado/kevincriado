// netlify/functions/signature-handler.js
// Esta función gestiona el envío de firmas digitales y el correo electrónico.
const nodemailer = require('nodemailer');

// Define el manejador principal de la función
exports.handler = async (event, context) => {
    // Solo permitimos peticiones POST
    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: "Método no permitido. Solo se acepta POST." }),
        };
    }

    try {
        // Parsear el cuerpo JSON de la petición entrante
        const data = JSON.parse(event.body);

        // 1. Obtener Variables de Entorno (Credenciales de Zoho)
        // **IMPORTANTE**: Estas variables deben configurarse en el panel de Netlify por seguridad.
        const ZOHO_USER = process.env.ZOHO_USER;
        const ZOHO_PASS = process.env.ZOHO_PASS;

        if (!ZOHO_USER || !ZOHO_PASS) {
            console.error("Faltan variables de entorno ZOHO_USER o ZOHO_PASS.");
            return {
                statusCode: 500,
                body: JSON.stringify({ message: "Error de configuración: Faltan credenciales del servidor de correo." }),
            };
        }

        // 2. Configurar el Transportador de Nodemailer (Zoho Mail)
        let transporter = nodemailer.createTransport({
            host: 'smtp.zoho.com', // Servidor SMTP de Zoho
            port: 465, // Puerto seguro
            secure: true, // Usar SSL/TLS
            auth: {
                user: ZOHO_USER,
                pass: ZOHO_PASS,
            },
        });

        // 3. Crear el Contenido del Correo
        const {
            patientSignatureImage,
            legalSignatureImage,
            minorSignatureImage,
            htmlContent, // Contenido HTML (Documento PDF serializado)
            patientName,
            patientEmail
        } = data;

        // Se usa `patientName` para el asunto del correo
        const subject = `Documentos Firmados - ${patientName}`;
        
        // El cuerpo del correo contendrá el HTML (el PDF serializado)
        // y una lista de las firmas adjuntas para referencia.
        let emailBody = `
            <h2>¡Documentación Clínica Firmada!</h2>
            <p>Se ha completado el proceso de firma digital para el paciente: <strong>${patientName}</strong> (${patientEmail}).</p>
            <p>A continuación, se incluye el documento PDF serializado para su procesamiento posterior (como la conversión a PDF real en un sistema back-end).</p>
            
            <hr style="border: 1px solid #eee; margin: 20px 0;">
            <h3>Contenido del Documento Serializado (HTML del PDF):</h3>
            <div style="background-color: #f7f7f7; padding: 15px; border-radius: 8px; border: 1px solid #ddd; overflow-x: auto;">
                ${htmlContent}
            </div>

            <hr style="border: 1px solid #eee; margin: 20px 0;">
            <h3>Firmas (Imágenes Base64):</h3>
            <p><strong>Firma del Consultante/Acudiente:</strong></p>
            <img src="${patientSignatureImage}" alt="Firma del Consultante" style="max-width: 100%; border: 1px solid #ccc; border-radius: 4px;"/>
            <p><strong>Firma del Menor (Asentimiento, si aplica):</strong></p>
            <img src="${minorSignatureImage}" alt="Firma del Menor" style="max-width: 100%; border: 1px solid #ccc; border-radius: 4px;"/>
            <p><strong>Firma del Psicólogo (Legal):</strong></p>
            <img src="${legalSignatureImage}" alt="Firma del Psicólogo" style="max-width: 100%; border: 1px solid #ccc; border-radius: 4px;"/>
        `;

        // 4. Definir Opciones del Correo
        let mailOptions = {
            from: `Kevin Criado Psicología <${ZOHO_USER}>`, // El remitente de tu Zoho Mail
            to: ZOHO_USER, // Envío el correo a tu misma dirección de Zoho
            subject: subject,
            html: emailBody,
            replyTo: patientEmail, // Permite responder directamente al consultante
        };
        
        // 5. Enviar el Correo
        const info = await transporter.sendMail(mailOptions);
        console.log("Mensaje enviado: %s", info.messageId);

        // 6. Enviar Correo de Confirmación al Cliente (Opcional, pero recomendado)
        // Esto confirma al paciente que la firma fue exitosa.
        const confirmationMail = {
            from: `Kevin Criado Psicología <${ZOHO_USER}>`,
            to: patientEmail, // Dirección del paciente
            subject: "Confirmación de Documentos Firmados Digitalmente",
            html: `
                <h2>¡Proceso de Firma Digital Completado Exitosamente!</h2>
                <p>Estimado(a) ${patientName},</p>
                <p>Confirmamos que tus documentos de consentimiento y autorización han sido firmados digitalmente con éxito y se han guardado de forma segura.</p>
                <p>Pronto recibirás una copia final de todos los documentos.</p>
                <br>
                <p>Atentamente,</p>
                <p>Kevin Criado Pérez - Psicólogo</p>
            `
        };
        await transporter.sendMail(confirmationMail);
        console.log("Confirmación enviada a: %s", patientEmail);


        // 7. Respuesta de éxito a la aplicación web
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Documentos firmados y enviados por correo exitosamente.", messageId: info.messageId }),
        };

    } catch (error) {
        console.error("Error al procesar la solicitud:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Error interno del servidor al enviar el correo.", error: error.message }),
        };
    }
};
