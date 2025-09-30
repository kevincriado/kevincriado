// Import necessary modules
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const docx_pdf = require('docx-pdf');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');

// --- Helper Function for Logging ---
// This makes our logs clearer in Netlify
const log = (message, data = null) => {
  console.log(`[HC-LOG] ${message}`, data !== null ? JSON.stringify(data, null, 2) : '');
};

// --- Main Handler Function ---
exports.handler = async (event) => {
  log("Function execution started.");

  // 1. --- Environment Variable Validation ---
  // This block checks if all required secrets are available.
  try {
    log("Step 1: Validating environment variables...");
    const requiredEnvVars = [
      'ZOHO_USER', 'ZOHO_PASS', 'GOOGLE_SHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_CREDENTIALS'
    ];
    
    for (const v of requiredEnvVars) {
      if (!process.env[v]) {
        throw new Error(`CRITICAL: Missing required environment variable: ${v}`);
      }
    }
    log("Environment variables are present.");
  } catch (error) {
    log("ERROR during environment variable validation:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Server configuration error. Check function logs.", error: error.message }),
    };
  }

  try {
    // 2. --- Parsing Incoming Data ---
    log("Step 2: Parsing incoming form data...");
    if (!event.body) {
      throw new Error("No data received in the request body.");
    }
    const data = JSON.parse(event.body);
    log("Form data parsed successfully.");
    
    // 3. --- Loading DOCX Template ---
    log("Step 3: Loading DOCX template...");
    const templatePath = path.resolve(__dirname, 'PlantillaHC.docx');
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Template file not found at path: ${templatePath}`);
    }
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new PizZip.DocUtils();
    doc.load(zip);
    log("DOCX template loaded.");

    // 4. --- Populating the Template ---
    log("Step 4: Populating template with data...");
    
    // Handle consent checkboxes
    const GRABACION_SI = data.autoriza_grabacion === 'SI' ? 'X' : ' ';
    const GRABACION_NO = data.autoriza_grabacion === 'NO' ? 'X' : ' ';
    const TRANSCRIPCION_SI = data.autoriza_transcripcion === 'SI' ? 'X' : ' ';
    const TRANSCRIPCION_NO = data.autoriza_transcripcion === 'NO' ? 'X' : ' ';

    const templateData = { ...data, GRABACION_SI, GRABACION_NO, TRANSCRIPCION_SI, TRANSCRIPCION_NO };
    
    doc.setData(templateData);
    doc.render();
    log("Template populated.");

    const populatedDocxBuffer = doc.getZip().generate({ type: 'nodebuffer' });

    // 5. --- Converting to PDF ---
    log("Step 5: Converting DOCX to PDF...");
    const pdfBuffer = await new Promise((resolve, reject) => {
      docx_pdf(populatedDocxBuffer, (err, result) => {
        if (err) {
          return reject(err);
        }
        resolve(result);
      });
    });
    log("Conversion to PDF successful.");

    // 6. --- Generating Password and Filename ---
    log("Step 6: Generating password and filename...");
    const initials = data.NOMBRE_COMPLETO.split(' ').map(n => n[0]).join('').toUpperCase();
    const sessionDate = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '');
    const password = `${initials}${data.DOCUMENTO}${sessionDate}`;
    const filename = `HC_${data.DOCUMENTO}_${sessionDate}.pdf`;
    log(`Generated filename: ${filename}`);

    // This section is commented out as PDF password protection with docx-pdf is not directly supported.
    // We will send the password in the email instead.

    // 7. --- Sending Emails ---
    log("Step 7: Preparing to send emails...");
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
    });

    const mailOptionsBase = {
      from: `"Historia Clínica Digital" <${process.env.ZOHO_USER}>`,
      subject: `Historia Clínica - ${data.NOMBRE_COMPLETO}`,
      html: `<p>Estimado/a,</p><p>Adjunto encontrará la historia clínica generada para el paciente ${data.NOMBRE_COMPLETO}.</p><p>La contraseña para abrir el documento es: <strong>${password}</strong></p><p>Saludos cordiales.</p>`,
      attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
    };

    // Send to professional
    log(`Sending email to professional: ${process.env.ZOHO_USER}`);
    await transporter.sendMail({ ...mailOptionsBase, to: process.env.ZOHO_USER });
    
    // Send to patient
    log(`Sending email to patient: ${data.CORREO}`);
    await transporter.sendMail({ ...mailOptionsBase, to: data.CORREO });
    log("Emails sent successfully.");

    // 8. --- Updating Google Sheet ---
    log("Step 8: Preparing to update Google Sheet...");
    const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS, 'base64').toString('ascii')),
        scopes: 'https://www.googleapis.com/auth/spreadsheets',
    });
    const sheets = google.sheets({ version: 'v4', auth });
    
    const newRow = [
        new Date().toLocaleDateString('es-CO'), data.HORA_CONS, data.DOCUMENTO, data.NOMBRE_COMPLETO,
        data.MOTIVO, password, filename, 'Email', data.NUM_SESION, data.PROFESIONAL_SESION, 'Enviado'
    ];
    
    await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'A1',
        valueInputOption: 'USER_ENTERED',
        resource: { values: [newRow] },
    });
    log("Google Sheet updated successfully.");

    // 9. --- Final Success Response ---
    log("Function execution finished successfully.");
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Historia Clínica generada y enviada con éxito." }),
    };

  } catch (error) {
    // --- Global Error Catcher ---
    log("FATAL ERROR during function execution:", error.message);
    console.error(error); // Log the full stack trace for detailed debugging
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error interno del servidor.", error: error.message }),
    };
  }
};

