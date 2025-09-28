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
                pass: ZOHO_PASS
            }
        });

        // **PASO DE DIAGNÓSTICO AÑADIDO:** Verificar la conexión SMTP
        await transporter.verify();
        console.log("Conexión SMTP con Zoho establecida exitosamente.");

        // 3. Extracción de datos
        const {
            patientName, patientEmail, patientDocumentType, patientDocumentNumber, patientPhone,
            patientSignature, legalRepresentativeName, legalRepresentativeDocumentType, 
            legalRepresentativeDocumentNumber, legalRepresentativePhone, legalRepresentativeSignature,
            isMinor, minorName, minorDocumentType, minorDocumentNumber, minorAssentSignature,
            documentType, pdfBase64,
            currentDate, currentTime
        } = data;
        
        // ... (el resto de tu lógica de extracción de datos y construcción del correo)
        
        // 4. Construcción del cuerpo del correo y los adjuntos
        // Reconstrucción del nombre del documento para el adjunto
        const documentFileName = `${documentType.replace(/ /g, '_')}_${patientName.replace(/ /g, '_')}_${currentDate.replace(/\//g, '-')}.pdf`;

        const mailOptions = {
            from: `Kevin Criado Psicología <${ZOHO_USER}>`,
            to: ZOHO_USER, // El correo de Kevin
            subject: `[FIRMA DIGITAL] Nuevo Documento: ${documentType} - ${patientName}`,
            html: `
                <h2>Documento Firmado Digitalmente</h2>
                <p><strong>Tipo de Documento:</strong> ${documentType}</p>
                <p><strong>Fecha y Hora de Firma:</strong> ${currentDate} - ${currentTime}</p>
                
                <h3>Datos del Consultante</h3>
                <ul>
                    <li><strong>Nombre:</strong> ${patientName}</li>
                    <li><strong>Correo:</strong> ${patientEmail}</li>
                    <li><strong>Documento:</strong> ${patientDocumentType} ${patientDocumentNumber}</li>
                    <li><strong>Teléfono:</strong> ${patientPhone}</li>
                </ul>
                
                ${isMinor ? `
                    <h3>Datos del Representante Legal y Menor</h3>
                    <ul>
                        <li><strong>Representante Legal:</strong> ${legalRepresentativeName}</li>
                        <li><strong>Documento R.L.:</strong> ${legalRepresentativeDocumentType} ${legalRepresentativeDocumentNumber}</li>
                        <li><strong>Teléfono R.L.:</strong> ${legalRepresentativePhone}</li>
                        <li><strong>Menor de Edad:</strong> ${minorName}</li>
                        <li><strong>Documento Menor:</strong> ${minorDocumentType} ${minorDocumentNumber}</li>
                    </ul>
                ` : ''}

                <h3>Firmas</h3>
                <p>Las firmas adjuntas en el PDF están verificadas por el sistema.</p>
                
                <hr>
                <p><strong>Nota:</strong> El PDF adjunto contiene el documento firmado con validez legal.</p>
            `,
            attachments: [
                {
                    filename: documentFileName,
                    content: pdfBase64.split(';base64,').pop(), // Limpia el prefijo del Base64
                    encoding: 'base64',
                    contentType: 'application/pdf',
                },
                // Firmas adjuntas como imágenes (Opcional, si deseas verlas en el cuerpo del correo)
                {
                    filename: 'firma_paciente.png',
                    content: patientSignature.split(';base64,').pop(),
                    encoding: 'base64',
                    cid: 'patientSignature',
                },
                ...(isMinor && legalRepresentativeSignature ? [{
                    filename: 'firma_acudiente.png',
                    content: legalRepresentativeSignature.split(';base64,').pop(),
                    encoding: 'base64',
                    cid: 'legalRepresentativeSignature',
                }] : []),
                ...(isMinor && minorAssentSignature ? [{
                    filename: 'firma_asentimiento_menor.png',
                    content: minorAssentSignature.split(';base64,').pop(),
                    encoding: 'base64',
                    cid: 'minorAssentSignature',
                }] : []),
            ]
        };

        // 5. Envío del correo a Kevin
        let info = await transporter.sendMail(mailOptions);
        console.log("Mensaje enviado a Kevin: %s", info.messageId);

        // 6. Envío de confirmación al Cliente (Opcional, pero recomendado)
        const patientEmail = data.patientEmail || data.legalRepresentativeEmail; // Usar el email del paciente o acudiente
        const patientNameForEmail = data.patientName || data.legalRepresentativeName;
        
        if (patientEmail) {
            const confirmationMail = {
                from: `Kevin Criado Psicología <${ZOHO_USER}>`,
                to: patientEmail, // Dirección del paciente/acudiente
                subject: "Confirmación de Documentos Firmados Digitalmente",
                html: `
                    <h2>¡Proceso de Firma Digital Completado Exitosamente!</h2>
                    <p>Estimado(a) ${patientNameForEmail},</p>
                    <p>Confirmamos que tus documentos de consentimiento y autorización han sido firmados digitalmente con éxito y se han guardado de forma segura.</p>
                    <p>Pronto recibirás una copia final de todos los documentos.</p>
                    <br>
                    <p>Atentamente,</p>
                    <p>Kevin Criado Pérez - Psicólogo</p>
                `
            };
            await transporter.sendMail(confirmationMail);
            console.log("Confirmación enviada a: %s", patientEmail);
        }


        // 7. Respuesta de éxito a la aplicación web
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Documentos firmados y enviados por correo exitosamente.", messageId: info.messageId }),
        };

    } catch (error) {
        console.error("Error al procesar la solicitud:", error);
        // Si el error es de autenticación, lo hacemos más explícito en la respuesta.
        let errorMessage = "Error interno del servidor al enviar el correo.";
        if (error.message && error.message.includes('auth')) {
             errorMessage = "Fallo de autenticación de correo. Revise ZOHO_USER y ZOHO_PASS (Contraseña de Aplicación).";
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ message: errorMessage, error: error.message }),
        };
    }
};
