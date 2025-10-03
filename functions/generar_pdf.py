import json
import os
from mailmerge import MailMerge
from cloudmersive_convert_api_client import ConvertDocumentApi, ApiClient, Configuration
from cloudmersive_convert_api_client.rest import ApiException
import base64
import io

def handler(event, context):
    try:
        api_key = os.environ.get('CLOUDMERSIVE_API_KEY')
        if not api_key:
            raise ValueError("Error de configuración: La variable de entorno 'CLOUDMERSIVE_API_KEY' no fue encontrada.")

        if not event.get('body'):
            raise ValueError("No se recibieron datos en la solicitud.")
        data = json.loads(event.get('body'))

        data['GRABACION_SI'] = 'X' if data.get('autoriza_grabacion') == 'SI' else ' '
        data['GRABACION_NO'] = 'X' if data.get('autoriza_grabacion') == 'NO' else ' '
        data['TRANSCRIPCION_SI'] = 'X' if data.get('autoriza_transcripcion') == 'SI' else ' '
        data['TRANSCRIPCION_NO'] = 'X' if data.get('autoriza_transcripcion') == 'NO' else ' '

        template_path = os.path.join(os.path.dirname(__file__), 'PlantillaHC.docx')
        if not os.path.exists(template_path):
            raise FileNotFoundError("El archivo de plantilla 'PlantillaHC.docx' no se encontró en el servidor.")
        
        filled_docx_buffer = io.BytesIO()
        with MailMerge(template_path) as document:
            document.merge_pages([data])
            document.write(filled_docx_buffer)
        
        filled_docx_buffer.seek(0)
        filled_docx_bytes = filled_docx_buffer.read()

        configuration = Configuration()
        configuration.api_key['Apikey'] = api_key
        api_client = ApiClient(configuration)
        api_instance = ConvertDocumentApi(api_client)
        
        try:
            api_response = api_instance.convert_document_docx_to_pdf(filled_docx_bytes)
            pdf_buffer = api_response
        except ApiException as e:
            raise RuntimeError(f"La API de Cloudmersive falló al convertir a PDF: {e.body}")

        session_date = data.get('FECHA_SESION', '').replace('/', '-')
        documento = data.get('DOCUMENTO', 'SIN_ID')
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



