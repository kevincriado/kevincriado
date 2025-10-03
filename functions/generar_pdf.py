import json
import os
from mailmerge import MailMerge
from cloudmersive_convert_api_client import ConvertDocumentApi, ApiClient, Configuration
from cloudmersive_convert_api_client.rest import ApiException
import base64
import io
import tempfile

def handler(event, context):
    # Create a temporary directory that will be cleaned up automatically
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            # 1. --- Validate Environment Variables ---
            api_key = os.environ.get('CLOUDMERSIVE_API_KEY')
            if not api_key:
                raise ValueError("Error de configuración: La variable de entorno 'CLOUDMERSIVE_API_KEY' no fue encontrada.")

            # 2. --- Get Form Data ---
            if not event.get('body'):
                raise ValueError("No se recibieron datos en la solicitud.")
            data = json.loads(event.get('body'))

            # 3. --- Prepare Data for MailMerge ---
            data['GRABACION_SI'] = 'X' if data.get('autoriza_grabacion') == 'SI' else ' '
            data['GRABACION_NO'] = 'X' if data.get('autoriza_grabacion') == 'NO' else ' '
            data['TRANSCRIPCION_SI'] = 'X' if data.get('autoriza_transcripcion') == 'SI' else ' '
            data['TRANSCRIPCION_NO'] = 'X' if data.get('autoriza_transcripcion') == 'NO' else ' '

            # 4. --- Load and Populate the DOCX Template ---
            template_path = os.path.join(os.path.dirname(__file__), 'PlantillaHC.docx')
            if not os.path.exists(template_path):
                raise FileNotFoundError("El archivo de plantilla 'PlantillaHC.docx' no se encontró en el servidor.")
            
            # Define the path for the temporary filled DOCX file
            temp_docx_path = os.path.join(temp_dir, 'filled_template.docx')
            
            with MailMerge(template_path) as document:
                document.merge_pages([data])
                document.write(temp_docx_path)
            
            # 5. --- Convert the filled DOCX to PDF using Cloudmersive ---
            # This follows the exact authentication method from the documentation
            configuration = Configuration()
            configuration.api_key['Apikey'] = api_key
            api_client = ApiClient(configuration)
            api_instance = ConvertDocumentApi(api_client)
            
            try:
                # We pass the FILE PATH, as required by the documentation
                pdf_file_path = api_instance.convert_document_docx_to_pdf(temp_docx_path)
                
                # The API returns a path to the generated PDF, so we read it
                with open(pdf_file_path, 'rb') as f:
                    pdf_buffer = f.read()

            except ApiException as e:
                raise RuntimeError(f"La API de Cloudmersive falló al convertir a PDF: {e.body}")

            # 6. --- Generate Filename and send to browser ---
            session_date = data.get('FECHA_SESION', 'nodate').replace('/', '-')
            documento = data.get('DOCUMENTO', 'NOID')
            filename = f"HC_{documento}_{session_date}.pdf"
            
            return {
                'statusCode': 200,
                'headers': {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': f'attachment; filename="{filename}"'
                },
                'body': base64.b64encode(pdf_buffer).decode('utf-8'),
                'isBase64Encoded': True
            }

        except Exception as e:
            print(f"--- FUNCTION FAILED ---: {e}")
            return {
                'statusCode': 500,
                'body': json.dumps({
                    'message': "Error interno del servidor.",
                    'error': str(e)
                })
            }
        # The temporary directory and its contents are automatically deleted when the 'with' block is exited.


