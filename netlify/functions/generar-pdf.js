// Importa todas las dependencias necesarias
const fs = require('fs');
const path = require('path');
const os = require('os');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const docxPdf = require('docx-pdf');
const { PDFDocument } = require('pdf-lib');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

// --- HELPER: AUTENTICACIÓN CON GOOGLE SHEETS ---
async function getGoogleSheetsClient() {
    const credentialsBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
    if (!credentialsBase64) {
        throw new Error("La variable de entorno GOOGLE_SERVICE_ACCOUNT_CREDENTIALS no está definida.");
    }
    const credentials = JSON.parse(Buffer.from(credentialsBase64, 'base64').toString('ascii'));
    
    const client = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    return google.sheets({ version: 'v4', auth: client });
}


// --- FUNCIÓN PRINCIPAL DE NETLIFY ---
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Método no permitido' };
    }

    try {
        const data = JSON.parse(event.body);
        console.log("Paso 0: Datos recibidos del formulario.");

        // --- 1. LÓGICA DE REGISTRO CON GOOGLE SHEETS ---
        console.log("Paso 1: Conectando con Google Sheets...");
        const sheets = await getGoogleSheetsClient();
        const sheetId = process.env.GOOGLE_SHEET_ID;
        
        // **NUEVA VALIDACIÓN**: Verifica que la variable de entorno exista.
        if (!sheetId) {
            console.error("Error Crítico: La variable de entorno GOOGLE_SHEET_ID no está configurada en Netlify.");
            throw new Error("La configuración del servidor está incompleta. Falta el ID de la hoja de cálculo (GOOGLE_SHEET_ID).");
        }

        const range = 'A:K';

        const response = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
        const rows = response.data.values || [];

        let sessionCountToday = 1;
        rows.forEach(row => {
            const rowDate = row[0];
            const rowDoc = row[2];
            if (row[0] === data.FECHA_SESION && row[2] === data.DOCUMENTO) {
                sessionCountToday++;
            }
        });
        console.log(`Paso 1 completado. Esta es la sesión N°${sessionCountToday} para este paciente hoy.`);

        // --- 2. GENERACIÓN DE CONTRASEÑA ---
        console.log("Paso 2: Generando contraseña...");
        const initials = data.NOMBRE_COMPLETO.split(' ').map(n => n[0]).join('');
        const dateForPassword = data.FECHA_SESION.replace(/\//g, '');
        const password = `${initials}${data.DOCUMENTO}${dateForPassword}`;
        console.log("Paso 2 completado.");

        // --- 3. LLENADO DE PLANTILLA DOCX ---
        console.log("Paso 3: Llenando plantilla DOCX...");
        const templatePath = path.resolve(__dirname, 'PlantillaHC.docx');
        const templateContent = fs.readFileSync(templatePath);
        const zip = new PizZip(templateContent);
        const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

        const templateData = { ...data };
        templateData.GRABACION_SI = data.autoriza_grabacion === 'SI' ? 'X' : ' ';
        templateData.GRABACION_NO = data.autoriza_grabacion === 'NO' ? 'X' : ' ';
        templateData.TRANSCRIPCION_SI = data.autoriza_transcripcion === 'SI' ? 'X' : ' ';
        templateData.TRANSCRIPCION_NO = data.autoriza_transcripcion === 'NO' ? 'X' : ' ';
        
        doc.setData(templateData);

        try {
            doc.render();
        } catch (renderError) {
            console.error("Error de Docxtemplater:", JSON.stringify(renderError));
            throw new Error(`Error al reemplazar marcadores en la plantilla: ${renderError.message}. Revisa si falta algún marcador.`);
        }
        
        const filledDocxBuffer = doc.getZip().generate({ type: 'nodebuffer' });
        console.log("Paso 3 completado.");


        // --- 4. CONVERSIÓN DE DOCX A PDF ---
        console.log("Paso 4: Convirtiendo a PDF...");
        const tempDocxPath = path.join(os.tmpdir(), `temp_${Date.now()}.docx`);
        const tempPdfPath = path.join(os.tmpdir(), `temp_${Date.now()}.pdf`);

        fs.writeFileSync(tempDocxPath, filledDocxBuffer);
        
        await new Promise((resolve, reject) => {
            docxPdf(tempDocxPath, tempPdfPath, (err) => {
                if (err) {
                    console.error("Error en la conversión de DOCX a PDF:", err);
                    return reject(new Error("Falló la librería de conversión a PDF."));
                }
                resolve();
            });
        });

        const pdfBuffer = fs.readFileSync(tempPdfPath);
        fs.unlinkSync(tempDocxPath);
        fs.unlinkSync(tempPdfPath);
        console.log("Paso 4 completado.");


        // --- 5. PROTECCIÓN DEL PDF CON CONTRASEÑA ---
        console.log("Paso 5: Protegiendo PDF...");
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        await pdfDoc.encrypt({
            userPassword: password,
            ownerPassword: password, 
            permissions: { printing: 'highResolution', modifying: false, copying: false },
        });
        const protectedPdfBytes = await pdfDoc.save();
        console.log("Paso 5 completado.");

        // --- 6. ENVÍO DE CORREOS ---
        console.log("Paso 6: Configurando y enviando correos...");
        const transporter = nodemailer.createTransport({
            host: process.env.ZOHO_SMTP_HOST,
            port: process.env.ZOHO_SMTP_PORT,
            secure: true,
            auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
        });

        const fileName = `HC_${data.DOCUMENTO}_Sesion${sessionCountToday}.pdf`;
        
        // Correo para el profesional
        await transporter.sendMail({
            from: `"Asistente HC" <${process.env.ZOHO_USER}>`,
            to: process.env.ZOHO_USER,
            subject: `Historia Clínica - ${data.NOMBRE_COMPLETO}`,
            html: `<p>Se adjunta la historia clínica del paciente <b>${data.NOMBRE_COMPLETO}</b>.</p><p>La contraseña del archivo es: <b>${password}</b></p>`,
            attachments: [{ filename: fileName, content: Buffer.from(protectedPdfBytes), contentType: 'application/pdf' }],
        });

        // Correo para el paciente
        await transporter.sendMail({
            from: `"Psic. Kevin Criado" <${process.env.ZOHO_USER}>`,
            to: data.CORREO,
            subject: 'Copia de su Historia Clínica',
            html: `<p>Estimado/a paciente, se adjunta una copia protegida de su historia clínica.</p><p>La contraseña para abrir el archivo es: <b>${password}</b></p><p>Por favor, guárdela en un lugar seguro.</p>`,
            attachments: [{ filename: fileName, content: Buffer.from(protectedPdfBytes), contentType: 'application/pdf' }],
        });
        console.log("Paso 6 completado.");


        // --- 7. ACTUALIZAR EL REGISTRO EN GOOGLE SHEETS ---
        console.log("Paso 7: Actualizando registro en Google Sheets...");
        const newRow = [
            data.FECHA_SESION, data.HORA_CONS, data.DOCUMENTO, data.NOMBRE_COMPLETO,
            data.MOTIVO, password, fileName, "Enviado por correo",
            `Sesión ${sessionCountToday}`, data.PROFESIONAL_SESION, "Completado"
        ];
        await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: 'A1',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [newRow] },
        });
        console.log("Paso 7 completado. ¡Proceso finalizado con éxito!");
        
        return { statusCode: 200, body: JSON.stringify({ message: 'PDF generado, protegido y enviado exitosamente.' }) };

    } catch (error) {
        console.error('Error detallado en la función:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Error interno del servidor.', error: error.message }) };
    }
};
