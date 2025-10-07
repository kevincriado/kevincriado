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
            host: 'smtp.zoho.com',
            port: 587,
            secure: false, 
            requireTLS: true, 
            auth: {
                user: ZOHO_USER,
                pass: ZOHO_PASS
            }
        });

        // 3. Extracción de datos y Aplicación de Filtros
        const isMinor = data.type === 'MENOR_DE_EDAD';
        const patientName = data.paciente.nombre;
        const patientEmail = data.paciente.email;
        const legalRepresentativeName = data.representante ? data.representante.nombre : data.paciente.nombre;
        const legalRepresentativeEmail = data.representante ? data.representante.email : data.paciente.email;
        
        // --- FUNCIÓN CRÍTICA: CAMBIAR FIRMA DE BLANCO A NEGRO ---
        const changeSignatureColor = (dataURL) => {
            if (!dataURL) return null;
            // Reemplaza el color del lápiz de la firma (el color blanco de los píxeles dibujados) por negro.
            // Esto asegura que la firma sea visible sobre fondos blancos en los documentos finales (HC/Consentimientos).
            return dataURL.replace('rgb(255, 255, 255)', 'rgb(0, 0, 0)');
        };
        // --------------------------------------------------------

        const legalSignatureBase64 = changeSignatureColor(data.representante ? data.representante.firma : data.paciente.firma);
        const minorAssentSignatureBase64 = data.representante ? changeSignatureColor(data.paciente.firma) : null;
        
        // --- 4. CONFIGURACIÓN DEL CORREO PARA TI (COPIA DE SEGURIDAD CON ADJUNTOS) ---
        
        const subjectToKevin = `[FIRMA VÁLIDA] Documentos Clínicos Firmados por ${legalRepresentativeName}`;
        const bodyToKevin = `
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
            ${isMinor ? `
                <h3>Asentimiento del Paciente Menor</h3>
                <ul>
                    <li><strong>Nombre del Menor:</strong> ${data.paciente.nombre}</li>
                    <li><strong>Documento del Menor:</strong> ${data.paciente.documento}</li>
                </ul>
            ` : ''}

            <hr style="margin: 20px 0;">
            <p><strong>IMPORTANTE:</strong> Las firmas en negro se adjuntan a este correo como archivos PNG para su inserción en los documentos finales (Historia Clínica / Consentimiento Informado).</p>
        `;

        let attachmentsToKevin = [
            // Firma Principal (Adulto o Representante Legal)
            {
                filename: `firma_principal_${legalRepresentativeName.replace(/ /g, '_')}.png`,
                content: legalSignatureBase64.split(';base64,').pop(),
                encoding: 'base64',
                cid: 'legalSignature',
            },
        ];

        if (isMinor) {
            // Adjunto: Firma del Menor (Asentimiento)
            attachmentsToKevin.push({
                filename: `firma_asentimiento_${data.paciente.nombre.replace(/ /g, '_')}.png`,
                content: minorAssentSignatureBase64.split(';base64,').pop(),
                encoding: 'base64',
                cid: 'minorAssentSignature',
            });
        }
        
        // Envío 1: Correo a Kevin con los adjuntos
        let mailOptionsKevin = {
            from: `Kevin Criado Psicología <${ZOHO_USER}>`, 
            to: 'psicologia@kevincriado.com', // ¡CORRECCIÓN APLICADA AQUÍ!
            subject: subjectToKevin,
            html: bodyToKevin,
            replyTo: legalRepresentativeEmail,
            attachments: attachmentsToKevin
        };

        let info = await transporter.sendMail(mailOptionsKevin);
        console.log("Mensaje de custodia enviado a Kevin: %s", info.messageId);


        // --- 5. CONFIGURACIÓN DEL CORREO PARA EL PACIENTE (CONFIRMACIÓN SIN ADJUNTOS) ---
        
        const confirmationSubject = `Confirmación de Documentos Firmados - Kevin Criado Psicología`;
        const confirmationBody = `
            <h2>¡Proceso de Firma Digital Completado Exitosamente!</h2>
            <p>Estimado(a) ${legalRepresentativeName},</p>
            <p>Confirmamos que su proceso de firma digital para los documentos clínicos ha finalizado con éxito. Sus datos y firmas han sido guardados de forma segura, cumpliendo con las regulaciones vigentes en Colombia.</p>
            
            <hr style="border: 1px solid #ccc; margin: 20px 0;">
            
            <h3>Nuestro Compromiso Legal y Ético:</h3>
            <p>Mediante esta firma, usted valida el <strong>Consentimiento Informado</strong>, la <strong>Autorización de Tratamiento de Datos Personales (Ley 1581)</strong> y la apertura de su <strong>Historia Clínica (Res. 3100)</strong>.</p>
            <p>Garantizamos la custodia de esta evidencia digital conforme a la <strong>Ley 527 de 1999</strong> y la conservación de su Historia Clínica por 15 años (Res. 1995 de 1999).</p>
            
            <hr style="border: 1px solid #ccc; margin: 20px 0;">

            <p>Pronto recibirá la copia final de sus documentos por separado.</p>
            
            <div style="margin-top: 30px; padding-top: 15px; border-top: 1px solid #eee;">
                <p style="font-weight: bold; margin: 0;">Atentamente,</p>
                <p style="font-size: 1.1em; margin: 0;">Kevin Criado Pérez</p>
                <p style="font-size: 0.9em; color: #555; margin: 0;">Psicólogo T.P. No. 255542</p>
                <p style="font-size: 0.9em; margin: 0;"><a href="https://www.kevincriado.com" style="color: #00AEEF;">www.kevincriado.com</a></p>
            </div>
        `;
        
        const confirmationMail = {
            from: `Kevin Criado Psicología <${ZOHO_USER}>`,
            to: legalRepresentativeEmail, // Dirección del paciente/representante
            subject: confirmationSubject,
            html: confirmationBody,
        };

        await transporter.sendMail(confirmationMail);
        console.log("Confirmación enviada al cliente: %s", legalRepresentativeEmail);


        // 6. Respuesta de éxito a la aplicación web
        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: "Documentos firmados y enviados por correo exitosamente.", messageId: info.messageId }),
        };

    } catch (error) {
        console.error("Error al procesar la solicitud:", error);
        
        let errorMessage = "Error interno del servidor al enviar el correo.";
        if (error.message && (error.message.includes('Auth') || error.message.includes('535'))) {
             errorMessage = "Fallo de autenticación: Verifique ZOHO_PASS (Contraseña de Aplicación) en Netlify.";
        } else if (error.message && error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
             errorMessage = "Fallo de conexión: El servidor SMTP de Zoho no respondió. Verifique el estado de la conexión.";
        }
        
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, message: errorMessage, error: error.message }),
        };
    }
};
