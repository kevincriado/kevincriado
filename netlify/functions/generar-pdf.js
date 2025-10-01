// Import necessary modules
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const docx_pdf = require('docx-pdf');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

// --- Main Handler Function ---
exports.handler = async (event) => {
  try {
    // Step 1: Validate Environment Variables
    const requiredEnvVars = ['ZOHO_USER', 'ZOHO_PASS'];
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
    const hcPdfBuffer = await new Promise((resolve, reject) => {
        docx_pdf(populatedDocxBuffer, (err, result) => {
            if (err) return reject(new Error("Falló la conversión del documento a PDF."));
            resolve(result);
        });
    });

    // Step 6: Generate Password and Filename
    const initials = data.NOMBRE_COMPLETO.split(' ').map(n => n[0]).join('').toUpperCase();
    const sessionDate = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '');
    const password = `${initials}${data.DOCUMENTO}${sessionDate}`;
    const hcFilename = `HC_${data.DOCUMENTO}_${sessionDate}.pdf`;
    const logFilename = `Registro_HC_${data.DOCUMENTO}_${sessionDate}.pdf`;

    // Step 7: Generate Log PDF from scratch
    const logPdfBuffer = await new Promise((resolve) => {
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            resolve(Buffer.concat(buffers));
        });

        // --- Content of the Log PDF ---
        doc.fontSize(18).font('Helvetica-Bold').text('Registro de Sesión', { align: 'center' });
        doc.moveDown(2);

        const addField = (label, value) => {
            doc.fontSize(12).font('Helvetica-Bold').text(label, { continued: true }).font('Helvetica').text(`: ${value || 'N/A'}`);
            doc.moveDown(0.5);
        };

        addField('Fecha', new Date().toLocaleDateString('es-CO'));
        addField('Hora', data.HORA_CONS);
        addField('Cédula', data.DOCUMENTO);
        addField('Nombre', data.NOMBRE_COMPLETO);
        addField('Motivo', data.MOTIVO);
        addField('Contraseña Generada', password);
        addField('Archivo HC', hcFilename);
        addField('Sesión No.', data.NUM_SESION);
        addField('Profesional', data.PROFESIONAL_SESION);
        addField('Estado', 'Enviado');
        // --- End of content ---

        doc.end();
    });

    // Step 8: Send Emails
    const transporter = nodemailer.createTransport({
        host: 'smtp.zoho.com', port: 465, secure: true,
        auth: { user: process.env.ZOHO_USER, pass: process.env.ZOHO_PASS },
    });

    // --- Email to Professional ---
    const professionalMailOptions = {
        from: `"Historia Clínica Digital" <${process.env.ZOHO_USER}>`,
        to: process.env.ZOHO_USER,
        subject: `Historia Clínica - ${data.NOMBRE_COMPLETO}`,
        html: `<p>Hola,</p><p>Se ha generado una nueva historia clínica para el paciente <strong>${data.NOMBRE_COMPLETO}</strong>.</p><p>La contraseña para el archivo de HC es: <strong>${password}</strong></p><p>Se adjuntan la historia clínica y el registro de la sesión.</p>`,
        attachments: [
            { filename: hcFilename, content: hcPdfBuffer, contentType: 'application/pdf' },
            { filename: logFilename, content: logPdfBuffer, contentType: 'application/pdf' }
        ],
    };

    // --- Email to Patient ---
    const patientMailOptions = {
        from: `"Historia Clínica Digital" <${process.env.ZOHO_USER}>`,
        to: data.CORREO,
        subject: `Copia de tu Historia Clínica`,
        html: `<p>Estimado/a ${data.NOMBRE_COMPLETO},</p><p>Adjunto encontrarás una copia de la historia clínica generada en tu reciente consulta.</p><p>Este es un documento confidencial. Por favor, guárdalo en un lugar seguro.</p><p>Saludos cordiales.</p>`,
        attachments: [{ filename: hcFilename, content: hcPdfBuffer, contentType: 'application/pdf' }],
    };
    
    // Send both emails concurrently
    await Promise.all([
        transporter.sendMail(professionalMailOptions),
        transporter.sendMail(patientMailOptions)
    ]).catch(emailError => {
        throw new Error(`Error al enviar los correos electrónicos. Verifica las credenciales de Zoho. Detalles: ${emailError.message}`);
    });

    // Final Success Response
    return {
        statusCode: 200,
        body: JSON.stringify({ message: "Historia Clínica y Registro generados y enviados con éxito." }),
    };

  } catch (error) {
    console.error("--- FUNCTION FAILED ---", error);
    return {
        statusCode: 500,
        body: JSON.stringify({
            message: "Error interno del servidor.",
            error: error.message || "Ocurrió un error desconocido."
        }),
    };
  }
};

