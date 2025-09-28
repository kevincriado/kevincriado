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
        const ZOHO_USER = process.env.ZOHO_USER; // psicologia@kevincriado.com
        const ZOHO_PASS = process.env.ZOHO_PASS; // Contraseña de Aplicación de Zoho

        if (!ZOHO_USER || !ZOHO_PASS) {
            console.error("Faltan variables de entorno ZOHO_USER o ZOHO_PASS.");
            return {
                statusCode: 500,
                body: JSON.stringify({ success: false, message: "Error de configuración: Faltan credenciales del servidor de correo." }),
            };
        }

        // 2. Configurar el Transportador de Nodemailer (Zoho Mail) - Usando 587/TLS
        let transporter = nodemailer.createTransport({
            host: 'smtp.zoho.com', // Servidor SMTP de Zoho
            port: 587, // Puerto estándar para TLS/STARTTLS
            secure: false, // TLS se maneja con STARTTLS en el puerto 587 (secure: false)
            requireTLS: true, // Forzar el uso de TLS
            auth: {
                user: ZOHO_USER,
                pass: ZOHO_PASS
            }
        });

        // 3. Extracción de datos del Payload
        const isMinor = data.type === 'MENOR_DE_EDAD';
        const patientName = data.paciente.nombre;
        const patientEmail = data.paciente.email;
        const legalRepresentativeName = data.representante ? data.representante.nombre : data.paciente.nombre;
        const legalRepresentativeEmail = data.representante ? data.representante.email : data.paciente.email;

        // --- Extracción y Limpieza de Firmas para Adjuntos ---
        const legalSignatureBase64 = data.representante ? data.representante.firma : data.paciente.firma;
        const minorAssentSignatureBase64 = data.representante ? data.paciente.firma : null;
        
        // Asunto y Mensaje
        const subject = `[FIRMA VÁLIDA] Documentos Clínicos Firmados por ${legalRepresentativeName}`;
        
        let htmlBody = `
            <h2>¡Documentación Clínica Firmada y Custodiada!</h2>
            <p><strong>Fecha de Transacción:</strong> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</p>
            <p>El sistema ha recibido y validado la firma digital de los siguientes documentos: Consentimiento Informado, Autorización de Tratamiento de Datos Personales y apertura de Historia Clínica.</p>
            
            <h3>Datos del Firmante Principal (${isMinor ? 'Representante Legal' : 'Paciente Adulto'})</h3>
            <ul>
                <li><strong>Nombre Completo:</strong> ${legalRepresentativeName}</li>
                <li><strong>Documento:</strong> ${data.representante ? data.representante.documento : data.paciente.documento}</li>
                <li><strong>Correo:</strong> ${legalRepresentativeEmail}</li>
                <li><strong>Teléfono:</strong> ${data.representante ? data.representante.telefono : data.paciente.telefono}</li>
            </ul>
        `;

        let attachments = [
            // Firma Principal (Adulto o Representante Legal)
            {
                filename: `firma_principal_${legalRepresentativeName.replace(/ /g, '_')}.png`,
                content: legalSignatureBase64.split(';base64,').pop(),
                encoding: 'base64',
                cid: 'legalSignature',
            },
        ];

        if (isMinor) {
            htmlBody += `
                <h3>Asentimiento del Menor de Edad</h3>
                <ul>
                    <li><strong>Nombre del Menor:</strong> ${data.paciente.nombre}</li>
                    <li><strong>Documento del Menor:</strong> ${data.paciente.documento}</li>
                </ul>
            `;
            // Adjunto: Firma del Menor (Asentimiento)
            attachments.push({
                filename: `firma_asentimiento_${data.paciente.nombre.replace(/ /g, '_')}.png`,
                content: minorAssentSignatureBase64.split(';base64,').pop(),
                encoding: 'base64',
                cid: 'minorAssentSignature',
            });
        }


        // 4. Definir Opciones del Correo (Para Kevin)
        let mailOptions = {
            from: `Kevin Criado Psicología <${ZOHO_USER}>`, 
            to: 'kevincriadop@gmail.com', // Destino fijo de Kevin
            subject: subject,
            html: htmlBody,
            replyTo: legalRepresentativeEmail,
            attachments: attachments
        };

        // 5. Envío del correo a Kevin
        let info = await transporter.sendMail(mailOptions);
        console.log("Mensaje enviado a Kevin: %s", info.messageId);

        // 6. Envío de confirmación al Cliente (Copia al paciente/representante)
        const recipientEmailForCopy = legalRepresentativeEmail;
        
        if (recipientEmailForCopy) {
            const confirmationMail = {
                from: `Kevin Criado Psicología <${ZOHO_USER}>`,
                to: recipientEmailForCopy, 
                subject: "Copia de Seguridad: Confirmación de Documentos Firmados",
                html: `
                    <h2>¡Proceso de Firma Digital Completado Exitosamente!</h2>
                    <p>Estimado(a) ${legalRepresentativeName},</p>
                    <p>Confirmamos que tus documentos de consentimiento y autorización han sido firmados digitalmente. <strong>Esta es tu copia de seguridad.</strong></p>
                    <p>Si tienes alguna pregunta, no dudes en contactarme.</p>
                    <br>
                    <p>Atentamente,</p>
                    <p>Kevin Criado Pérez - Psicólogo</p>
                `
            };
            await transporter.sendMail(confirmationMail);
            console.log("Confirmación enviada a: %s", recipientEmailForCopy);
        }

        // 7. Respuesta de éxito a la aplicación web
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: "Documentos firmados y enviados por correo exitosamente.", messageId: info.messageId }),
        };

    } catch (error) {
        console.error("Error al procesar la solicitud:", error);
        
        let errorMessage = "Error interno del servidor al enviar el correo.";
        if (error.message && (error.message.includes('Auth') || error.message.includes('535'))) {
             errorMessage = "Fallo de autenticación: Verifique ZOHO_PASS (Contraseña de Aplicación) en Netlify.";
        } else if (error.message && error.message.includes('ECONNREFUSED')) {
             errorMessage = "Fallo de conexión: El servidor SMTP de Zoho rechazó la conexión. Intente con el puerto 465 (SSL) si el 587 no funciona.";
        }
        
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: errorMessage, error: error.message }),
        };
    }
};
