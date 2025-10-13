// netlify/functions/signature-handler.js
// Maneja las firmas digitales: envía correos y guarda las imágenes localmente.

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// --- CONFIGURACIÓN LOCAL ---
const LOCAL_SAVE_PATH = "/Users/kevincriadoperez/Desktop/VIDEO_CONSULTA_PSICOLOGIA/GENERADORHC/PACIENTES"; 
// Ajusta esta ruta a donde resides tus carpetas PACIENTES en tu Mac.

exports.handler = async (event, context) => {
    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            body: JSON.stringify({ message: "Método no permitido. Solo se acepta POST." }),
        };
    }

    try {
        const data = JSON.parse(event.body);
        const ZOHO_USER = process.env.ZOHO_USER;
        const ZOHO_PASS = process.env.ZOHO_PASS;

        if (!ZOHO_USER || !ZOHO_PASS) {
            return {
                statusCode: 500,
                body: JSON.stringify({ success: false, message: "Error: faltan credenciales de Zoho." }),
            };
        }

        // --- Configuración de correo Zoho ---
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

        const isMinor = data.type === 'MENOR_DE_EDAD';
        const paciente = data.paciente;
        const representante = data.representante || null;

        const patientName = paciente.nombre;
        const patientId = paciente.documento;
        const repName = representante ? representante.nombre : paciente.nombre;
        const repEmail = representante ? representante.email : paciente.email;

        // --- FUNCIÓN: Cambiar color de firma a negro ---
        const changeSignatureColor = (dataURL) => {
            if (!dataURL) return null;
            return dataURL.replace('rgb(255, 255, 255)', 'rgb(0, 0, 0)');
        };

        const legalSignatureBase64 = changeSignatureColor(representante ? representante.firma : paciente.firma);
        const minorSignatureBase64 = representante ? changeSignatureColor(paciente.firma) : null;

        // --- RUTAS LOCALES PARA GUARDAR LAS FIRMAS ---
        const carpetaPaciente = path.join(
            LOCAL_SAVE_PATH,
            `${patientName.replace(/ /g, "_")}_${patientId}`
        );
        const carpetaFirmas = path.join(carpetaPaciente, "firmas");

        if (!fs.existsSync(carpetaPaciente)) fs.mkdirSync(carpetaPaciente, { recursive: true });
        if (!fs.existsSync(carpetaFirmas)) fs.mkdirSync(carpetaFirmas, { recursive: true });

        // --- Guardar firmas como archivos PNG locales ---
        if (legalSignatureBase64) {
            const firmaPrincipalPath = path.join(
                carpetaFirmas,
                `firma_paciente_${patientId}.png`
            );
            const base64Data = legalSignatureBase64.split(';base64,').pop();
            fs.writeFileSync(firmaPrincipalPath, Buffer.from(base64Data, 'base64'));
            console.log("Firma del paciente guardada:", firmaPrincipalPath);
        }

        if (minorSignatureBase64) {
            const firmaMenorPath = path.join(
                carpetaFirmas,
                `firma_menor_${patientId}.png`
            );
            const base64Data = minorSignatureBase64.split(';base64,').pop();
            fs.writeFileSync(firmaMenorPath, Buffer.from(base64Data, 'base64'));
            console.log("Firma del menor guardada:", firmaMenorPath);
        }

        // --- ENVÍO DE CORREOS ---
        const subjectToKevin = `[FIRMA VÁLIDA] Documentos Clínicos Firmados por ${repName}`;
        const bodyToKevin = `
            <h2>Documentación Clínica Firmada</h2>
            <p><strong>Fecha:</strong> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</p>
            <p>Se recibieron las firmas digitales para el paciente <strong>${patientName}</strong>.</p>
            <p>Las imágenes se guardaron en el sistema local en la carpeta del paciente.</p>
        `;

        let attachmentsToKevin = [{
            filename: `firma_principal_${repName.replace(/ /g, '_')}.png`,
            content: legalSignatureBase64.split(';base64,').pop(),
            encoding: 'base64'
        }];

        if (isMinor && minorSignatureBase64) {
            attachmentsToKevin.push({
                filename: `firma_menor_${patientName.replace(/ /g, '_')}.png`,
                content: minorSignatureBase64.split(';base64,').pop(),
                encoding: 'base64'
            });
        }

        await transporter.sendMail({
            from: `Kevin Criado Psicología <${ZOHO_USER}>`,
            to: 'psicologia@kevincriado.com',
            subject: subjectToKevin,
            html: bodyToKevin,
            attachments: attachmentsToKevin
        });

        await transporter.sendMail({
            from: `Kevin Criado Psicología <${ZOHO_USER}>`,
            to: repEmail,
            subject: "Confirmación de Documentos Firmados - Kevin Criado Psicología",
            html: `
                <h2>Proceso de firma completado</h2>
                <p>Estimado(a) ${repName},</p>
                <p>Se ha recibido correctamente su firma digital y la del paciente ${patientName}.</p>
                <p>Los documentos serán completados tras la sesión clínica.</p>
            `
        });

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                success: true,
                message: "Firmas recibidas, guardadas localmente y correos enviados."
            }),
        };

    } catch (error) {
        console.error("Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                success: false,
                message: "Error interno del servidor.",
                error: error.message 
            }),
        };
    }
};

