// Import necessary modules
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const docx_pdf = require('docx-pdf');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

// --- Main Handler Function ---
exports.handler = async (event) => {
  // We will wrap the entire function in a try-catch block
  // to send detailed errors back to the frontend.
  try {
    // Step 1: Validate Environment Variables
    const requiredEnvVars = [
      'ZOHO_USER', 'ZOHO_PASS', 'GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_CREDENTIALS'
    ];
    for (const v of requiredEnvVars) {
      if (!process.env[v]) {
        throw new Error(`Configuración del servidor incompleta: Falta la variable de entorno '${v}'.`);
      }
    }

    // Step 2: Parse Incoming Data
    if (!event.body) throw new Error("No se recibieron datos en la solicitud.");
    const data = JSON.parse(event.body);

    // Step 3: Load DOCX Template
    const templatePath = path.resolve(__dirname, 'PlantillaHC.docx');
    if (!fs.existsSync(templatePath)) {
        throw new Error(`El archivo de plantilla 'PlantillaHC.docx' no se encontró en el servidor.`);
    }
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new PizZip.DocUtils();
    doc.load(zip);

    // Step 4: Populate the Template
    const GRABACION_SI = data.autoriza_grabacion === 'SI' ? 'X' : ' ';
    const GRABACION_NO = data.autoriza_grabacion === 'NO' ? 'X' : ' ';
    const TRANSCRIPCION_SI = data.autoriza_transcripcion === 'SI' ? 'X' : ' ';
    const TRANSCRIPCION_NO = data.autoriza_transcripcion === 'NO' ? 'X' : ' ';
    const templateData = { ...data, GRABACION_SI, GRABACION_NO, TRANSCRIPCION_SI, TRANSCRIPCION_NO };
    doc.setData(templateData);
    doc.render();
    const populatedDocxBuffer = doc.getZip().generate({ type: 'nodebuffer' });

    // Step 5: Convert to PDF
    const pdfBuffer = await new Promise((resolve, reject) => {
        docx_pdf(populatedDocxBuffer, (err, result) => {
            if (err) return reject(new Error("Falló la conversión del documento a PDF."));
            resolve(result);
        });
    });

    // Step 6: Generate Password and Filename
    const initials = data.NOMBRE_COMPLETO.split(' ').map(n => n[0]).join('').toUpperCase();
    const sessionDate = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '');
    const password = `${initials}${data.DOCUMENTO}${sessionDate}`;
    const filename = `HC_${data.DOCUMENTO}_${sessionDate}.pdf`;

    // Step 7: Send Emails
    let transporter;
    try {
        transporter = nodemailer.createTransport({
            host: 'smtp.zoho.com', port: 465, secure: true,
            auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
        });
    } catch (e) {
        throw new Error("Error al configurar el servicio de correo (transporter).");
    }

    const mailOptionsBase = {
        from: `"Historia Clínica Digital" <${process.env.ZOHO_USER}>`,
        subject: `Historia Clínica - ${data.NOMBRE_COMPLETO}`,
        html: `<p>Estimado/a,</p><p>Adjunto encontrará la historia clínica generada para el paciente ${data.NOMBRE_COMPLETO}.</p><p>La contraseña para abrir el documento es: <strong>${password}</strong></p><p>Saludos cordiales.</p>`,
        attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
    };
    
    // Using Promise.all to send emails concurrently
    await Promise.all([
        transporter.sendMail({ ...mailOptionsBase, to: process.env.ZOHO_USER }),
        transporter.sendMail({ ...mailOptionsBase, to: data.CORREO })
    ]).catch(emailError => {
        throw new Error(`Error al enviar los correos electrónicos. Verifica las credenciales de Zoho y los destinatarios. Detalles: ${emailError.message}`);
    });

    // Step 8: Update Google Sheet
    let sheets;
    try {
        const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS, 'base64').toString('ascii'));
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: 'https://www.googleapis.com/auth/spreadsheets',
        });
        sheets = google.sheets({ version: 'v4', auth });
    } catch (e) {
        throw new Error(`Error de autenticación con Google. Verifica la variable GOOGLE_SERVICE_ACCOUNT_CREDENTIALS. Detalles: ${e.message}`);
    }
    
    const newRow = [
        new Date().toLocaleDateString('es-CO'), data.HORA_CONS, data.DOCUMENTO, data.NOMBRE_COMPLETO,
        data.MOTIVO, password, filename, 'Email', data.NUM_SESION, data.PROFESIONAL_SESION, 'Enviado'
    ];

    await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'A1',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [newRow] },
    }).catch(sheetError => {
        throw new Error(`Error al escribir en Google Sheets. Verifica el ID de la hoja y los permisos de la cuenta de servicio. Detalles: ${sheetError.message}`);
    });
    
    // Final Success Response
    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Historia Clínica generada y enviada con éxito." }),
    };

  } catch (error) {
    // This block catches any error from the steps above and sends it to the frontend.
    console.error("--- FUNCTION FAILED ---");
    console.error(error);
    return {
        statusCode: 500,
        body: JSON.stringify({
            message: "Error interno del servidor.",
            // We send the specific error message back for debugging.
            error: error.message || "Ocurrió un error desconocido."
        }),
    };
  }
};
