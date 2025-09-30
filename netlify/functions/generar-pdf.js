// Importa todas las dependencias necesarias
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const docxToPdf = require('@nativedocuments/docx-to-pdf');
const { PDFDocument } = require('pdf-lib');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

// --- HELPER: AUTENTICACIÓN CON GOOGLE SHEETS ---
// Esta función se encarga de la conexión segura con la API de Google Sheets
async function getGoogleSheetsClient() {
    // Lee las credenciales desde las variables de entorno de Netlify
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
        
        // --- 1. LÓGICA DE REGISTRO CON GOOGLE SHEETS ---
        const sheets = await getGoogleSheetsClient();
        const sheetId = process.env.GOOGLE_SHEET_ID;
        const range = 'A:K'; // Rango que cubre todas tus columnas

        // Obtener todos los registros existentes
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
        const rows = response.data.values || [];

        // Calcular número de sesión para el paciente en la fecha actual
        let sessionCountToday = 1;
        rows.forEach(row => {
            const rowDate = row[0]; // Columna 'Fecha'
            const rowDoc = row[2]; // Columna 'Cédula'
            if (rowDate === data.fecha_sesion && rowDoc === data.documento) {
                sessionCountToday++;
            }
        });

        // --- 2. GENERACIÓN DE CONTRASEÑA ---
        const initials = data.nombre_completo.split(' ').map(n => n[0]).join('');
        const dateForPassword = data.fecha_sesion.replace(/-/g, ''); // Formato YYYYMMDD
        const password = `${initials}${data.documento}${dateForPassword}`;

        // --- 3. LLENADO DE PLANTILLA DOCX ---
        const templatePath = path.resolve(__dirname, 'PlantillaHC.docx');
        const templateContent = fs.readFileSync(templatePath);
        const zip = new PizZip(templateContent);
        const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

        // Prepara los datos para la plantilla, incluyendo los marcadores de consentimiento
        const templateData = { ...data };
        templateData.GRABACION_SI = data.autoriza_grabacion === 'SI' ? 'X' : ' ';
        templateData.GRABACION_NO = data.autoriza_grabacion === 'NO' ? 'X' : ' ';
        templateData.TRANSCRIPCION_SI = data.autoriza_transcripcion === 'SI' ? 'X' : ' ';
        templateData.TRANSCRIPCION_NO = data.autoriza_transcripcion === 'NO' ? 'X' : ' ';

        doc.setData(templateData);
        doc.render();

        const filledDocxBuffer = doc.getZip().generate({ type: 'nodebuffer' });

        // --- 4. CONVERSIÓN DE DOCX A PDF ---
        const pdfBuffer = await docxToPdf(filledDocxBuffer);

        // --- 5. PROTECCIÓN DEL PDF CON CONTRASEÑA ---
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        pdfDoc.setProducer('Kevin Criado Psicología');
        pdfDoc.setCreator('Asistente de HC');
        
        // Opciones de encriptación con la contraseña generada
        await pdfDoc.encrypt({
            userPassword: password,
            ownerPassword: password, 
            permissions: { printing: 'highResolution', modifying: false, copying: false },
        });

        const protectedPdfBytes = await pdfDoc.save();

        // --- 6. ENVÍO DE CORREOS ---
        const transporter = nodemailer.createTransport({
            host: process.env.ZOHO_SMTP_HOST,
            port: process.env.ZOHO_SMTP_PORT,
            secure: true,
            auth: { user: process.env.ZOHO_USER_EMAIL, pass: process.env.ZOHO_USER_PASSWORD },
        });

        const fileName = `HC_${data.documento}_Sesion${sessionCountToday}.pdf`;
        
        // Correo para el profesional
        await transporter.sendMail({
            from: process.env.ZOHO_USER_EMAIL,
            to: process.env.PROFESSIONAL_EMAIL,
            subject: `Historia Clínica - ${data.nombre_completo}`,
            html: `<p>Se adjunta la historia clínica del paciente <b>${data.nombre_completo}</b>.</p><p>La contraseña del archivo es: <b>${password}</b></p>`,
            attachments: [{ filename: fileName, content: Buffer.from(protectedPdfBytes), contentType: 'application/pdf' }],
        });

        // Correo para el paciente
        await transporter.sendMail({
            from: process.env.ZOHO_USER_EMAIL,
            to: data.correo,
            subject: 'Copia de su Historia Clínica',
            html: `<p>Estimado/a paciente, se adjunta una copia protegida de su historia clínica.</p><p>La contraseña para abrir el archivo es: <b>${password}</b></p><p>Por favor, guárdela en un lugar seguro.</p>`,
            attachments: [{ filename: fileName, content: Buffer.from(protectedPdfBytes), contentType: 'application/pdf' }],
        });

        // --- 7. ACTUALIZAR EL REGISTRO EN GOOGLE SHEETS ---
        const newRow = [
            data.fecha_sesion, data.hora_cons, data.documento, data.nombre_completo,
            data.motivo, password, fileName, "Enviado por correo",
            `Sesión ${sessionCountToday}`, data.profesional_sesion, "Completado"
        ];
        await sheets.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: 'A1',
            valueInputOption: 'USER_ENTERED',
            resource: { values: [newRow] },
        });
        
        return { statusCode: 200, body: JSON.stringify({ message: 'PDF generado, protegido y enviado exitosamente.' }) };

    } catch (error) {
        console.error('Error en la función:', error);
        return { statusCode: 500, body: JSON.stringify({ message: 'Error interno del servidor.', error: error.message }) };
    }
};

