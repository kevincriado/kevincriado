// Import necessary modules
const fs = require('fs');
const path = require('path');
const os = require('os');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const docx_pdf = require('docx-pdf');

// The expressions parser is required for custom delimiters like <<...>>
const expressions = require("angular-expressions");

exports.handler = async (event) => {
  const tempDocxPath = path.join(os.tmpdir(), `temp_${Date.now()}.docx`);
  const tempPdfPath = path.join(os.tmpdir(), `temp_${Date.now()}.pdf`);

  try {
    if (!event.body) throw new Error("No se recibieron datos en la solicitud.");
    const data = JSON.parse(event.body);

    const templatePath = path.resolve(__dirname, 'PlantillaHC.docx');
    if (!fs.existsSync(templatePath)) {
        throw new Error(`El archivo de plantilla 'PlantillaHC.docx' no se encontró en el servidor.`);
    }
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    
    // Assign the angular parser to the expressions variable
    expressions.filters = {};
    expressions.filters.upper = function(input) {
        if(!input) return input;
        return input.toUpperCase();
    };
    function angularParser(tag) {
        return {
            get: function(scope) {
                return expressions.compile(tag)(scope);
            }
        };
    }
    
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        parser: angularParser,
        delimiters: {
            start: '<<',
            end: '>>',
        },
    });

    const GRABACION_SI = data.autoriza_grabacion === 'SI' ? 'X' : ' ';
    const GRABACION_NO = data.autoriza_grabacion === 'NO' ? 'X' : ' ';
    const TRANSCRIPCION_SI = data.autoriza_transcripcion === 'SI' ? 'X' : ' ';
    const TRANSCRIPCION_NO = data.autoriza_transcripcion === 'NO' ? 'X' : ' ';
    const templateData = { ...data, GRABACION_SI, GRABACION_NO, TRANSCRIPCION_SI, TRANSCRIPCION_NO };
    
    doc.render(templateData);

    const populatedDocxBuffer = doc.getZip().generate({ 
        type: 'nodebuffer',
        compression: "DEFLATE",
    });

    fs.writeFileSync(tempDocxPath, populatedDocxBuffer);

    await new Promise((resolve, reject) => {
        docx_pdf(tempDocxPath, tempPdfPath, (err) => {
            if (err) return reject(new Error(`Falló la conversión del documento a PDF. Detalles: ${err.message}`));
            resolve();
        });
    });
    
    const hcPdfBuffer = fs.readFileSync(tempPdfPath);
    
    const sessionDate = new Date().toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '');
    const filename = `HC_${data.DOCUMENTO}_${sessionDate}.pdf`;

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
        body: hcPdfBuffer.toString('base64'),
        isBase64Encoded: true,
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
  } finally {
    if (fs.existsSync(tempDocxPath)) fs.unlinkSync(tempDocxPath);
    if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
  }
};


