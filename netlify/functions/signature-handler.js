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

        // **PASO DE DIAGNÓSTICO:** Verificar la conexión SMTP (Si falla aquí, el error es de ZOHO_PASS)
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
        
        // --- Comienza la construcción del correo ---
        
        // 4. Construcción del cuerpo del correo y los adjuntos
        // Reconstrucción del nombre del documento para el adjunto
        // Se usa `legalRepresentativeName` como respaldo si `patientName` no está disponible
        const docName = (patientName || legalRepresentativeName).replace(/ /g, '_');
        const documentFileName = `${documentType.replace(/ /g, '_')}_${docName}_${currentDate.replace(/\//g, '-')}.pdf`;

        const mailOptions = {
            from: `Kevin Criado Psicología <${ZOHO_USER}>`,
            to: ZOHO_USER, // El correo de Kevin
            subject: `[FIRMA DIGITAL] Nuevo Documento: ${documentType} - ${patientName || legalRepresentativeName}`,
            html: `
                <h2>Documento Firmado Digitalmente</h2>
                <p><strong>Tipo de Documento:</strong> ${documentType}</p>
                <p><strong>Fecha y Hora de Firma:</strong> ${currentDate} - ${currentTime}</p>
                
                <h3>Datos del Consultante</h3>
                <ul>
                    <li><strong>Nombre:</strong> ${patientName || 'N/A'}</li>
                    <li><strong>Correo:</strong> ${patientEmail || 'N/A'}</li>
                    <li><strong>Documento:</strong> ${patientDocumentType || 'N/A'} ${patientDocumentNumber || 'N/A'}</li>
                    <li><strong>Teléfono:</strong> ${patientPhone || 'N/A'}</li>
                </ul>
                
                ${isMinor ? `
                    <h3>Datos del Representante Legal y Menor</h3>
                    <ul>
                        <li><strong>Representante Legal:</strong> ${legalRepresentativeName || 'N/A'}</li>
                        <li><strong>Documento R.L.:</strong> ${legalRepresentativeDocumentType || 'N/A'} ${legalRepresentativeDocumentNumber || 'N/A'}</li>
                        <li><strong>Teléfono R.L.:</strong> ${legalRepresentativePhone || 'N/A'}</li>
                        <li><strong>Menor de Edad:</strong> ${minorName || 'N/A'}</li>
                        <li><strong>Documento Menor:</strong> ${minorDocumentType || 'N/A'} ${minorDocumentNumber || 'N/A'}</li>
                    </ul>
                ` : ''}

                <h3>Firmas</h3>
                <p>Las firmas adjuntas en el PDF están verificadas por el sistema.</p>
                
                <hr>
                <p><strong>Nota:</strong> El PDF adjunto contiene el documento firmado con validez legal.</p>
            `,
            attachments: [
                // Adjunto principal: El documento PDF serializado
                {
                    filename: documentFileName,
                    content: pdfBase64.split(';base64,').pop(), 
                    encoding: 'base64',
                    contentType: 'application/pdf',
                },
                // Firmas adjuntas como imágenes (para el cuerpo del correo o referencia)
                // Usamos CID para incrustar la imagen en el correo si el front-end lo hiciera, pero aquí solo la adjuntamos para referencia.
                {
                    filename: 'firma_paciente.png',
                    content: (patientSignature || '').split(';base64,').pop(),
                    encoding: 'base64',
                    cid: 'patientSignature',
                },
                ...(isMinor && legalRepresentativeSignature ? [{
                    filename: 'firma_acudiente.png',
                    content: legalRepresentativeSignature.split(';base64,').pop(),
                    encoding: 'base64',
                    cid: 'legalRepresentativeSignature',
                }] : []),
                // Si el paciente es menor, la "patientSignature" es el asentimiento del menor
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

        // 6. Envío de confirmación al Cliente (Copia al paciente/representante)
        const recipientEmail = patientEmail || legalRepresentativePhone; // Usar el email del paciente o acudiente
        const recipientName = patientName || legalRepresentativeName;
        
        if (recipientEmail) {
            const confirmationMail = {
                from: `Kevin Criado Psicología <${ZOHO_USER}>`,
                to: recipientEmail, // Dirección del paciente/acudiente
                subject: "Confirmación de Documentos Firmados Digitalmente",
                html: `
                    <h2>¡Proceso de Firma Digital Completado Exitosamente!</h2>
                    <p>Estimado(a) ${recipientName || 'Consultante'},</p>
                    <p>Confirmamos que tus documentos de consentimiento y autorización han sido firmados digitalmente con éxito y se han guardado de forma segura.</p>
                    <p>Pronto recibirás una copia final de todos los documentos.</p>
                    <br>
                    <p>Atentamente,</p>
                    <p>Kevin Criado Pérez - Psicólogo</p>
                `
            };
            await transporter.sendMail(confirmationMail);
            console.log("Confirmación enviada a: %s", recipientEmail);
        }


        // 7. Respuesta de éxito a la aplicación web
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: "Documentos firmados y enviados por correo exitosamente.", messageId: info.messageId }),
        };

    } catch (error) {
        console.error("Error al procesar la solicitud:", error);
        
        // Si el error es de autenticación, lo hacemos más explícito en la respuesta (si Netlify lo permite)
        let errorMessage = "Error interno del servidor al enviar el correo.";
        if (error.message && error.message.includes('auth')) {
             errorMessage = "Fallo de autenticación de correo. Revise ZOHO_USER y ZOHO_PASS (Contraseña de Aplicación) en Netlify.";
        }
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: errorMessage, error: error.message }),
        };
    }
};
