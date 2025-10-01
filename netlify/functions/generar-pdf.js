// Import necessary modules
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const docx_pdf = require('docx-pdf');

// --- Main Handler Function ---
exports.handler = async (event) => {
  try {
    // Step 1: Parse Incoming Data
    if (!event.body) throw new Error("No se recibieron datos en la solicitud.");
    const data = JSON.parse(event.body);

    // Step 2: Load DOCX Template
    const templatePath = path.resolve(__dirname, 'PlantillaHC.docx');
    if (!fs.existsSync(templatePath)) {
        throw new Error(`El archivo de plantilla 'PlantillaHC.docx' no se encontró en el servidor.`);
    }
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new PizZip.DocUtils();
    doc.load(zip);

    // Step 3: Populate the Template
    const GRABACION_SI = data.autoriza_grabacion === 'SI' ? 'X' : ' ';
    const GRABACION_NO = data.autoriza_grabacion === 'NO' ? 'X' : ' ';
    const TRANSCRIPCION_SI = data.autoriza_transcripcion === 'SI' ? 'X' : ' ';
    const TRANSCRIPCION_NO = data.autoriza_transcripcion === 'NO' ? 'X' : ' ';
    const templateData = { ...data, GRABACION_SI, GRABACION_NO, TRANSCRIPCION_SI, TRANSCRIPCION_NO };
    doc.setData(templateData);
    doc.render();
    const populatedDocxBuffer = doc.getZip().generate({ type: 'nodebuffer' });

    // Step 4: Convert to PDF
    const hcPdfBuffer = await new Promise((resolve, reject) => {
        docx_pdf(populatedDocxBuffer, (err, result) => {
            if (err) return reject(new Error("Falló la conversión del documento a PDF."));
            resolve(result);
        });
    });
    
    // Step 5: Generate Filename
    const sessionDate = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '');
    const filename = `HC_${data.DOCUMENTO}_${sessionDate}.pdf`;

    // Step 6: Return PDF for Download
    // Instead of sending an email, we return the file directly to the browser.
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
        body: hcPdfBuffer.toString('base64'), // Encode body as Base64
        isBase64Encoded: true,
    };

  } catch (error) {
    console.error("--- FUNCTION FAILED ---", error);
    // If something fails, return a JSON error so the frontend can display it.
    return {
        statusCode: 500,
        body: JSON.stringify({
            message: "Error interno del servidor.",
            error: error.message || "Ocurrió un error desconocido."
        }),
    };
  }
};
