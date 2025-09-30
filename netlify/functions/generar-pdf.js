// Importa todas las dependencias necesarias
const fs = require('fs');
const path = require('path');
const os = require('os'); // Necesario para el directorio temporal
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const docxPdf = require('docx-pdf'); // Nueva librería de conversión
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
        
        // --- 1. LÓGICA DE REGISTRO CON GOOGLE SHEETS ---
        const sheets = await getGoogleSheetsClient();
        const sheetId = process.env.GOOGLE_SHEET_ID;
        const range = 'A:K';

        const response = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
        const rows = response.data.values || [];

        let sessionCountToday = 1;
        rows.forEach(row => {
            const rowDate = row[0];
            const rowDoc = row[2];
            if (rowDate === data.fecha_sesion && rowDoc === data.documento) {
                sessionCountToday++;
            }
        });

        // --- 2. GENERACIÓN DE CONTRASEÑA ---
        const initials = data.nombre_completo.split(' ').map(n => n[0]).join('');
        const dateForPassword = data.fecha_sesion.replace(/-/g, '');
        const password = `${initials}${data.documento}${dateForPassword}`;

        // --- 3. LLENADO DE PLANTILLA DOCX ---
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
        doc.render();

        const filledDocxBuffer = doc.getZip().generate({ type: 'nodebuffer' });

        // --- 4. CONVERSIÓN DE DOCX A PDF (NUEVO MÉTODO) ---
        // Las funciones serverless de Netlify permiten escribir en un directorio temporal '/tmp'
        const tempDocxPath = path.join(os.tmpdir(), `temp_${Date.now()}.docx`);
        const tempPdfPath = path.join(os.tmpdir(), `temp_${Date.now()}.pdf`);

        // Escribir el buffer del docx a un archivo temporal
        fs.writeFileSync(tempDocxPath, filledDocxBuffer);
        
        // Usar la nueva librería para convertir el archivo
        await new Promise((resolve, reject) => {
            docxPdf(tempDocxPath, tempPdfPath, (err) => {
                if (err) {
                    return reject(err);
                }
                resolve();
            });
        });

        // Leer el PDF recién creado en un buffer
        const pdfBuffer = fs.readFileSync(tempPdfPath);
        
        // Limpiar los archivos temporales
        fs.unlinkSync(tempDocxPath);
        fs.unlinkSync(tempPdfPath);


        // --- 5. PROTECCIÓN DEL PDF CON CONTRASEÑA ---
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        pdfDoc.setProducer('Kevin Criado Psicología');
        pdfDoc.setCreator('Asistente de HC');
        
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
        
        await transporter.sendMail({
            from: process.env.ZOHO_USER_EMAIL,
            to: process.env.PROFESSIONAL_EMAIL,
            subject: `Historia Clínica - ${data.nombre_completo}`,
            html: `<p>Se adjunta la historia clínica del paciente <b>${data.nombre_completo}</b>.</p><p>La contraseña del archivo es: <b>${password}</b></p>`,
            attachments: [{ filename: fileName, content: Buffer.from(protectedPdfBytes), contentType: 'application/pdf' }],
        });

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

